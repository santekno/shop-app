package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/logging"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The schedule of ADR 0007.
func TestSchedule(t *testing.T) {
	want := []Periodic{
		{Type: TypePublishEvents, Every: 5 * time.Second, Timeout: 30 * time.Second},
		{Type: TypeExpireOrders, Every: time.Minute, Timeout: time.Minute},
		{Type: TypeProcessImages, Every: 30 * time.Second, Timeout: 2 * time.Minute},
		{Type: TypeReconcilePayments, Every: 5 * time.Minute, Timeout: 4 * time.Minute},
		{Type: TypeCleanupIdempotency, Every: time.Hour, Timeout: 10 * time.Minute},
		{Type: TypeCleanupRefreshTokens, Every: time.Hour, Timeout: 10 * time.Minute},
		{Type: TypeCleanupGuestCarts, Every: time.Hour, Timeout: 10 * time.Minute},
		{Type: TypeCleanupPendingUploads, Every: time.Hour, Timeout: 10 * time.Minute},
		{Type: TypeCleanupOutbox, Every: 24 * time.Hour, Timeout: 30 * time.Minute},
	}
	testx.AssertEqual(t, len(Schedule), len(want))
	for i, p := range want {
		testx.AssertEqual(t, Schedule[i], p, "job %d", i)
	}
	testx.AssertEqual(t, Schedule[0].Spec(), "@every 5s")
	testx.AssertEqual(t, Periodic{Every: 90 * time.Second}.Spec(), "@every 1m30s")
	testx.AssertEqual(t, Schedule[8].Spec(), "@every 24h0m0s")
}

// Each scheduled job's task runs the job it is named after: the handler
// for a type runs that job's first statement.
func TestJobs_Register(t *testing.T) {
	first := map[string]string{
		TypePublishEvents:         "ClaimOutboxEvents",
		TypeExpireOrders:          "ListExpiredOrderIDs",
		TypeReconcilePayments:     "ListPaymentsToReconcile",
		TypeProcessImages:         "ListProcessingImages",
		TypeCleanupIdempotency:    "DeleteExpiredIdempotencyKeys",
		TypeCleanupRefreshTokens:  "DeleteExpiredRefreshTokens",
		TypeCleanupGuestCarts:     "DeleteAbandonedGuestCarts",
		TypeCleanupPendingUploads: "DeleteStalePendingImages",
		TypeCleanupOutbox:         "DeletePublishedEvents",
	}
	testx.AssertEqual(t, len(first), len(Schedule))
	for _, p := range Schedule {
		t.Run(p.Type, func(t *testing.T) {
			db := newFakeSQL()
			mux := asynq.NewServeMux()
			NewJobs(JobDeps{
				DB: db.open(t), Gateway: fakeGateway{}, Store: &fakeStore{}, Publisher: &recordingPublisher{}, Clock: fixedClock,
			}).Register(mux)
			ctx, _ := jobContext()

			h, pattern := mux.Handler(asynq.NewTask(p.Type, nil))
			testx.AssertEqual(t, pattern, p.Type, "no handler for %s", p.Type)
			testx.AssertNoError(t, h.ProcessTask(ctx, asynq.NewTask(p.Type, nil)))

			names := slices.DeleteFunc(db.names(), func(n string) bool { return n == "BEGIN" || n == "COMMIT" })
			if len(names) == 0 {
				t.Fatalf("%s ran no statement", p.Type)
			}
			testx.AssertEqual(t, names[0], first[p.Type])
		})
	}
	_, pattern := asynq.NewServeMux().Handler(asynq.NewTask(TypeExpireOrders, nil))
	testx.AssertEqual(t, pattern, "", "an empty mux has no handler (the check above means something)")
}

func TestRegisterNotifications(t *testing.T) {
	db := newFakeSQL().open(t)
	mux := asynq.NewServeMux()
	orders := order.NewPostgresRepository(db)
	RegisterNotifications(mux, outbox.NewDeliveries(db),
		notify.NewEmails(mail.NewLogMailer(logx.Noop(), false), orders, user.NewPostgresRepository(db)))

	for _, taskType := range []string{
		notify.TypeSendEmail, notify.TypeOrderConfirmationEmail, notify.TypePaymentReceivedEmail, notify.TypeOrderShippedEmail,
	} {
		_, pattern := mux.Handler(asynq.NewTask(taskType, nil))
		testx.AssertEqual(t, pattern, taskType, "no handler for %s", taskType)
	}
	_, pattern := mux.Handler(asynq.NewTask(notify.TypeSellerPaidOrder, nil))
	testx.AssertEqual(t, pattern, "", "the Telegram message is serve's to register, when it is on")
}

// register schedules every job with its queue, timeout, retry limit and
// uniqueness. The scheduler's heartbeat writes each entry's options to
// Redis (here: the in-process fake), which is the one place Asynq shows
// them.
func TestRegister_SchedulesEveryJobUnique(t *testing.T) {
	f := &fakeRedis{}
	scheduler := asynq.NewSchedulerFromRedisClient(newFakeRedis(t, f), &asynq.SchedulerOpts{
		Logger: asynqLogger{logx.Noop()}, HeartbeatInterval: 20 * time.Millisecond,
	})

	testx.AssertNoError(t, register(scheduler))
	testx.AssertNoError(t, scheduler.Start())
	var argv []any
	waitFor(t, "the scheduler's heartbeat", func() bool {
		f.mu.Lock()
		defer f.mu.Unlock()
		for _, args := range f.calls {
			if keys, a := scriptKeysArgs(args); len(keys) == 1 && strings.HasPrefix(keys[0], "asynq:schedulers:") {
				argv = a
				return true
			}
		}
		return false
	})
	scheduler.Shutdown()

	entries := map[string]schedulerEntry{}
	for _, raw := range argv[1:] {
		b, ok := raw.([]byte)
		testx.AssertTrue(t, ok, "entry %T", raw)
		e, err := decodeSchedulerEntry(b)
		testx.AssertNoError(t, err)
		_, dup := entries[e.Type]
		testx.AssertFalse(t, dup, "%s scheduled twice", e.Type)
		entries[e.Type] = e
	}
	testx.AssertEqual(t, len(entries), len(Schedule))
	for _, p := range Schedule {
		e := entries[p.Type]
		testx.AssertEqual(t, e.Spec, p.Spec(), p.Type)
		testx.AssertEqual(t, strings.Join(e.Opts, " "), fmt.Sprintf(`Queue("default") Timeout(%v) Unique(%v) MaxRetry(%d)`,
			p.Timeout, p.Every, notify.DefaultMaxRetry), p.Type)
	}
}

// requiredEnv is a valid configuration (the values of internal/app's
// tests; none of them real).
var requiredEnv = map[string]string{ //nolint:gosec // test values, not credentials
	"APP_ENV":                "production",
	"DATABASE_URL":           "postgres://localhost:5432/goshop?sslmode=disable",
	"JWT_SECRET":             "unit-test-jwt-secret-not-a-real-key-0123456789",
	"REDIS_URL":              "redis://localhost:6379/0",
	"GOOGLE_CLIENT_ID":       "goshop-test.apps.googleusercontent.com",
	"APP_TRUSTED_PROXY_HOPS": "0",
}

// setEnv clears every APP_* variable and the others Load reads, sets
// requiredEnv, then vars over it.
func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	names := []string{"PORT", "DATABASE_URL", "JWT_SECRET", "REDIS_URL", "GOOGLE_CLIENT_ID", "BITESHIP_API_KEY",
		"MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY", "MIDTRANS_IS_PRODUCTION", "S3_ENDPOINT", "SMTP_HOST",
		"TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"}
	for _, kv := range os.Environ() {
		if name, _, _ := strings.Cut(kv, "="); strings.HasPrefix(name, "APP_") {
			names = append(names, name)
		}
	}
	for _, name := range names {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
	}
	for k, v := range requiredEnv {
		if _, ok := vars[k]; !ok {
			t.Setenv(k, v)
		}
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}

// freePort is a loopback port nothing listens on.
func freePort(t *testing.T) int {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return port
}

func TestRun_Healthcheck(t *testing.T) {
	t.Run("a healthy worker", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/healthz" {
				w.WriteHeader(http.StatusNotFound)
			}
		}))
		defer srv.Close()
		setEnv(t, map[string]string{"PORT": strconv.Itoa(srv.Listener.Addr().(*net.TCPAddr).Port)})
		var out bytes.Buffer
		testx.AssertNoError(t, Run(context.Background(), strings.Fields("healthcheck"), &out))
		testx.AssertEqual(t, out.Len(), 0, "the probe does not start the worker")
	})
	t.Run("nothing listening", func(t *testing.T) {
		setEnv(t, map[string]string{"PORT": strconv.Itoa(freePort(t))})
		var out bytes.Buffer
		err := Run(context.Background(), strings.Fields("healthcheck"), &out)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "healthcheck: "), "err = %v", err)
	})
}

func TestRun_Errors(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		args    []string
		wantErr string
	}{
		{name: "config error comes first", env: map[string]string{"APP_ENV": ""}, args: strings.Fields("bogus"), wantErr: "config: "},
		{name: "invalid port", env: map[string]string{"PORT": "99999"}, wantErr: "PORT: must be a number between 1 and 65535"},
		{name: "unknown argument", args: strings.Fields("serve"), wantErr: `unknown arguments ["serve"] (usage: worker [healthcheck|dead-tasks …])`},
		{name: "healthcheck with extra arguments", args: strings.Fields("healthcheck now"), wantErr: `unknown arguments ["healthcheck" "now"]`},
		{name: "dead-tasks without redis", env: map[string]string{"REDIS_URL": refusingRESP(t)},
			args: strings.Fields("dead-tasks list"), wantErr: "open redis: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setEnv(t, tt.env)
			var out bytes.Buffer
			err := Run(context.Background(), tt.args, &out)
			if err == nil {
				t.Fatalf("Run: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

// refusingRESP is a REDIS_URL whose server refuses every command.
func refusingRESP(t *testing.T) string {
	t.Helper()
	r := newRESPServer(t)
	r.mu.Lock()
	r.refuse = true
	r.mu.Unlock()
	return r.url()
}

func TestRun_DeadTasks(t *testing.T) {
	t.Run("list", func(t *testing.T) {
		r := newRESPServer(t)
		setEnv(t, map[string]string{"REDIS_URL": r.url()})
		var out bytes.Buffer
		testx.AssertNoError(t, Run(context.Background(), strings.Fields("dead-tasks list"), &out))
		testx.AssertContains(t, out.String(), "0 dead tasks")
		testx.AssertTrue(t, r.sent("SISMEMBER"), "the inspector asked Redis")
	})
	t.Run("bad arguments", func(t *testing.T) {
		r := newRESPServer(t)
		setEnv(t, map[string]string{"REDIS_URL": r.url()})
		var out bytes.Buffer
		err := Run(context.Background(), strings.Fields("dead-tasks requeue"), &out)
		if err == nil {
			t.Fatal("want a usage error, got nil")
		}
		testx.AssertEqual(t, err.Error(), `unknown arguments ["requeue"] (usage: worker dead-tasks list|requeue <task id>|requeue-all)`)
	})
}

// Serving starts by opening the database, and does not go on without it.
// Serving itself is tested through serve below.
func TestRun_DatabaseUnreachable(t *testing.T) {
	setEnv(t, map[string]string{
		"PORT": strconv.Itoa(freePort(t)), "DATABASE_URL": "postgres://user:pass@127.0.0.1:" + strconv.Itoa(freePort(t)) + "/goshop?sslmode=disable",
	})
	var out syncBuffer
	err := Run(context.Background(), nil, &out)
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "err = %v", err)
	testx.AssertFalse(t, strings.Contains(out.String(), "worker started"), "nothing starts without a database")
}

func workerConfig() config.Config {
	return config.Config{
		Env: config.EnvProduction, LogLevel: "info", Port: 0, WorkerConcurrency: 2,
		RequestTimeout: time.Second, ShutdownTimeout: 2 * time.Second,
	}
}

// logEntry is one JSON log line of the worker.
type logEntry struct {
	Level       string `json:"level"`
	Msg         string `json:"msg"`
	Service     string `json:"service"`
	Addr        string `json:"addr"`
	Jobs        int    `json:"jobs"`
	Concurrency int    `json:"concurrency"`
	Task        string `json:"task"`
	TaskID      string `json:"task_id"`
	Retried     int    `json:"retried"`
	MaxRetry    int    `json:"max_retry"`
	Error       string `json:"error"`
}

func logEntries(t *testing.T, logs string) []logEntry {
	t.Helper()
	var out []logEntry
	for line := range strings.SplitSeq(strings.TrimSpace(logs), "\n") {
		var e logEntry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		out = append(out, e)
	}
	return out
}

func findLog(t *testing.T, logs, msgPrefix string) (logEntry, bool) {
	t.Helper()
	if strings.TrimSpace(logs) == "" {
		return logEntry{}, false
	}
	for _, e := range logEntries(t, logs) {
		if strings.HasPrefix(e.Msg, msgPrefix) {
			return e, true
		}
	}
	return logEntry{}, false
}

func findTaskLog(t *testing.T, logs, taskID string) (logEntry, bool) {
	t.Helper()
	if strings.TrimSpace(logs) == "" {
		return logEntry{}, false
	}
	for _, e := range logEntries(t, logs) {
		if e.TaskID == taskID {
			return e, true
		}
	}
	return logEntry{}, false
}

func httpGet(t *testing.T, url string) int {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode
}

// serve runs the whole worker on the fake database and the in-process
// fake Redis: the health endpoints answer, the queued tasks reach their
// handlers through the worker's retry policy and error handler, and
// cancelling the context stops everything.
func TestServe(t *testing.T) {
	tests := []struct {
		name     string
		telegram bool
		storage  bool
	}{
		{name: "telegram off, no bucket"},
		{name: "telegram on, with a bucket", telegram: true, storage: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			cfg := workerConfig()
			if tt.telegram {
				cfg.Telegram = config.Telegram{BotToken: "123456:test-token", ChatID: "-1001"}
			}
			if tt.storage {
				cfg.Storage = config.Storage{
					Endpoint: "http://127.0.0.1:1", Region: "us-east-1", Bucket: "goshop-images", AccessKey: "test", SecretKey: "test-secret",
				}
			}
			f := &fakeRedis{}
			// A scheduled job that fails with retries left, and a
			// seller message: unknown to the worker while Telegram is off.
			f.enqueue(taskMessage{
				Type: TypeCleanupOutbox, ID: "job-1", Queue: Queue, Retry: 3, Retried: 1, Timeout: 60,
			}.encode())
			f.enqueue(taskMessage{
				Type: notify.TypeSellerPaidOrder, ID: "tg-1", Queue: Queue, Retry: 5, Retried: 5, Timeout: 60,
				Payload: []byte(secretPayload),
			}.encode())
			db := newFakeSQL().on("DeletePublishedEvents", failWith(errors.New("disk full")))
			var logs syncBuffer
			logger := logging.NewService(&logs, false, "info", "worker")

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- serve(ctx, cfg, logger, db.open(t), newFakeRedis(t, f)) }()

			var listening logEntry
			waitFor(t, "the health server", func() bool {
				var ok bool
				listening, ok = findLog(t, logs.String(), "worker health listening")
				return ok
			})
			_, port, err := net.SplitHostPort(listening.Addr)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, httpGet(t, "http://127.0.0.1:"+port+"/healthz"), http.StatusOK)
			testx.AssertEqual(t, httpGet(t, "http://127.0.0.1:"+port+"/readyz"), http.StatusOK)

			waitFor(t, "both tasks to fail", func() bool {
				_, job := findTaskLog(t, logs.String(), "job-1")
				_, tg := findTaskLog(t, logs.String(), "tg-1")
				return job && tg
			})
			cancel()
			select {
			case err := <-done:
				testx.AssertNoError(t, err)
			case <-time.After(10 * time.Second):
				t.Fatal("serve did not return after cancel")
			}

			started, ok := findLog(t, logs.String(), "worker started")
			testx.AssertTrue(t, ok, "logs: %s", logs.String())
			testx.AssertEqual(t, started.Jobs, len(Schedule))
			testx.AssertEqual(t, started.Concurrency, 2)
			testx.AssertEqual(t, started.Service, "worker")
			_, off := findLog(t, logs.String(), "seller notifications are off")
			testx.AssertEqual(t, off, !tt.telegram)

			// The job failed through the worker's error handler: WARN, its
			// retry 20-22 s away (RetryDelay after one retry).
			job, _ := findTaskLog(t, logs.String(), "job-1")
			testx.AssertEqual(t, job.Level, "WARN")
			testx.AssertEqual(t, job.Msg, "task failed; it will be retried")
			testx.AssertEqual(t, job.Task, TypeCleanupOutbox)
			testx.AssertContains(t, job.Error, "deleted published outbox events: ")
			testx.AssertContains(t, job.Error, "disk full")
			retries := f.scripts("asynq:{default}:t:job-1")
			testx.AssertEqual(t, len(retries), 1)
			in := time.Until(time.Unix(retries[0][2].(int64), 0))
			testx.AssertTrue(t, in > 17*time.Second && in <= 23*time.Second, "retry in %s, want 20-22 s", in)

			// The seller message has no retry left: ERROR. Without
			// Telegram no handler takes it.
			tg, _ := findTaskLog(t, logs.String(), "tg-1")
			testx.AssertEqual(t, tg.Level, "ERROR")
			testx.AssertEqual(t, tg.Msg, "task failed for good and is in the dead-letter queue; requeue it with: worker dead-tasks requeue tg-1")
			testx.AssertEqual(t, strings.Contains(tg.Error, asynq.ErrHandlerNotFound.Error()), !tt.telegram, "error %q", tg.Error)
			if tt.telegram {
				// The seller's handler ran, and refused a payload that is
				// not an outbox event.
				testx.AssertContains(t, tg.Error, notify.TypeSellerPaidOrder+": bad payload")
			}
			testx.AssertFalse(t, strings.Contains(logs.String(), "buyer@example.com"), "a payload was logged")
		})
	}
}

func TestServe_StartErrors(t *testing.T) {
	t.Run("bad bucket endpoint", func(t *testing.T) {
		cfg := workerConfig()
		cfg.Storage = config.Storage{Endpoint: "not a url", Bucket: "goshop-images", AccessKey: "a", SecretKey: "b"}
		f := &fakeRedis{}
		err := serve(context.Background(), cfg, logx.Noop(), newFakeSQL().open(t), newFakeRedis(t, f))
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "image storage: "), "err = %v", err)
		testx.AssertEqual(t, len(f.calls), 0, "nothing started")
	})
	t.Run("port taken", func(t *testing.T) {
		var lc net.ListenConfig
		ln, err := lc.Listen(context.Background(), "tcp", ":0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		defer func() { _ = ln.Close() }()
		cfg := workerConfig()
		cfg.Port = ln.Addr().(*net.TCPAddr).Port

		done := make(chan error, 1)
		go func() {
			done <- serve(context.Background(), cfg, logx.Noop(), newFakeSQL().open(t), newFakeRedis(t, &fakeRedis{}))
		}()
		select {
		case err := <-done:
			if err == nil {
				t.Fatal("want an error, got nil")
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "listen on :"+strconv.Itoa(cfg.Port)), "err = %v", err)
		case <-time.After(10 * time.Second):
			t.Fatal("serve did not return")
		}
	})
}
