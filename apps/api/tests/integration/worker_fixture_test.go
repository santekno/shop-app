//go:build integration

package integration_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/logging"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/user"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// The Bab 6 worker harness: a real Asynq server on the test's own Redis
// database, running the worker's real handlers (worker.NewJobs,
// worker.RegisterNotifications, notify.Once) against the test's own
// PostgreSQL database. Tasks are enqueued with a real Asynq client and
// kept after they finish (Retention), so a test can ask Asynq how each one
// ended. Retries come back after 50 ms instead of the production backoff.
// cmd/worker itself (scheduler, health, configuration) runs in
// worker_e2e_test.go.

// taskWorker is a running Asynq server and a client on the same Redis.
type taskWorker struct {
	rdb       *redis.Client
	client    *asynq.Client
	inspector *asynq.Inspector
	logs      *syncBuffer
	// Publisher is the outbox publisher the worker's jobs use.
	publisher *notify.QueuePublisher
}

// workerOpts says what the worker under test runs.
type workerOpts struct {
	// deps are the jobs' dependencies; DB and Publisher are filled in.
	deps worker.JobDeps
	// mailer sends the emails; nil means a recording mailer is not needed
	// and the development log mailer is used.
	mailer mail.Mailer
	// seller, when set, handles the seller's paid-order message, and the
	// outbox routes order.paid to it.
	seller asynq.HandlerFunc
}

// startWorker runs the worker's handlers on sh's database and Redis until
// the test ends.
func startWorker(t *testing.T, sh *shop, o workerOpts) *taskWorker {
	t.Helper()
	if sh.rdb == nil {
		t.Fatal("the shop has no Redis client of the test's own")
	}
	logs := &syncBuffer{}
	logger := logging.NewService(logs, true, "debug", "worker")
	w := &taskWorker{
		rdb: sh.rdb, logs: logs,
		client:    asynq.NewClientFromRedisClient(sh.rdb),
		inspector: asynq.NewInspectorFromRedisClient(sh.rdb),
	}
	w.publisher = notify.NewQueuePublisher(w.client, notify.NewRoutes(o.seller != nil))
	o.deps.DB, o.deps.Publisher = sh.db, w.publisher
	if o.mailer == nil {
		o.mailer = mail.NewLogMailer(logger, true)
	}

	mux := asynq.NewServeMux()
	worker.NewJobs(o.deps).Register(mux)
	deliveries := outbox.NewDeliveries(sh.db)
	worker.RegisterNotifications(mux, deliveries,
		notify.NewEmails(o.mailer, order.NewPostgresRepository(sh.db), user.NewPostgresRepository(sh.db)))
	if o.seller != nil {
		mux.HandleFunc(notify.TypeSellerPaidOrder, notify.Once(deliveries, o.seller))
	}
	srv := asynq.NewServerFromRedisClient(sh.rdb, asynq.Config{
		Concurrency:              4,
		Queues:                   map[string]int{worker.Queue: 1},
		BaseContext:              func() context.Context { return logx.WithContextLogger(context.Background(), logger) },
		Logger:                   quietAsynq{logs},
		LogLevel:                 asynq.WarnLevel,
		ShutdownTimeout:          5 * time.Second,
		RetryDelayFunc:           func(int, error, *asynq.Task) time.Duration { return 50 * time.Millisecond },
		DelayedTaskCheckInterval: 100 * time.Millisecond,
	})
	if err := srv.Start(mux); err != nil {
		t.Fatalf("start the task server: %v", err)
	}
	t.Cleanup(func() {
		srv.Shutdown()
		_ = w.client.Close()
	})
	return w
}

// quietAsynq writes Asynq's own warnings and errors to the test's log
// buffer.
type quietAsynq struct{ logs *syncBuffer }

func (q quietAsynq) Debug(...any)      {}
func (q quietAsynq) Info(...any)       {}
func (q quietAsynq) Warn(args ...any)  { q.line("asynq WARN", args) }
func (q quietAsynq) Error(args ...any) { q.line("asynq ERROR", args) }
func (q quietAsynq) Fatal(args ...any) { q.line("asynq FATAL", args) }

func (q quietAsynq) line(level string, args []any) {
	_, _ = fmt.Fprintln(q.logs, append([]any{level}, args...)...)
}

// enqueue puts a task of taskType (no payload, like the scheduler's) on
// the queue with the production retry limit and keeps it an hour after
// it finished, and returns its id.
func (w *taskWorker) enqueue(t *testing.T, taskType string, opts ...asynq.Option) string {
	t.Helper()
	opts = append([]asynq.Option{asynq.Queue(worker.Queue), notify.MaxRetry(taskType), asynq.Retention(time.Hour)}, opts...)
	info, err := w.client.EnqueueContext(t.Context(), asynq.NewTask(taskType, nil), opts...)
	if err != nil {
		t.Fatalf("enqueue %s: %v", taskType, err)
	}
	return info.ID
}

// wait waits until task id has finished (completed or archived) and
// returns its final state.
func (w *taskWorker) wait(t *testing.T, id string) *asynq.TaskInfo {
	t.Helper()
	var info *asynq.TaskInfo
	eventually(t, 30*time.Second, func() bool {
		var err error
		info, err = w.inspector.GetTaskInfo(worker.Queue, id)
		if errors.Is(err, asynq.ErrTaskNotFound) {
			return false
		}
		if err != nil {
			t.Fatalf("task %s: %v", id, err)
		}
		return info.State == asynq.TaskStateCompleted || info.State == asynq.TaskStateArchived
	}, "task %s did not finish; worker logs:\n%s", id, w.logs.String())
	return info
}

// run enqueues taskType, waits for it and fails unless it completed.
func (w *taskWorker) run(t *testing.T, taskType string) {
	t.Helper()
	if info := w.wait(t, w.enqueue(t, taskType)); info.State != asynq.TaskStateCompleted {
		t.Fatalf("%s ended %s after %d retries: %s\nworker logs:\n%s", taskType, info.State, info.Retried, info.LastErr, w.logs.String())
	}
}

// archived lists the dead-letter queue's tasks.
func (w *taskWorker) archived(t *testing.T) []*asynq.TaskInfo {
	t.Helper()
	tasks, err := w.inspector.ListArchivedTasks(worker.Queue, asynq.PageSize(100))
	if err != nil {
		t.Fatalf("list archived tasks: %v", err)
	}
	return tasks
}

// taskIDs lists every task id Asynq holds in the queue, in any state.
func (w *taskWorker) taskIDs(t *testing.T) map[string]asynq.TaskState {
	t.Helper()
	out := map[string]asynq.TaskState{}
	lists := []func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error){
		w.inspector.ListPendingTasks, w.inspector.ListActiveTasks, w.inspector.ListScheduledTasks,
		w.inspector.ListRetryTasks, w.inspector.ListArchivedTasks, w.inspector.ListCompletedTasks,
	}
	for _, list := range lists {
		tasks, err := list(worker.Queue, asynq.PageSize(1000))
		if err != nil {
			continue // the queue does not exist yet
		}
		for _, ti := range tasks {
			out[ti.ID] = ti.State
		}
	}
	return out
}
