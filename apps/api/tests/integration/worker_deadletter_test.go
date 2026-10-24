//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// deadTasks runs `worker dead-tasks args…` in-process through worker.Run,
// with the environment of the test's server (its Redis database), and
// returns what it printed.
func deadTasks(t *testing.T, args ...string) string {
	t.Helper()
	var out bytes.Buffer
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	if err := worker.Run(ctx, append([]string{"dead-tasks"}, args...), &out); err != nil {
		t.Fatalf("worker dead-tasks %v: %v\n%s", args, err, out.String())
	}
	return out.String()
}

// TestDeadLetter_RetryThenRequeue: an email that keeps failing (the mail
// server answers 451) is retried its 8 times and then kept in the
// dead-letter queue, not dropped. `worker dead-tasks list` shows it
// without its payload (it holds the buyer's address); once the mail
// server is back, `worker dead-tasks requeue <id>` runs it again and the
// email goes out once; `requeue-all` empties the queue.
func TestDeadLetter_RetryThenRequeue(t *testing.T) {
	smtp := startFakeSMTP(t)
	smtp.failing.Store(true)
	sh := newShop(t, nil)
	w := startWorker(t, sh, workerOpts{mailer: smtp.mailer()})
	p := sh.product(t, "kaos-mati-surat", variant("MS-M", "M", 45000, 10))
	b := sh.buyer(t, "mati-surat")
	b2 := sh.buyer(t, "mati-surat-2")
	sh.order(t, b, line{p.Variants["MS-M"], 1})
	sh.order(t, b2, line{p.Variants["MS-M"], 1})
	w.run(t, worker.TypePublishEvents)

	var dead []*asynq.TaskInfo
	eventually(t, 60*time.Second, func() bool { dead = w.archived(t); return len(dead) == 2 },
		"the failing emails did not reach the dead-letter queue; logs:\n%s", w.logs.String())
	for _, d := range dead {
		if d.Type != notify.TypeOrderConfirmationEmail || d.Retried != 8 || !strings.Contains(d.LastErr, "451") {
			t.Errorf("dead task %s retried %d times, last error %q; want the confirmation after 8 retries", d.Type, d.Retried, d.LastErr)
		}
	}
	if smtp.total() != 0 {
		t.Fatalf("%d emails while the server refused them", smtp.total())
	}

	list := deadTasks(t, "list")
	if !strings.Contains(list, dead[0].ID) || !strings.Contains(list, dead[1].ID) || !strings.Contains(list, "2 dead tasks") ||
		!strings.Contains(list, notify.TypeOrderConfirmationEmail) {
		t.Errorf("dead-tasks list printed:\n%s", list)
	}
	if strings.Contains(list, b.Email) || strings.Contains(list, b2.Email) {
		t.Errorf("dead-tasks list printed a payload:\n%s", list)
	}

	smtp.failing.Store(false)
	if out := deadTasks(t, "requeue", dead[0].ID); !strings.Contains(out, "requeued "+dead[0].ID) {
		t.Errorf("requeue printed %q", out)
	}
	eventually(t, 30*time.Second, func() bool { return smtp.total() == 1 }, "the requeued email was not sent")
	if out := deadTasks(t, "requeue-all"); !strings.Contains(out, "requeued 1 tasks") {
		t.Errorf("requeue-all printed %q", out)
	}
	waitMails(t, smtp, b.Email, 1)
	waitMails(t, smtp, b2.Email, 1)
	waitIdle(t, w)
	if smtp.total() != 2 || len(w.archived(t)) != 0 {
		t.Errorf("%d emails and %d dead tasks after the requeues, want 2 and 0", smtp.total(), len(w.archived(t)))
	}
	if out := deadTasks(t, "list"); !strings.Contains(out, "0 dead tasks") {
		t.Errorf("dead-tasks list after the requeues:\n%s", out)
	}
}

// TestDeadLetter_PermanentErrorsSkipRetries: a task that can never work,
// an order email for an order that does not exist or a payload that does
// not decode, goes to the dead-letter queue at once instead of retrying 8
// times.
func TestDeadLetter_PermanentErrorsSkipRetries(t *testing.T) {
	sh := newShop(t, nil)
	w := startWorker(t, sh, workerOpts{})
	missing, _ := json.Marshal(notify.EventPayload{EventID: uuidx.NewV7(), Type: "order.created", AggregateID: uuidx.NewV7(), Payload: []byte(`{}`)})
	for _, payload := range [][]byte{missing, []byte(`{"bukan":`)} {
		info, err := w.client.EnqueueContext(t.Context(), asynq.NewTask(notify.TypeOrderConfirmationEmail, payload),
			asynq.Queue(worker.Queue), notify.MaxRetry(notify.TypeOrderConfirmationEmail), asynq.Retention(time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		done := w.wait(t, info.ID)
		if done.State != asynq.TaskStateArchived || done.Retried != 0 {
			t.Errorf("task with payload %s ended %s after %d retries, want archived at once", payload, done.State, done.Retried)
		}
	}
	if err := worker.Run(t.Context(), []string{"dead-tasks", "hapus"}, &bytes.Buffer{}); err == nil {
		t.Error("worker dead-tasks hapus: no error, want the usage")
	}
}
