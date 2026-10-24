//go:build integration

package integration_test

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"

	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// TestEmails_OrderLifecycleOverSMTP: each order event the outbox
// publishes becomes one email, sent by the worker over SMTP: the
// confirmation after checkout, the payment receipt after the webhook, the
// shipping notice with the tracking number. Publishing again sends none
// twice, and every delivery is recorded per event and consumer.
func TestEmails_OrderLifecycleOverSMTP(t *testing.T) {
	smtp := startFakeSMTP(t)
	ps := newPayShop(t, nil)
	w := startWorker(t, ps.shop, workerOpts{deps: workerDepsFor(ps), mailer: smtp.mailer()})
	p := ps.product(t, "kaos-surat", variant("SR-M", "M", 45000, 10))
	b := ps.buyer(t, "surat")

	o, _, poid := ps.paid(t, b, line{p.Variants["SR-M"], 2})
	w.run(t, worker.TypePublishEvents)
	waitMails(t, smtp, b.Email, 1)
	confirm := smtp.sent(b.Email)[0]
	if confirm.Subject != "Pesanan "+o.Code+" diterima" || confirm.From != "no-reply@goshop.test" ||
		!strings.Contains(confirm.Body, "x2: Rp90.000") || !strings.Contains(confirm.Body, "Total: "+rupiahText(o.Totals.Total.Amount)) {
		t.Errorf("confirmation email %+v", confirm)
	}

	assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "paid", "settlement")
	w.run(t, worker.TypePublishEvents)
	waitMails(t, smtp, b.Email, 2)
	receipt := smtp.sent(b.Email)[1]
	if receipt.Subject != "Pembayaran pesanan "+o.Code+" diterima" || !strings.Contains(receipt.Body, rupiahText(o.Totals.Total.Amount)) {
		t.Errorf("payment email %+v", receipt)
	}

	assertOrderDetail(t, ps.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/process", nil), http.StatusOK, "process")
	assertOrderDetail(t, ps.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/ship",
		map[string]string{"tracking_number": "JNE-1234567890"}), http.StatusOK, "ship")
	w.run(t, worker.TypePublishEvents)
	waitMails(t, smtp, b.Email, 3)
	shipped := smtp.sent(b.Email)[2]
	if shipped.Subject != "Pesanan "+o.Code+" dikirim" || !strings.Contains(shipped.Body, "Nomor resi: JNE-1234567890") {
		t.Errorf("shipping email %+v", shipped)
	}

	// Publishing the same events again (a dispatcher that died before its
	// commit) sends nothing twice.
	mustExec(t, ps.db, `UPDATE outbox_events SET published_at = NULL`)
	w.run(t, worker.TypePublishEvents)
	waitIdle(t, w)
	if n := len(smtp.sent(b.Email)); n != 3 {
		t.Errorf("%d emails after publishing again, want 3", n)
	}
	for _, consumer := range []string{notify.TypeOrderConfirmationEmail, notify.TypePaymentReceivedEmail, notify.TypeOrderShippedEmail} {
		if n := ps.count(t, `SELECT count(*) FROM event_deliveries WHERE consumer = $1`, consumer); n != 1 {
			t.Errorf("%d deliveries recorded for %s, want 1", n, consumer)
		}
	}
	if dead := w.archived(t); len(dead) != 0 {
		t.Errorf("dead tasks: %v", dead[0].LastErr)
	}
}

// TestEmails_APIQueuesItsEmails: with SMTP_HOST set the API does not talk
// to the mail server during a request: it queues the verification and
// reset emails in Redis, and the worker sends them.
func TestEmails_APIQueuesItsEmails(t *testing.T) {
	smtp := startFakeSMTP(t)
	sh := newShop(t, map[string]string{
		"SMTP_HOST": "127.0.0.1", "SMTP_PORT": strconv.Itoa(smtp.port()), "SMTP_FROM": "GoShop <no-reply@goshop.test>",
	})
	email := uniqueEmail("antre-surat")
	sh.register(t, email, testPassword, "Antre Surat")
	pending, err := asynq.NewInspectorFromRedisClient(sh.rdb).ListPendingTasks(worker.Queue)
	if err != nil {
		t.Fatal(err)
	}
	queued := 0
	for _, task := range pending {
		if task.Type == notify.TypeSendEmail && strings.Contains(string(task.Payload), email) {
			queued++
		}
	}
	if queued != 1 {
		t.Fatalf("%d queued emails to %s, want 1 (%d tasks pending)", queued, email, len(pending))
	}
	if len(smtp.sent(email)) != 0 {
		t.Fatal("the API sent the email itself")
	}

	startWorker(t, sh, workerOpts{mailer: smtp.mailer()})
	waitMails(t, smtp, email, 1)
	if m := smtp.sent(email)[0]; !emailTokenPattern.MatchString(m.Body) {
		t.Errorf("verification email without its token: %+v", m)
	}
	if resp := sh.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": email}, ""); resp.Status != http.StatusAccepted {
		t.Fatalf("forgot-password = %s", describe(resp))
	}
	waitMails(t, smtp, email, 2)
	reset := smtp.sent(email)[1]
	token := emailTokenPattern.FindString(reset.Body)
	if token == "" {
		t.Fatalf("reset email without a token: %+v", reset)
	}
	if resp := sh.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(token, otherPassword), ""); resp.Status != http.StatusNoContent {
		t.Errorf("reset with the emailed token = %s", describe(resp))
	}
	for line := range strings.Lines(sh.logs.String()) {
		if strings.Contains(line, token) {
			t.Errorf("the API logged the reset token: %s", line)
		}
	}
}

// TestEmails_DeletedBuyerAndLogMailer: an order email for a buyer who
// deleted the account is skipped (the task completes, nothing is sent);
// without SMTP the worker's emails go to the log.
func TestEmails_DeletedBuyerAndLogMailer(t *testing.T) {
	smtp := startFakeSMTP(t)
	sh := newShop(t, nil)
	w := startWorker(t, sh, workerOpts{mailer: smtp.mailer()})
	p := sh.product(t, "kaos-hapus-surat", variant("HS-M", "M", 45000, 10))
	gone := sh.buyer(t, "hapus-surat")
	sh.order(t, gone, line{p.Variants["HS-M"], 1})
	if resp := sh.call(t, http.MethodDelete, "/v1/me", nil, gone.Token); resp.Status != http.StatusNoContent {
		t.Fatalf("DELETE /v1/me = %s", describe(resp))
	}
	w.run(t, worker.TypePublishEvents)
	waitIdle(t, w)
	if n := smtp.total(); n != 0 {
		t.Errorf("%d emails to a deleted account", n)
	}
	if dead := w.archived(t); len(dead) != 0 {
		t.Errorf("dead tasks: %v", dead[0].LastErr)
	}

	logged := newShop(t, nil)
	lw := startWorker(t, logged, workerOpts{})
	b := logged.buyer(t, "surat-log")
	q := logged.product(t, "kaos-surat-log", variant("SL2-M", "M", 45000, 10))
	o := logged.order(t, b, line{q.Variants["SL2-M"], 1})
	lw.run(t, worker.TypePublishEvents)
	eventually(t, 30*time.Second, func() bool {
		return strings.Contains(lw.logs.String(), "Pesanan "+o.Code+" diterima")
	}, "the log mailer did not log the confirmation; logs:\n%s", lw.logs.String())
}

// workerDepsFor is the jobs' dependencies for a payShop: its gateway.
func workerDepsFor(ps *payShop) worker.JobDeps { return worker.JobDeps{Gateway: ps.gw} }

// waitMails waits until to has received n emails.
func waitMails(t *testing.T, f *fakeSMTP, to string, n int) {
	t.Helper()
	eventually(t, 30*time.Second, func() bool { return len(f.sent(to)) >= n },
		"%s received %d emails, want %d", to, len(f.sent(to)), n)
}

// waitIdle waits until no task is pending, running or waiting to retry.
func waitIdle(t *testing.T, w *taskWorker) {
	t.Helper()
	eventually(t, 30*time.Second, func() bool {
		for _, state := range w.taskIDs(t) {
			if state == asynq.TaskStatePending || state == asynq.TaskStateActive || state == asynq.TaskStateRetry {
				return false
			}
		}
		return true
	}, "the queue did not drain; logs:\n%s", w.logs.String())
}

// rupiahText writes 117000 as Rp117.000, like the emails.
func rupiahText(amount int64) string {
	s := strconv.FormatInt(amount, 10)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	return "Rp" + b.String()
}
