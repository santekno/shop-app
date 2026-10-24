//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
)

// TestNotification_StatusOutcomes sends each status Midtrans can report,
// through the real webhook, for a fresh order each: the answer's outcome,
// the payment's and the order's status, the stock, the outbox events and
// the payment_events row are what ADR 0007's table says.
func TestNotification_StatusOutcomes(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-notif", variant("NF-M", "M", 25000, 1000))
	v := p.Variants["NF-M"]

	tests := []struct {
		name          string
		before        []string // statuses the gateway reported earlier, each notified
		status, fraud string
		outcome       string
		payment       string
		order         string
		events        []string
		stockBack     bool
	}{
		{name: "settlement", status: "settlement", outcome: "paid", payment: "paid", order: "paid",
			events: []string{"order.created", "order.paid"}},
		{name: "capture accepted", status: "capture", fraud: "accept", outcome: "paid", payment: "paid", order: "paid",
			events: []string{"order.created", "order.paid"}},
		{name: "capture challenged", status: "capture", fraud: "challenge", outcome: "recorded", payment: "challenge",
			order: "pending_payment", events: []string{"order.created"}},
		{name: "capture denied by the fraud check", status: "capture", fraud: "deny", outcome: "recorded", payment: "denied",
			order: "pending_payment", events: []string{"order.created"}},
		{name: "pending", status: "pending", outcome: "recorded", payment: "pending", order: "pending_payment",
			events: []string{"order.created"}},
		{name: "deny", status: "deny", outcome: "recorded", payment: "denied", order: "pending_payment",
			events: []string{"order.created"}},
		{name: "cancel", status: "cancel", outcome: "recorded", payment: "cancelled", order: "pending_payment",
			events: []string{"order.created"}},
		{name: "failure", status: "failure", outcome: "recorded", payment: "failed", order: "pending_payment",
			events: []string{"order.created"}},
		{name: "expire", status: "expire", outcome: "order_cancelled", payment: "expired", order: "cancelled",
			events: []string{"order.created", "order.cancelled"}, stockBack: true},
		{name: "challenge then accepted", before: []string{"capture/challenge"}, status: "capture", fraud: "accept",
			outcome: "paid", payment: "paid", order: "paid", events: []string{"order.created", "order.paid"}},
		{name: "refund after settlement", before: []string{"settlement"}, status: "refund", outcome: "recorded",
			payment: "refunded", order: "paid", events: []string{"order.created", "order.paid"}},
		{name: "partial refund after settlement", before: []string{"settlement"}, status: "partial_refund",
			outcome: "recorded", payment: "partially_refunded", order: "paid", events: []string{"order.created", "order.paid"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// A buyer each: at most 5 unpaid orders per buyer.
			b := ps.buyer(t, "notif")
			stock := ps.stock(t, v)
			o, pay, poid := ps.paid(t, b, line{v, 2})
			for _, st := range tc.before {
				status, fraud, _ := strings.Cut(st, "/")
				if r := ps.gatewaySays(t, poid, status, fraud); r.Status != http.StatusOK {
					t.Fatalf("earlier %s: %s", st, describe(r))
				}
			}
			assertOutcome(t, ps.gatewaySays(t, poid, tc.status, tc.fraud), tc.outcome, tc.name)

			row := ps.paymentRow(t, pay.ID)
			wantProvider := tc.status
			if tc.payment == "pending" {
				wantProvider = "" // pending → pending is no move: the row is not written
			}
			if row.Status != tc.payment || row.ProviderStatus != wantProvider || row.RefundRequired {
				t.Errorf("payment %+v, want %s from provider status %s, no refund flag", row, tc.payment, tc.status)
			}
			if row.Paid != slices.Contains([]string{"paid", "refunded", "partially_refunded"}, tc.payment) {
				t.Errorf("payment paid_at set = %v for %s", row.Paid, tc.payment)
			}
			if got := ps.orderStatus(t, o.ID); got != tc.order {
				t.Errorf("order %s, want %s", got, tc.order)
			}
			ps.assertEvents(t, o.ID, tc.events...)
			if want := stock - 2 + map[bool]int{true: 2}[tc.stockBack]; ps.stock(t, v) != want {
				t.Errorf("stock %d, want %d", ps.stock(t, v), want)
			}
			events := ps.paymentEvents(t, pay.ID)
			if len(events) != len(tc.before)+1 || events[len(events)-1] != "webhook:"+tc.status+":"+tc.outcome {
				t.Errorf("payment events %v, want %d ending with webhook:%s:%s", events, len(tc.before)+1, tc.status, tc.outcome)
			}
			if tc.order == "paid" {
				detail := assertOrderDetail(t, ps.call(t, http.MethodGet, "/v1/orders/"+o.ID, nil, b.Token), http.StatusOK, "order")
				if detail.PaidAt == nil {
					t.Error("a paid order without paid_at")
				}
			}
			if tc.order == "cancelled" {
				if n := ps.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND cancel_reason = 'payment_expired'`, o.ID); n != 1 {
					t.Error("the order is not cancelled with payment_expired")
				}
			}
		})
	}
	assertNoServerErrors(t, ps.server)
}

// TestNotification_Signature: a notification whose signature_key is not
// SHA-512(order_id + status_code + gross_amount + server key) is 403
// INVALID_SIGNATURE and reads nothing: a tampered amount or status, a key
// signed by someone else, an empty-looking one. The comparison ignores
// case, as Midtrans' hex does.
func TestNotification_Signature(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-tanda", variant("TD-M", "M", 25000, 10))
	b := ps.buyer(t, "tanda")
	o, pay, poid := ps.paid(t, b, line{p.Variants["TD-M"], 1})
	good := ps.notification(t, poid, "settlement", "")

	tampered := []payment.Notification{
		{OrderID: good.OrderID, StatusCode: good.StatusCode, GrossAmount: "1.00", SignatureKey: good.SignatureKey},
		{OrderID: good.OrderID, StatusCode: "201", GrossAmount: good.GrossAmount, SignatureKey: good.SignatureKey},
		{OrderID: good.OrderID, StatusCode: good.StatusCode, GrossAmount: good.GrossAmount,
			SignatureKey: midtrans.Signature("SB-Mid-server-other", good.OrderID, good.StatusCode, good.GrossAmount)},
		{OrderID: good.OrderID, StatusCode: good.StatusCode, GrossAmount: good.GrossAmount, SignatureKey: strings.Repeat("0", 128)},
		{OrderID: good.OrderID, StatusCode: good.StatusCode, GrossAmount: good.GrossAmount, SignatureKey: "x"},
	}
	for i, n := range tampered {
		assertError(t, ps.notify(t, n), http.StatusForbidden, "INVALID_SIGNATURE")
		if ps.paymentRow(t, pay.ID).Status != "pending" || ps.orderStatus(t, o.ID) != "pending_payment" {
			t.Fatalf("tampered notification %d changed the payment or the order", i)
		}
	}
	if n := ps.count(t, `SELECT count(*) FROM payment_events`); n != 0 {
		t.Errorf("%d payment events after refused notifications", n)
	}

	upper := good
	upper.SignatureKey = strings.ToUpper(good.SignatureKey)
	assertOutcome(t, ps.notify(t, upper), "paid", "upper-case signature")
	assertNoServerErrors(t, ps.server)
}

// TestNotification_UnknownAndUnstarted: a correctly signed notification
// about an order_id GoShop never created is 404 NOT_FOUND; one about a
// transaction the status API does not know yet is 503
// UPSTREAM_UNAVAILABLE, so Midtrans sends it again, and changes nothing.
func TestNotification_UnknownAndUnstarted(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-asing", variant("AS-M", "M", 25000, 10))
	b := ps.buyer(t, "asing")
	o, pay, poid := ps.paid(t, b, line{p.Variants["AS-M"], 1})

	assertError(t, ps.notify(t, fake.Notification("GS-20260101-AAAAAA-BBBBBB", "200", "1000.00")), http.StatusNotFound, "NOT_FOUND")
	// Signed, but the buyer never chose how to pay: the fake has no status.
	assertError(t, ps.notify(t, fake.Notification(poid, "201", rupiahAmount(o.Totals.Total.Amount))),
		http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE")
	if ps.paymentRow(t, pay.ID).Status != "pending" || len(ps.paymentEvents(t, pay.ID)) != 0 {
		t.Errorf("a notification for an unstarted transaction changed the payment")
	}
}

// TestNotification_StatusAPISignatureMismatch: the status answer must be
// signed with the server key too. One that is not is not Midtrans': 503
// UPSTREAM_UNAVAILABLE, nothing recorded or changed, and the reconciler
// treats it the same (a failed check, asked again next run).
func TestNotification_StatusAPISignatureMismatch(t *testing.T) {
	sh, mt := midtransShop(t, nil)
	p := sh.product(t, "kaos-palsu", variant("PL-M", "M", 25000, 10))
	b := sh.buyer(t, "palsu")
	o := sh.order(t, b, line{p.Variants["PL-M"], 1})
	pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
	poid := sh.providerOrderID(t, pay.ID)

	mt.set(poid, "settlement", "", rupiahAmount(o.Totals.Total.Amount))
	mt.mu.Lock()
	mt.badSignature = true
	mt.mu.Unlock()
	assertError(t, sh.notify(t, mt.notification(poid)), http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE")
	if sh.paymentRow(t, pay.ID).Status != "pending" || sh.orderStatus(t, o.ID) != "pending_payment" ||
		sh.count(t, `SELECT count(*) FROM payment_events`) != 0 {
		t.Errorf("an unsigned status answer changed something")
	}

	mt.mu.Lock()
	mt.badSignature = false
	mt.mu.Unlock()
	assertOutcome(t, sh.notify(t, mt.notification(poid)), "paid", "after Midtrans signs again")
	if mt.calls() != 2 {
		t.Errorf("%d status calls, want one per notification (2)", mt.calls())
	}
}

// TestNotification_AmountMismatch: the status API reports another amount
// than the payment's (the order's total), or one that is not whole
// rupiah: nothing changes, the answer is recorded with outcome
// amount_mismatch, and the API logs it at ERROR for an operator.
func TestNotification_AmountMismatch(t *testing.T) {
	sh, mt := midtransShop(t, nil)
	p := sh.product(t, "kaos-selisih", variant("SL-M", "M", 25000, 10))
	b := sh.buyer(t, "selisih")
	o := sh.order(t, b, line{p.Variants["SL-M"], 1})
	pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
	poid := sh.providerOrderID(t, pay.ID)

	for i, amount := range []string{rupiahAmount(o.Totals.Total.Amount - 1000), fmt.Sprintf("%d.50", o.Totals.Total.Amount)} {
		mt.set(poid, "settlement", "", amount)
		// A different transaction id per answer, so each is a new event.
		mt.mu.Lock()
		mt.statuses[poid]["transaction_id"] = fmt.Sprintf("mt-mismatch-%d", i)
		mt.mu.Unlock()
		assertOutcome(t, sh.notify(t, mt.notification(poid)), "amount_mismatch", "amount "+amount)
	}
	row := sh.paymentRow(t, pay.ID)
	if row.Status != "pending" || row.Paid || sh.orderStatus(t, o.ID) != "pending_payment" {
		t.Errorf("payment %+v, order %s; want nothing changed", row, sh.orderStatus(t, o.ID))
	}
	sh.assertEvents(t, o.ID, "order.created")
	if got := sh.paymentEvents(t, pay.ID); !slices.Equal(got, []string{"webhook:settlement:amount_mismatch", "webhook:settlement:amount_mismatch"}) {
		t.Errorf("payment events %v, want two amount_mismatch records", got)
	}
	if n := sh.count(t, `SELECT count(*) FROM payment_events WHERE payment_id = $1 AND gross_amount IS NULL`, pay.ID); n != 1 {
		t.Errorf("%d events without an amount, want 1 (the .50 that is not whole rupiah)", n)
	}
	assertLogged(t, sh.server, "ERROR", "payment amount does not match the order; nothing changed", pay.ID)
	for line := range strings.Lines(sh.logs.String()) {
		if strings.Contains(line, sandboxServerKey) || strings.Contains(line, "signature_key") {
			t.Errorf("a log line carries the server key or a signature: %s", line)
		}
	}

	// The right amount still pays it.
	mt.set(poid, "settlement", "", rupiahAmount(o.Totals.Total.Amount))
	assertOutcome(t, sh.notify(t, mt.notification(poid)), "paid", "the right amount")
}

// TestNotification_DuplicateAndOutOfOrder: Midtrans may send a
// notification many times, and an older one after a newer one. The same
// status is recorded once (duplicate after that), and an old pending
// notification after the settlement only makes GoShop read the current
// status again: one order.paid, one event, nothing moves backwards.
func TestNotification_DuplicateAndOutOfOrder(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-ganda", variant("GD-M", "M", 25000, 10))
	b := ps.buyer(t, "ganda")
	o, pay, poid := ps.paid(t, b, line{p.Variants["GD-M"], 1})

	pending := ps.notification(t, poid, "pending", "")
	assertOutcome(t, ps.notify(t, pending), "recorded", "pending")
	settled := ps.notification(t, poid, "settlement", "")
	assertOutcome(t, ps.notify(t, settled), "paid", "settlement")
	for i := range 3 {
		assertOutcome(t, ps.notify(t, settled), "duplicate", fmt.Sprintf("settlement again (%d)", i))
	}
	assertOutcome(t, ps.notify(t, pending), "duplicate", "the old pending notification, late")

	if row := ps.paymentRow(t, pay.ID); row.Status != "paid" {
		t.Errorf("payment %s, want paid", row.Status)
	}
	ps.assertEvents(t, o.ID, "order.created", "order.paid")
	if got := ps.paymentEvents(t, pay.ID); !slices.Equal(got, []string{"webhook:pending:recorded", "webhook:settlement:paid"}) {
		t.Errorf("payment events %v, want one per distinct status", got)
	}
	assertNoServerErrors(t, ps.server)
}

// TestNotification_LatePaymentRefundRequired: money that arrives for an
// order that can no longer take it (the buyer cancelled it, or it
// expired) is recorded, never ignored and never reviving the order: the
// payment moves cancelled → paid or expired → paid, is flagged
// refund_required, and a WARN tells the operator.
func TestNotification_LatePaymentRefundRequired(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-telat", variant("TL-M", "M", 25000, 100))
	v := p.Variants["TL-M"]
	b := ps.buyer(t, "telat")

	t.Run("after the buyer cancelled", func(t *testing.T) {
		o, pay, poid := ps.paid(t, b, line{v, 1})
		assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
		if row := ps.paymentRow(t, pay.ID); row.Status != "cancelled" || row.FinalChecked {
			t.Fatalf("payment %+v after the cancel, want cancelled and waiting for a final check", row)
		}
		stock := ps.stock(t, v)
		assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "refund_required", "settlement after cancel")
		if row := ps.paymentRow(t, pay.ID); row.Status != "paid" || !row.RefundRequired || !row.Paid {
			t.Errorf("payment %+v, want paid and flagged for a refund", row)
		}
		if ps.orderStatus(t, o.ID) != "cancelled" || ps.stock(t, v) != stock {
			t.Errorf("order %s, stock %d → %d; the late payment must not revive the order", ps.orderStatus(t, o.ID), stock, ps.stock(t, v))
		}
		ps.assertEvents(t, o.ID, "order.created", "order.cancelled")
		assertLogged(t, ps.server, "WARN", "payment arrived for an order that can no longer be paid", pay.ID)
	})

	t.Run("after the order expired", func(t *testing.T) {
		o, pay, poid := ps.paid(t, b, line{v, 1})
		ps.expireNow(t, o.ID)
		if n, err := ps.orders().ExpireDue(t.Context()); err != nil || n != 1 {
			t.Fatalf("ExpireDue = %d, %v; want 1", n, err)
		}
		if row := ps.paymentRow(t, pay.ID); row.Status != "cancelled" {
			t.Fatalf("payment %s after the expiry, want cancelled", row.Status)
		}
		assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "refund_required", "settlement after expiry")
		if row := ps.paymentRow(t, pay.ID); row.Status != "paid" || !row.RefundRequired {
			t.Errorf("payment %+v, want paid and flagged", row)
		}
		if ps.orderStatus(t, o.ID) != "cancelled" {
			t.Errorf("order %s, want cancelled", ps.orderStatus(t, o.ID))
		}
		// The same settlement again changes nothing more.
		assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "duplicate", "settlement again")
	})

	t.Run("Midtrans expired a payment GoShop had closed", func(t *testing.T) {
		o, pay, poid := ps.paid(t, b, line{v, 1})
		assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
		assertOutcome(t, ps.gatewaySays(t, poid, "expire", ""), "recorded", "expire after cancel")
		if row := ps.paymentRow(t, pay.ID); row.Status != "cancelled" || row.RefundRequired {
			t.Errorf("payment %+v, want it to stay cancelled", row)
		}
	})
}

// TestNotification_Body: the body is read through a 64 KiB limit, must be
// one JSON object with the four fields as text, and may carry any other
// field Midtrans adds.
func TestNotification_Body(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-badan", variant("BD-M", "M", 25000, 10))
	b := ps.buyer(t, "badan")
	_, _, poid := ps.paid(t, b, line{p.Variants["BD-M"], 1})
	n := ps.notification(t, poid, "settlement", "")
	body := func(pad int) string {
		return fmt.Sprintf(`{"order_id":%q,"status_code":%q,"gross_amount":%q,"signature_key":%q,"merchant_id":"G1","va_numbers":[{"bank":"bca"}],"padding":%q}`,
			n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey, strings.Repeat("a", pad))
	}
	over := body(payment.MaxNotificationBytes)
	assertError(t, ps.notify(t, over), http.StatusBadRequest, "VALIDATION_FAILED")
	assertError(t, ps.notify(t, `{"order_id":`), http.StatusBadRequest, "VALIDATION_FAILED")
	assertError(t, ps.notify(t, `[]`), http.StatusBadRequest, "VALIDATION_FAILED")
	details := assertError(t, ps.notify(t, `{"order_id":"GS-1","status_code":""}`), http.StatusBadRequest, "VALIDATION_FAILED")
	for _, f := range []string{"status_code", "gross_amount", "signature_key"} {
		if _, ok := details[f]; !ok {
			t.Errorf("details %v, want %s named", details, f)
		}
	}
	assertError(t, ps.notify(t, map[string]string{"order_id": strings.Repeat("A", 257), "status_code": "200",
		"gross_amount": "1.00", "signature_key": "x"}), http.StatusBadRequest, "VALIDATION_FAILED")
	if ps.count(t, `SELECT count(*) FROM payment_events`) != 0 {
		t.Fatal("a refused body was recorded")
	}

	// Just under the limit, with fields GoShop does not read: handled.
	under := body(payment.MaxNotificationBytes - len(body(0)) - 1)
	if len(under) >= payment.MaxNotificationBytes {
		t.Fatalf("test body is %d bytes", len(under))
	}
	assertOutcome(t, ps.notify(t, under), "paid", "a 64 KiB body with extra fields")
	assertNoServerErrors(t, ps.server)
}

// TestNotification_RateLimitPerIP runs the real Redis limiter: one client
// IP may call the public webhook 120 times a minute, whatever the answer,
// then 429 before the body is read.
func TestNotification_RateLimitPerIP(t *testing.T) {
	sh := staffShop(t, nil, app.WithPaymentGateway(fake.New(fake.NewMemoryStore())))
	bad := fake.Notification("GS-20260101-AAAAAA-BBBBBB", "200", "1000.00")
	bad.SignatureKey = "salah"
	exhaust(t, payment.LimitNotificationPerIP, func(int) response { return sh.notify(t, bad) })
	assertRateLimited(t, sh.notify(t, `{"bukan json`), payment.LimitNotificationPerIP.Window, "a broken body over the limit")
	sh.assertCounter(t, payment.LimitNotificationPerIP)
}
