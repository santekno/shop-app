//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// fakePay runs `api fake-pay args…` in-process, against the API the test
// started (APP_PORT is its port), and returns the error and the logs.
func fakePay(t *testing.T, s *server, args ...string) (string, error) {
	t.Helper()
	u, err := url.Parse(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("APP_PORT", u.Port())
	var out bytes.Buffer
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	err = app.Run(ctx, append([]string{"fake-pay"}, args...), &out)
	return out.String(), err
}

// TestFakePay_Command: with APP_PAYMENT_PROVIDER=fake a developer pays an
// order with `api fake-pay <order code>` (make fake-pay): the command
// sets the fake transaction's status and sends the signed notification to
// the running API, which handles it like Midtrans' (signature, status
// call, guarded transitions). A payment's own order_id and other statuses
// work too; an order without an open payment is refused.
func TestFakePay_Command(t *testing.T) {
	sh := newShop(t, map[string]string{"APP_PAYMENT_PROVIDER": "fake"})
	p := sh.product(t, "kaos-bayar-palsu", variant("BPL-M", "M", 45000, 10))
	b := sh.buyer(t, "bayar-palsu")

	o := sh.order(t, b, line{p.Variants["BPL-M"], 1})
	if _, err := fakePay(t, sh.server, o.Code); err == nil || !strings.Contains(err.Error(), "has no open payment") {
		t.Errorf("fake-pay before pay: %v, want 'has no open payment'", err)
	}
	pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
	logs, err := fakePay(t, sh.server, o.Code)
	if err != nil {
		t.Fatalf("fake-pay %s: %v\n%s", o.Code, err, logs)
	}
	if !strings.Contains(logs, "fake payment notification sent") || !strings.Contains(logs, "answer=200") {
		t.Errorf("fake-pay logged:\n%s", logs)
	}
	if sh.orderStatus(t, o.ID) != "paid" || sh.paymentRow(t, pay.ID).Status != "paid" {
		t.Errorf("order %s after fake-pay, want paid", sh.orderStatus(t, o.ID))
	}
	if got := sh.paymentEvents(t, pay.ID); len(got) != 1 || got[0] != "webhook:settlement:paid" {
		t.Errorf("payment events %v", got)
	}

	other := sh.order(t, b, line{p.Variants["BPL-M"], 2})
	pay2 := assertPaymentSession(t, sh.pay(t, b.Token, other.ID), http.StatusCreated, "pay")
	if _, err := fakePay(t, sh.server, sh.providerOrderID(t, pay2.ID), "expire"); err != nil {
		t.Fatalf("fake-pay <order_id> expire: %v", err)
	}
	if sh.orderStatus(t, other.ID) != "cancelled" || sh.paymentRow(t, pay2.ID).Status != "expired" {
		t.Errorf("order %s and payment %s after an expire, want cancelled and expired",
			sh.orderStatus(t, other.ID), sh.paymentRow(t, pay2.ID).Status)
	}
	if _, err := fakePay(t, sh.server, o.Code, "dibayar"); err == nil {
		t.Error("fake-pay with an unknown status: no error")
	}
}

// TestFakePay_RefusedWhereItMustNotRun: fake-pay needs the fake gateway,
// and the API and the worker refuse to start with the fake in production.
func TestFakePay_RefusedWhereItMustNotRun(t *testing.T) {
	sh := newShop(t, nil)
	if _, err := fakePay(t, sh.server, "GS-20261024-AAAAAA"); err == nil || !strings.Contains(err.Error(), "APP_PAYMENT_PROVIDER=fake") {
		t.Errorf("fake-pay with Midtrans configured: %v, want it refused", err)
	}

	setEnv(t, map[string]string{
		"APP_ENV": config.EnvProduction, "APP_PAYMENT_PROVIDER": "fake", "DATABASE_URL": sh.dbURL,
	})
	for name, run := range map[string]func(context.Context, []string, *bytes.Buffer) error{
		"api":    func(ctx context.Context, args []string, out *bytes.Buffer) error { return app.Run(ctx, args, out) },
		"worker": func(ctx context.Context, args []string, out *bytes.Buffer) error { return worker.Run(ctx, args, out) },
	} {
		var out bytes.Buffer
		ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
		err := run(ctx, nil, &out)
		cancel()
		if err == nil || !strings.Contains(err.Error(), "APP_PAYMENT_PROVIDER") {
			t.Errorf("%s with the fake gateway in production: %v, want it refused at start", name, err)
		}
	}
}
