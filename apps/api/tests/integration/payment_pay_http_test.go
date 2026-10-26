//go:build integration

package integration_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
)

// TestPay_CreatedThenReused: POST /v1/orders/{id}/pay creates a payment
// for the order's total (201), and every later call answers the same
// open payment (200) instead of creating another. Snap stops at least a
// minute before the order's deadline. Another buyer's order, an id that
// is not a UUID and a missing token are refused, and write nothing.
func TestPay_CreatedThenReused(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-bayar", variant("BY-M", "M", 45000, 10))
	b := ps.buyer(t, "bayar")
	o := ps.order(t, b, line{p.Variants["BY-M"], 2})

	first := assertPaymentSession(t, ps.pay(t, b.Token, o.ID), http.StatusCreated, "first pay")
	if first.OrderID != o.ID || first.Amount != o.Totals.Total || first.Provider != "fake" ||
		first.Status != "pending" || first.ClientKey != fake.ClientKey {
		t.Errorf("payment %+v, want the order's total %d through the fake gateway", first, o.Totals.Total.Amount)
	}
	if !first.ExpiresAt.After(first.CreatedAt) || first.ExpiresAt.After(o.PaymentExpiresAt.Add(-time.Minute)) ||
		first.ExpiresAt.Before(o.PaymentExpiresAt.Add(-2*time.Minute)) {
		t.Errorf("Snap expires at %s, want one to two minutes before the order's deadline %s", first.ExpiresAt, o.PaymentExpiresAt)
	}
	if first.ExpiresAt.Sub(first.CreatedAt)%time.Minute != 0 {
		t.Errorf("Snap runs %s, want whole minutes", first.ExpiresAt.Sub(first.CreatedAt))
	}

	again := assertPaymentSession(t, ps.pay(t, b.Token, o.ID), http.StatusOK, "second pay")
	if again.ID != first.ID || again.Token != first.Token || again.RedirectURL != first.RedirectURL {
		t.Errorf("second pay answered %+v, want the open payment %+v again", again, first)
	}
	if n := ps.count(t, `SELECT count(*) FROM payments WHERE order_id = $1 AND status = 'pending' AND amount = $2 AND provider = 'fake'`,
		o.ID, o.Totals.Total.Amount); n != 1 {
		t.Errorf("%d pending payments of the order's total, want 1", n)
	}
	poid := ps.providerOrderID(t, first.ID)
	if !strings.HasPrefix(poid, o.Code+"-") || len(poid) != len(o.Code)+7 {
		t.Errorf("provider order_id %q, want %s-<6 characters>", poid, o.Code)
	}

	other := ps.buyer(t, "bayar-lain")
	assertError(t, ps.pay(t, other.Token, o.ID), http.StatusNotFound, "NOT_FOUND")
	assertError(t, ps.pay(t, b.Token, "bukan-uuid"), http.StatusNotFound, "NOT_FOUND")
	assertError(t, ps.pay(t, b.Token, uuidx.NewV7()), http.StatusNotFound, "NOT_FOUND")
	assertError(t, ps.pay(t, "", o.ID), http.StatusUnauthorized, "UNAUTHORIZED")
	if n := ps.count(t, `SELECT count(*) FROM payments`); n != 1 {
		t.Errorf("%d payments after the refused calls, want 1", n)
	}
	assertNoServerErrors(t, ps.server)
}

// TestPay_NotPayable: an order that is not waiting for payment (paid,
// cancelled) is 409 INVALID_TRANSITION with its status in the details,
// and gets no payment.
func TestPay_NotPayable(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-tak-bayar", variant("TB2-M", "M", 20000, 10))
	b := ps.buyer(t, "tak-bayar")

	paid := ps.order(t, b, line{p.Variants["TB2-M"], 1})
	ps.markPaid(t, paid.ID)
	cancelled := ps.order(t, b, line{p.Variants["TB2-M"], 1})
	assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+cancelled.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")

	for id, status := range map[string]string{paid.ID: "paid", cancelled.ID: "cancelled"} {
		details := assertError(t, ps.pay(t, b.Token, id), http.StatusConflict, "INVALID_TRANSITION")
		if details["status"] != status || details["to"] != "paid" {
			t.Errorf("pay a %s order: details %v, want status %s and to paid", status, details, status)
		}
	}
	if n := ps.count(t, `SELECT count(*) FROM payments`); n != 0 {
		t.Errorf("%d payments, want none", n)
	}
	assertNoServerErrors(t, ps.server)
}

// TestPay_WindowClosed: with less than two minutes to the order's
// deadline, Snap would get under a minute: 409 PAYMENT_WINDOW_CLOSED and
// no payment. Three minutes left is enough for a one-minute Snap that
// ends before the deadline's last minute.
func TestPay_WindowClosed(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-jendela", variant("JD-M", "M", 20000, 10))
	b := ps.buyer(t, "jendela")
	o := ps.order(t, b, line{p.Variants["JD-M"], 1})

	mustExec(t, ps.db, `UPDATE orders SET payment_expires_at = $2 WHERE id = $1`, o.ID, time.Now().Add(90*time.Second))
	assertError(t, ps.pay(t, b.Token, o.ID), http.StatusConflict, "PAYMENT_WINDOW_CLOSED")
	if n := ps.count(t, `SELECT count(*) FROM payments`); n != 0 {
		t.Fatalf("%d payments after a closed window, want none", n)
	}

	deadline := time.Now().Add(3*time.Minute + 30*time.Second)
	mustExec(t, ps.db, `UPDATE orders SET payment_expires_at = $2 WHERE id = $1`, o.ID, deadline)
	pay := assertPaymentSession(t, ps.pay(t, b.Token, o.ID), http.StatusCreated, "pay with 3.5 minutes left")
	if pay.ExpiresAt.After(deadline.Add(-time.Minute)) {
		t.Errorf("Snap expires at %s, past a minute before the deadline %s", pay.ExpiresAt, deadline)
	}
	assertNoServerErrors(t, ps.server)
}

// TestPay_NewPaymentAfterDenied: a payment that ends without money
// (deny) leaves the order waiting, and paying again creates a new payment
// with a new gateway order_id, while the closed one stays as it was.
func TestPay_NewPaymentAfterDenied(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-ditolak", variant("DT-M", "M", 30000, 10))
	b := ps.buyer(t, "ditolak")
	o, first, poid := ps.paid(t, b, line{p.Variants["DT-M"], 1})

	assertOutcome(t, ps.gatewaySays(t, poid, "deny", ""), "recorded", "deny")
	if got := ps.paymentRow(t, first.ID).Status; got != "denied" {
		t.Fatalf("payment %s after deny, want denied", got)
	}
	second := assertPaymentSession(t, ps.pay(t, b.Token, o.ID), http.StatusCreated, "pay after deny")
	if second.ID == first.ID || ps.providerOrderID(t, second.ID) == poid {
		t.Errorf("pay after deny reused payment %s (%s)", first.ID, poid)
	}
	if ps.orderStatus(t, o.ID) != "pending_payment" || ps.openPayments(t, o.ID) != 1 {
		t.Errorf("order %s with %d open payments, want pending_payment with 1", ps.orderStatus(t, o.ID), ps.openPayments(t, o.ID))
	}
	assertNoServerErrors(t, ps.server)
}

// TestPay_Disabled: without MIDTRANS_SERVER_KEY both payment routes answer
// 503 PAYMENTS_DISABLED. The configuration chose it, so the API warns
// once at start and logs each refusal at WARN, never at ERROR, and
// nothing is written.
func TestPay_Disabled(t *testing.T) {
	sh := newShop(t, map[string]string{"MIDTRANS_SERVER_KEY": "", "MIDTRANS_CLIENT_KEY": ""})
	p := sh.product(t, "kaos-mati", variant("MT-M", "M", 20000, 10))
	b := sh.buyer(t, "mati")
	o := sh.order(t, b, line{p.Variants["MT-M"], 1})

	assertError(t, sh.pay(t, b.Token, o.ID), http.StatusServiceUnavailable, "PAYMENTS_DISABLED")
	n := fake.Notification(o.Code+"-AAAAAA", "200", rupiahAmount(o.Totals.Total.Amount))
	assertError(t, sh.notify(t, n), http.StatusServiceUnavailable, "PAYMENTS_DISABLED")
	if c := sh.count(t, `SELECT count(*) FROM payments`); c != 0 {
		t.Errorf("%d payments with payments off", c)
	}
	assertLogged(t, sh.server, "WARN", "payments are off: MIDTRANS_SERVER_KEY is not set")
	assertLogged(t, sh.server, "WARN", "request refused: switched off by configuration", "PAYMENTS_DISABLED", "/pay")
	assertLogged(t, sh.server, "WARN", "request refused: switched off by configuration", "PAYMENTS_DISABLED", "/payments/midtrans/notification")
	assertNoErrorLog(t, sh.server)
}

// TestPay_ThroughMidtransSnap pays through the real Midtrans client
// against a fake Midtrans: Snap is asked for the order's total under the
// payment's own order_id, with an expiry in whole minutes starting now in
// WIB, authenticated with the server key; the answer carries the sandbox
// client key for Snap.js.
func TestPay_ThroughMidtransSnap(t *testing.T) {
	sh, mt := midtransShop(t, nil)
	p := sh.product(t, "kaos-snap", variant("SN-M", "M", 55000, 10))
	b := sh.buyer(t, "snap")
	o := sh.order(t, b, line{p.Variants["SN-M"], 1})

	pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay through Snap")
	if pay.Provider != "midtrans" || pay.ClientKey != sandboxClientKey || !strings.HasPrefix(pay.Token, "snap-") ||
		!strings.HasPrefix(pay.RedirectURL, "https://app.sandbox.midtrans.com/snap/") {
		t.Errorf("payment %+v, want Midtrans' token, redirect and the sandbox client key", pay)
	}
	reqs := mt.snapRequests()
	if len(reqs) != 1 {
		t.Fatalf("Snap got %d requests, want 1", len(reqs))
	}
	details, _ := reqs[0]["transaction_details"].(map[string]any)
	expiry, _ := reqs[0]["expiry"].(map[string]any)
	if details["order_id"] != sh.providerOrderID(t, pay.ID) || details["gross_amount"] != float64(o.Totals.Total.Amount) {
		t.Errorf("Snap transaction_details %v, want the payment's order_id and the total %d", details, o.Totals.Total.Amount)
	}
	minutes, _ := expiry["duration"].(float64)
	start, err := time.Parse("2006-01-02 15:04:05 -0700", expiry["start_time"].(string))
	if expiry["unit"] != "minute" || err != nil || !strings.HasSuffix(expiry["start_time"].(string), "+0700") ||
		!start.Add(time.Duration(minutes)*time.Minute).Equal(pay.ExpiresAt.Truncate(time.Second)) {
		t.Errorf("Snap expiry %v (start %v), want minutes from now in WIB ending at %s", expiry, err, pay.ExpiresAt)
	}
	if len(reqs[0]) != 2 {
		t.Errorf("Snap request %v, want only transaction_details and expiry", reqs[0])
	}
	assertNoServerErrors(t, sh.server)
}

// TestPay_MidtransUnreachable: Snap that does not answer is 503
// UPSTREAM_UNAVAILABLE, and no payment is stored.
func TestPay_MidtransUnreachable(t *testing.T) {
	gw := midtrans.New(sandboxServerKey, sandboxClientKey, 2*time.Second,
		midtrans.WithBaseURLs("http://"+closedAddr(t), "http://"+closedAddr(t)))
	sh := newShop(t, nil, app.WithPaymentGateway(gw))
	p := sh.product(t, "kaos-putus", variant("PT-M", "M", 20000, 10))
	b := sh.buyer(t, "putus")
	o := sh.order(t, b, line{p.Variants["PT-M"], 1})
	assertError(t, sh.pay(t, b.Token, o.ID), http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE")
	if n := sh.count(t, `SELECT count(*) FROM payments`); n != 0 {
		t.Errorf("%d payments after Snap failed, want none", n)
	}
}

// TestPay_RateLimitPerBuyer runs the real Redis limiter: a buyer may ask
// for a payment page 10 times a minute, whatever the answer; the 11th is
// 429, and another buyer is not affected.
func TestPay_RateLimitPerBuyer(t *testing.T) {
	sh := staffShop(t, nil, app.WithPaymentGateway(fake.New(fake.NewMemoryStore())))
	p := sh.product(t, "kaos-batas-pay", variant("BP-M", "M", 20000, 10))
	b, other := sh.buyer(t, "batas-pay"), sh.buyer(t, "batas-pay-lain")
	o := sh.order(t, b, line{p.Variants["BP-M"], 1})
	exhaust(t, payment.LimitPayPerBuyer, func(i int) response {
		if i%2 == 0 {
			return sh.pay(t, b.Token, o.ID)
		}
		return sh.pay(t, b.Token, uuidx.NewV7())
	})
	sh.assertCounter(t, payment.LimitPayPerBuyer)
	o2 := sh.order(t, other, line{p.Variants["BP-M"], 1})
	assertPaymentSession(t, sh.pay(t, other.Token, o2.ID), http.StatusCreated, "another buyer")
}
