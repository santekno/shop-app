//go:build integration

package integration_test

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// TestE2E_CheckoutPayEmailWithTheWorker runs the whole Bab 6 flow across
// both programs, each configured only by the environment, as Docker
// Compose runs them: the API in-process (app.New and Serve, fake payment
// gateway in Redis, SMTP on), and the worker program itself (worker.Run:
// its Asynq server, its scheduler and its health endpoints) on the same
// database and Redis. A buyer checks out, starts paying, and `api
// fake-pay` plays Midtrans; the scheduler's outbox tick turns order.created
// and order.paid into tasks, and the worker sends the confirmation and the
// payment receipt over SMTP, once each, however many ticks pass.
func TestE2E_CheckoutPayEmailWithTheWorker(t *testing.T) {
	smtp := startFakeSMTP(t)
	sh := newShop(t, map[string]string{
		"APP_PAYMENT_PROVIDER": "fake",
		"SMTP_HOST":            "127.0.0.1", "SMTP_PORT": strconv.Itoa(smtp.port()), "SMTP_FROM": "GoShop <no-reply@goshop.test>",
		"APP_SHUTDOWN_TIMEOUT": "5s",
	})

	// The worker program, on its own health port.
	healthPort := freePort(t)
	t.Setenv("APP_PORT", strconv.Itoa(healthPort))
	logs := &syncBuffer{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx, nil, logs) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("worker.Run returned %v after shutdown, want nil\n%s", err, logs.String())
			}
		case <-time.After(30 * time.Second):
			t.Errorf("the worker did not stop\n%s", logs.String())
		}
	})
	health := "http://127.0.0.1:" + strconv.Itoa(healthPort)
	client := &http.Client{Timeout: 2 * time.Second}
	eventually(t, 30*time.Second, func() bool {
		r, err := tryRequest(client, http.MethodGet, health+"/readyz", nil)
		return err == nil && r.Status == http.StatusOK
	}, "the worker's /readyz never answered 200; logs:\n%s", logs.String())
	if r := doRequest(t, client, http.MethodGet, health+"/healthz", nil); r.Status != http.StatusOK {
		t.Errorf("worker /healthz = %d", r.Status)
	}
	if !strings.Contains(logs.String(), "worker started") || !strings.Contains(logs.String(), "jobs="+strconv.Itoa(len(worker.Schedule))) {
		t.Errorf("the worker did not log its start with every job:\n%s", logs.String())
	}

	// Checkout → pay → Midtrans (the fake) settles → the webhook.
	p := sh.product(t, "kaos-ujung-ke-ujung", variant("UU-M", "M", 75000, 10))
	b := sh.buyer(t, "ujung")
	o := sh.order(t, b, line{p.Variants["UU-M"], 1})
	pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
	if out, err := fakePay(t, sh.server, o.Code); err != nil {
		t.Fatalf("api fake-pay: %v\n%s", err, out)
	}
	if sh.orderStatus(t, o.ID) != "paid" || sh.paymentRow(t, pay.ID).Status != "paid" {
		t.Fatalf("order %s after the settlement, want paid", sh.orderStatus(t, o.ID))
	}
	sh.assertEvents(t, o.ID, "order.created", "order.paid")

	// The scheduler publishes every 5 seconds. The buyer also got the
	// verification email the API queued at registration.
	orderMails := func() []string {
		var subjects []string
		for _, m := range smtp.sent(b.Email) {
			if strings.Contains(m.Subject, o.Code) {
				subjects = append(subjects, m.Subject)
			}
		}
		return subjects
	}
	eventually(t, 60*time.Second, func() bool { return len(orderMails()) >= 2 },
		"the buyer got order emails %v, want 2; worker logs:\n%s", orderMails(), logs.String())
	subjects := strings.Join(orderMails(), "|")
	if !strings.Contains(subjects, "Pesanan "+o.Code+" diterima") || !strings.Contains(subjects, "Pembayaran pesanan "+o.Code+" diterima") {
		t.Errorf("order emails %s, want the confirmation and the payment receipt", subjects)
	}
	eventually(t, 30*time.Second, func() bool {
		return sh.count(t, `SELECT count(*) FROM outbox_events WHERE published_at IS NULL`) == 0
	}, "the outbox was not published")

	// Two more ticks: nothing is sent again.
	time.Sleep(11 * time.Second)
	if got := orderMails(); len(got) != 2 {
		t.Errorf("order emails after more ticks %v, want 2", got)
	}
	for _, consumer := range []string{notify.TypeOrderConfirmationEmail, notify.TypePaymentReceivedEmail} {
		if n := sh.count(t, `SELECT count(*) FROM event_deliveries WHERE consumer = $1`, consumer); n != 1 {
			t.Errorf("%d deliveries of %s, want 1", n, consumer)
		}
	}
	// The API's own emails (the admin's and the buyer's verification)
	// went out through the same queue.
	if smtp.total() != 4 {
		t.Errorf("%d emails in all, want 4: two verifications and two order emails", smtp.total())
	}
	for _, bad := range []string{"ERROR", "40P01", "deadlock"} {
		if strings.Contains(logs.String(), bad) {
			t.Errorf("the worker logged %q:\n%s", bad, logs.String())
		}
	}
	assertNoServerErrors(t, sh.server)
}
