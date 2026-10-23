//go:build integration

package integration_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// TestExpireOrders_Command runs `api expire-orders` for real (app.Run, as
// make expire-orders and the Railway cron do): only unpaid orders past
// their deadline are cancelled (payment_expired) with their stock, voucher
// use and order.cancelled event given back; an unpaid order still in time,
// and a paid one past the deadline, are left alone. A second run does
// nothing.
func TestExpireOrders_Command(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-kedaluwarsa", variant("KD-M", "M", 50000, 20))
	m := p.Variants["KD-M"]
	vid := sh.voucher(t, voucherSpec{code: "LUPABAYAR", kind: "fixed", value: 5000, perUser: 9})
	b := sh.buyer(t, "kedaluwarsa")

	sh.add(t, b, m, 3)
	due := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), "LUPABAYAR")),
		http.StatusCreated, "due")
	inTime := sh.order(t, b, line{m, 2})
	paidLate := sh.order(t, b, line{m, 1})
	sh.markPaid(t, paidLate.ID)
	sh.expireNow(t, due.ID)
	sh.expireNow(t, paidLate.ID)
	if s, u := sh.stock(t, m), sh.usedCount(t, vid); s != 14 || u != 1 {
		t.Fatalf("before the job: stock %d, used_count %d", s, u)
	}

	logs := runCommand(t, "expire-orders")
	if !strings.Contains(logs, "expired unpaid orders") || !strings.Contains(logs, "cancelled=1") {
		t.Errorf("expire-orders logged:\n%s", logs)
	}
	got := assertOrderDetail(t, sh.call(t, http.MethodGet, "/v1/orders/"+due.ID, nil, b.Token), http.StatusOK, "GET expired order")
	if got.Status != "cancelled" || got.CancelReason == nil || *got.CancelReason != "payment_expired" {
		t.Errorf("the due order is %s (%v), want cancelled payment_expired", got.Status, got.CancelReason)
	}
	if s, u := sh.stock(t, m), sh.usedCount(t, vid); s != 17 || u != 0 {
		t.Errorf("after the job: stock %d, used_count %d; want 17 and 0", s, u)
	}
	sh.assertEvents(t, due.ID, "order.created", "order.cancelled")
	for id, status := range map[string]string{inTime.ID: "pending_payment", paidLate.ID: "paid"} {
		if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND status = $2`, id, status); n != 1 {
			t.Errorf("order %s is no longer %s", id, status)
		}
	}

	if logs := runCommand(t, "expire-orders"); !strings.Contains(logs, "cancelled=0") {
		t.Errorf("a second run logged:\n%s", logs)
	}
	if s := sh.stock(t, m); s != 17 {
		t.Errorf("a second run changed the stock to %d", s)
	}
}

// TestDeleteAccount_WithOrders deletes a buyer who has two unpaid orders
// sharing a variant (one with a voucher), a paid order, a cart and
// idempotency keys (ADR 0006): 204; both unpaid orders are cancelled
// (buyer_cancelled) with their stock summed back once and the voucher use
// released, one order.cancelled each; the paid order stays paid and keeps
// its buyer's id; the cart and the keys are gone.
func TestDeleteAccount_WithOrders(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-hapus", variant("HP-M", "M", 50000, 20), variant("HP-L", "L", 50000, 20))
	m, l := p.Variants["HP-M"], p.Variants["HP-L"]
	vid := sh.voucher(t, voucherSpec{code: "PERGI", kind: "fixed", value: 5000})
	b := sh.buyer(t, "hapus-pesanan")

	sh.add(t, b, m, 2)
	sh.add(t, b, l, 1)
	first := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), "PERGI")),
		http.StatusCreated, "first")
	second := sh.order(t, b, line{m, 3})
	paid := sh.order(t, b, line{l, 4})
	sh.markPaid(t, paid.ID)
	sh.add(t, b, m, 1)
	if s, sl, u := sh.stock(t, m), sh.stock(t, l), sh.usedCount(t, vid); s != 15 || sl != 15 || u != 1 {
		t.Fatalf("before: stock M %d L %d, used %d", s, sl, u)
	}

	resp := sh.call(t, http.MethodDelete, "/v1/me", nil, b.Token)
	if resp.Status != http.StatusNoContent {
		t.Fatalf("DELETE /v1/me = %d: %s", resp.Status, resp.Body)
	}
	sh.assertAnonymised(t, b.ID)
	for _, id := range []string{first.ID, second.ID} {
		if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND status = 'cancelled' AND cancel_reason = 'buyer_cancelled'`, id); n != 1 {
			t.Errorf("unpaid order %s was not cancelled by the deletion", id)
		}
		sh.assertEvents(t, id, "order.created", "order.cancelled")
	}
	if s, sl, u := sh.stock(t, m), sh.stock(t, l), sh.usedCount(t, vid); s != 20 || sl != 16 || u != 0 {
		t.Errorf("after: stock M %d L %d, used %d; want 20, 16 (the paid order keeps its 4) and 0", s, sl, u)
	}
	if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND status = 'paid' AND user_id = $2`, paid.ID, b.ID); n != 1 {
		t.Error("the paid order changed")
	}
	sh.assertEvents(t, paid.ID, "order.created", "order.paid")
	if n := sh.count(t, `SELECT count(*) FROM carts WHERE user_id = $1`, b.ID) +
		sh.count(t, `SELECT count(*) FROM idempotency_keys WHERE user_id = $1`, b.ID); n != 0 {
		t.Errorf("%d carts and keys left for the deleted buyer", n)
	}
	if n := sh.count(t, `SELECT count(*) FROM cart_items`); n != 0 {
		t.Errorf("%d cart lines left", n)
	}
	assertError(t, sh.call(t, http.MethodGet, "/v1/orders", nil, b.Token), http.StatusUnauthorized, "UNAUTHORIZED")
	// The staff still sees the paid order.
	assertOrderDetail(t, sh.staffCall(t, http.MethodGet, "/v1/admin/orders/"+paid.ID, nil), http.StatusOK, "admin GET paid order")
	assertNoErrorLog(t, sh.server)
}
