//go:build integration

package integration_test

import (
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
)

// The reconciler (ADR 0007) asks the gateway about the payments whose
// notification may have been lost: open ones, and ones GoShop closed with
// their order until a check gets a final answer. These tests run it on
// the test database against the fake gateway (and fakeMidtrans for
// answers the fake cannot give), and age payments with SQL instead of
// waiting.

// reconciler is the payment service the worker and `api
// reconcile-payments` run, on sh's database and gw.
func (sh *shop) reconciler(gw payment.Gateway) *payment.Service {
	return payment.NewService(payment.Deps{Repo: payment.NewPostgresRepository(sh.db), Gateway: gw})
}

// reconcile runs one reconciliation and fails on an error.
func (sh *shop) reconcile(t *testing.T, gw payment.Gateway) payment.ReconcileResult {
	t.Helper()
	res, err := sh.reconciler(gw).Reconcile(t.Context())
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	return res
}

// agePayment moves a payment's creation (and its Snap window) back by d,
// past the reconciler's one-minute grace.
func (sh *shop) agePayment(t *testing.T, paymentID string, d time.Duration) {
	t.Helper()
	mustExec(t, sh.db, `UPDATE payments SET created_at = created_at - $2::interval, expires_at = expires_at - $2::interval
		WHERE id = $1`, paymentID, d.String())
}

// TestReconcile_LostNotification: the buyer paid, but the notification
// never arrived. A payment younger than a minute is left alone (its
// notification may still come); after that the reconciler finds the
// settlement and applies it exactly like the webhook would: order paid,
// one order.paid, the event recorded as reconcile, and the payment out of
// every queue. Run again, it asks about nothing.
func TestReconcile_LostNotification(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-hilang", variant("HL-M", "M", 25000, 10))
	b := ps.buyer(t, "hilang")
	o, pay, poid := ps.paid(t, b, line{p.Variants["HL-M"], 1})
	ps.notification(t, poid, "settlement", "") // paid at Midtrans, never sent

	if res := ps.reconcile(t, ps.gw); res.Checked != 0 {
		t.Fatalf("a fresh payment was checked: %+v", res)
	}
	ps.agePayment(t, pay.ID, 2*time.Minute)
	if res := ps.reconcile(t, ps.gw); res != (payment.ReconcileResult{Checked: 1, Changed: 1}) {
		t.Fatalf("Reconcile = %+v, want 1 checked and changed", res)
	}
	row := ps.paymentRow(t, pay.ID)
	if row.Status != "paid" || !row.Checked || !row.FinalChecked || ps.orderStatus(t, o.ID) != "paid" {
		t.Errorf("payment %+v, order %s; want paid, checked and final", row, ps.orderStatus(t, o.ID))
	}
	ps.assertEvents(t, o.ID, "order.created", "order.paid")
	if got := ps.paymentEvents(t, pay.ID); !slices.Equal(got, []string{"reconcile:settlement:paid"}) {
		t.Errorf("payment events %v", got)
	}
	if res := ps.reconcile(t, ps.gw); res.Checked != 0 {
		t.Errorf("a paid payment was asked about again: %+v", res)
	}
	// The notification arriving late now is a duplicate.
	assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "duplicate", "the late notification")
	assertNoServerErrors(t, ps.server)
}

// TestReconcile_Command runs `api reconcile-payments` for real, with
// APP_PAYMENT_PROVIDER=fake, so the command's own gateway reads the
// transactions the API created from Redis: a lost settlement and a lost
// expiry are applied, and the command logs what it did.
func TestReconcile_Command(t *testing.T) {
	sh := newShop(t, map[string]string{"APP_PAYMENT_PROVIDER": "fake"})
	gw := fake.New(fake.NewRedisStore(sh.rdb))
	p := sh.product(t, "kaos-rekonsil", variant("RK-M", "M", 25000, 10))
	v := p.Variants["RK-M"]
	b := sh.buyer(t, "rekonsil")
	settled := sh.order(t, b, line{v, 1})
	expired := sh.order(t, b, line{v, 2})
	ids := map[string]string{}
	for _, o := range []orderOut{settled, expired} {
		pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
		if pay.Provider != "fake" || pay.ClientKey != fake.ClientKey {
			t.Fatalf("APP_PAYMENT_PROVIDER=fake paid through %s", pay.Provider)
		}
		ids[o.ID] = pay.ID
		sh.agePayment(t, pay.ID, 2*time.Minute)
	}
	if _, err := gw.Pay(t.Context(), sh.providerOrderID(t, ids[settled.ID]), "settlement", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := gw.Pay(t.Context(), sh.providerOrderID(t, ids[expired.ID]), "expire", ""); err != nil {
		t.Fatal(err)
	}
	stock := sh.stock(t, v)

	logs := runCommand(t, "reconcile-payments")
	if !strings.Contains(logs, "reconciled payments") || !strings.Contains(logs, "checked=2") || !strings.Contains(logs, "changed=2") {
		t.Errorf("reconcile-payments logged:\n%s", logs)
	}
	if sh.orderStatus(t, settled.ID) != "paid" || sh.orderStatus(t, expired.ID) != "cancelled" || sh.stock(t, v) != stock+2 {
		t.Errorf("orders %s and %s, stock %d → %d; want paid, cancelled and 2 units back",
			sh.orderStatus(t, settled.ID), sh.orderStatus(t, expired.ID), stock, sh.stock(t, v))
	}
	if logs := runCommand(t, "reconcile-payments"); !strings.Contains(logs, "checked=0") {
		t.Errorf("a second run logged:\n%s", logs)
	}
}

// TestReconcile_PaymentsOff: `api reconcile-payments` with payments off
// does nothing and says so.
func TestReconcile_PaymentsOff(t *testing.T) {
	startServer(t, map[string]string{"MIDTRANS_SERVER_KEY": "", "MIDTRANS_CLIENT_KEY": ""})
	if logs := runCommand(t, "reconcile-payments"); !strings.Contains(logs, "payments are off") {
		t.Errorf("reconcile-payments with payments off logged:\n%s", logs)
	}
}

// TestReconcile_OpenQueue: an open payment whose transaction is still
// pending, or that the gateway does not know yet, is checked and stays
// open and queued (not final); one the gateway never heard of past its
// expiry is closed as expired, which cancels the unpaid order; a check
// that fails changes nothing, not even checked_at.
func TestReconcile_OpenQueue(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-antre", variant("AN-M", "M", 25000, 10))
	b := ps.buyer(t, "antre")

	pendingOrder, pending, poid := ps.paid(t, b, line{p.Variants["AN-M"], 1})
	ps.notification(t, poid, "pending", "")
	unknownOrder, unknown, _ := ps.paid(t, b, line{p.Variants["AN-M"], 1})
	ps.agePayment(t, pending.ID, 2*time.Minute)
	ps.agePayment(t, unknown.ID, 2*time.Minute)

	if res := ps.reconcile(t, ps.gw); res != (payment.ReconcileResult{Checked: 2}) {
		t.Fatalf("Reconcile = %+v, want 2 checked, nothing changed", res)
	}
	for _, id := range []string{pending.ID, unknown.ID} {
		if row := ps.paymentRow(t, id); row.Status != "pending" || !row.Checked || row.FinalChecked {
			t.Errorf("payment %+v, want pending, checked, not final", row)
		}
	}
	if ps.orderStatus(t, pendingOrder.ID) != "pending_payment" || ps.orderStatus(t, unknownOrder.ID) != "pending_payment" {
		t.Error("an order changed")
	}
	if res := ps.reconcile(t, ps.gw); res.Checked != 2 {
		t.Errorf("open payments left the queue after a non-final answer: %+v", res)
	}

	// Past its Snap expiry, a transaction the gateway never started is
	// closed as expired, and the order's stock goes back.
	stock := ps.stock(t, p.Variants["AN-M"])
	ps.agePayment(t, unknown.ID, 25*time.Hour)
	if res := ps.reconcile(t, ps.gw); res.Changed != 1 {
		t.Fatalf("Reconcile = %+v, want the never-started payment changed", res)
	}
	if row := ps.paymentRow(t, unknown.ID); row.Status != "expired" || !row.FinalChecked {
		t.Errorf("never-started payment %+v, want expired and final", row)
	}
	if ps.orderStatus(t, unknownOrder.ID) != "cancelled" || ps.stock(t, p.Variants["AN-M"]) != stock+1 {
		t.Errorf("order %s, stock %d; want cancelled with its unit back", ps.orderStatus(t, unknownOrder.ID), ps.stock(t, p.Variants["AN-M"]))
	}
	if got := ps.paymentEvents(t, unknown.ID); !slices.Equal(got, []string{"reconcile:expire:order_cancelled"}) {
		t.Errorf("events %v", got)
	}

	// A gateway that does not answer: nothing changes, not even checked_at.
	var before time.Time
	if err := ps.db.QueryRowContext(t.Context(), `SELECT checked_at FROM payments WHERE id = $1`, pending.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	down := newFakeMidtrans(t)
	down.srv.Close()
	res, err := ps.reconciler(down.gateway()).Reconcile(t.Context())
	if err != nil || res.Checked != 1 || res.Failed != 1 {
		t.Fatalf("Reconcile with the gateway down = %+v, %v; want 1 checked and failed", res, err)
	}
	var after time.Time
	if err := ps.db.QueryRowContext(t.Context(), `SELECT checked_at FROM payments WHERE id = $1`, pending.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !after.Equal(before) {
		t.Errorf("checked_at moved from %s to %s on a failed check", before, after)
	}
}

// TestReconcile_ClosedQueue: when an order closes, its open payment is
// cancelled, but Midtrans was never told and takes money until the Snap
// expiry. The reconciler keeps asking about such a payment until it gets
// a final answer: a settlement found there is recorded (paid,
// refund_required, the order left cancelled); pending after the window is
// not final, so the payment stays queued and is asked again 30 minutes
// later; an amount that does not match is not final either.
func TestReconcile_ClosedQueue(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-tutup", variant("TT-M", "M", 25000, 10))
	b := ps.buyer(t, "tutup")
	cancel := func(o orderOut) {
		t.Helper()
		assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	}

	// Money paid on a cancelled order's Snap page, notification lost.
	o1, settled, poid1 := ps.paid(t, b, line{p.Variants["TT-M"], 1})
	cancel(o1)
	ps.notification(t, poid1, "settlement", "")
	ps.agePayment(t, settled.ID, 2*time.Minute)
	if res := ps.reconcile(t, ps.gw); res != (payment.ReconcileResult{Checked: 1, Changed: 1}) {
		t.Fatalf("Reconcile = %+v, want the closed payment checked and changed", res)
	}
	if row := ps.paymentRow(t, settled.ID); row.Status != "paid" || !row.RefundRequired || !row.FinalChecked {
		t.Errorf("closed payment %+v, want paid, flagged for a refund, final", row)
	}
	if ps.orderStatus(t, o1.ID) != "cancelled" {
		t.Errorf("order %s, want it left cancelled", ps.orderStatus(t, o1.ID))
	}
	if res := ps.reconcile(t, ps.gw); res.Checked != 0 {
		t.Errorf("a closed payment with a final answer was asked again: %+v", res)
	}

	// Still pending at Midtrans after its window ended (Midtrans' own
	// expiry lags): not final, so it stays in the closed queue.
	o2, lagging, poid2 := ps.paid(t, b, line{p.Variants["TT-M"], 1})
	cancel(o2)
	ps.notification(t, poid2, "pending", "")
	mustExec(t, ps.db, `UPDATE payments SET created_at = now() - interval '2 hours', expires_at = now() - interval '20 minutes'
		WHERE id = $1`, lagging.ID)
	if res := ps.reconcile(t, ps.gw); res != (payment.ReconcileResult{Checked: 1}) {
		t.Fatalf("Reconcile = %+v, want the lagging payment checked", res)
	}
	if row := ps.paymentRow(t, lagging.ID); row.Status != "cancelled" || !row.Checked || row.FinalChecked {
		t.Errorf("lagging payment %+v, want cancelled, checked, not final", row)
	}
	if res := ps.reconcile(t, ps.gw); res.Checked != 0 {
		t.Errorf("a closed payment was asked again within 30 minutes: %+v", res)
	}
	mustExec(t, ps.db, `UPDATE payments SET checked_at = checked_at - interval '35 minutes' WHERE id = $1`, lagging.ID)
	ps.notification(t, poid2, "expire", "")
	if res := ps.reconcile(t, ps.gw); res.Checked != 1 {
		t.Fatalf("Reconcile = %+v, want the lagging payment asked again after 30 minutes", res)
	}
	if row := ps.paymentRow(t, lagging.ID); row.Status != "cancelled" || !row.FinalChecked || row.RefundRequired {
		t.Errorf("payment %+v after Midtrans expired it, want cancelled and final", row)
	}
	if res := ps.reconcile(t, ps.gw); res.Checked != 0 {
		t.Errorf("a final closed payment is still queued: %+v", res)
	}
}

// TestReconcile_AmountMismatchNotFinal: a closed payment whose status
// answer carries another amount changes nothing and stays queued: a wrong
// amount settles nothing.
func TestReconcile_AmountMismatchNotFinal(t *testing.T) {
	sh, mt := midtransShop(t, nil)
	p := sh.product(t, "kaos-salah-jumlah", variant("SJ-M", "M", 25000, 10))
	b := sh.buyer(t, "salah-jumlah")
	o := sh.order(t, b, line{p.Variants["SJ-M"], 1})
	pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	poid := sh.providerOrderID(t, pay.ID)
	mt.set(poid, "settlement", "", rupiahAmount(o.Totals.Total.Amount+1))
	sh.agePayment(t, pay.ID, 2*time.Minute)

	if res := sh.reconcile(t, mt.gateway()); res != (payment.ReconcileResult{Checked: 1}) {
		t.Fatalf("Reconcile = %+v, want 1 checked, nothing changed", res)
	}
	if row := sh.paymentRow(t, pay.ID); row.Status != "cancelled" || !row.Checked || row.FinalChecked || row.Paid {
		t.Errorf("payment %+v, want unchanged, checked, not final", row)
	}
	if got := sh.paymentEvents(t, pay.ID); !slices.Equal(got, []string{"reconcile:settlement:amount_mismatch"}) {
		t.Errorf("events %v", got)
	}
}

// TestReconcile_CloseResetsFinalCheck: closing an order starts a new
// window to watch, so its payment's final_checked_at goes back to NULL,
// whatever the reconciler concluded while it was open, and the closed
// queue picks it up.
func TestReconcile_CloseResetsFinalCheck(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-reset", variant("RS-M", "M", 25000, 10))
	b := ps.buyer(t, "reset")
	o, pay, _ := ps.paid(t, b, line{p.Variants["RS-M"], 1})
	mustExec(t, ps.db, `UPDATE payments SET checked_at = now(), final_checked_at = now() WHERE id = $1`, pay.ID)

	assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	if row := ps.paymentRow(t, pay.ID); row.Status != "cancelled" || row.FinalChecked {
		t.Errorf("payment %+v after the cancel, want cancelled with final_checked_at reset", row)
	}
	mustExec(t, ps.db, `UPDATE payments SET checked_at = NULL WHERE id = $1`, pay.ID)
	ps.agePayment(t, pay.ID, 2*time.Minute)
	if res := ps.reconcile(t, ps.gw); res.Checked != 1 {
		t.Errorf("Reconcile = %+v, want the reopened window checked", res)
	}
}
