//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// The status-change races of ADR 0006: a guarded UPDATE lets exactly one of
// two racing moves through, a cancel gives stock and voucher uses back
// only when its UPDATE returned a row, and an account deletion releases
// several orders' stock and vouchers in one aggregated statement each.

// TestRace_CancelVersusExpiry: the buyer cancels an unpaid order at the
// moment the expiry job finds it past its deadline. Exactly one of them
// cancels it; the stock and the voucher use come back exactly once, and
// one order.cancelled is recorded.
func TestRace_CancelVersusExpiry(t *testing.T) {
	sh := newShop(t, nil)
	b := sh.buyer(t, "batal-kedaluwarsa")
	p := sh.product(t, "kaos-batal-kedaluwarsa", variant("BK-M", "M", 10000, 1000))
	v := p.Variants["BK-M"]
	vid := sh.voucher(t, voucherSpec{code: "BALAPAN", kind: "fixed", value: 1000, perUser: 1000})
	tally := map[string]int{}
	for i := range raceIterations {
		sh.add(t, b, v, 3)
		o := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), "BALAPAN")),
			http.StatusCreated, "checkout")
		sh.expireNow(t, o.ID)
		stock, used := sh.stock(t, v), sh.usedCount(t, vid)
		var expired int
		var expireErr error
		results := runTogether(t,
			func() (response, error) {
				return sh.tryCall(http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token, nil)
			},
			func() (response, error) {
				expired, expireErr = sh.orders().ExpireDue(t.Context())
				return response{Status: http.StatusOK}, nil
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if expireErr != nil {
			t.Fatalf("iteration %d: ExpireDue: %v", i, expireErr)
		}
		cancelled := results[0].Status == http.StatusOK
		switch {
		case cancelled && expired == 0:
			tally["buyer"]++
		case !cancelled && expired == 1:
			assertTransitionRefused(t, results[0], "cancelled", "cancelled")
			tally["expiry"]++
		default:
			t.Fatalf("iteration %d: cancel %s and %d expired; want exactly one to cancel", i, describe(results[0]), expired)
		}
		reason := map[bool]string{true: "buyer_cancelled", false: "payment_expired"}[cancelled]
		if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND status = 'cancelled' AND cancel_reason = $2`, o.ID, reason); n != 1 {
			t.Fatalf("iteration %d: the order is not cancelled with %s", i, reason)
		}
		if sh.stock(t, v) != stock+3 || sh.usedCount(t, vid) != used-1 {
			t.Fatalf("iteration %d: stock %d → %d, used_count %d → %d; want +3 and -1 exactly once",
				i, stock, sh.stock(t, v), used, sh.usedCount(t, vid))
		}
		sh.assertEvents(t, o.ID, "order.created", "order.cancelled")
	}
	t.Logf("who cancelled over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}

// TestRace_TwoDeletionsOppositeVouchers: two buyers each hold two unpaid
// orders on the same variants, one with voucher X and one with voucher Y,
// placed in opposite orders, and delete their accounts at once. Each
// deletion locks its orders' variants and vouchers in id order and
// releases them in one statement each, so the two never deadlock: both
// 204, all four orders cancelled, all stock and both vouchers back.
func TestRace_TwoDeletionsOppositeVouchers(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-dua-hapus", variant("DH-M", "M", 10000, 100000), variant("DH-L", "L", 10000, 100000))
	m, l := p.Variants["DH-M"], p.Variants["DH-L"]
	x := sh.voucher(t, voucherSpec{code: "VOUCHERX", kind: "fixed", value: 1000, perUser: 100})
	y := sh.voucher(t, voucherSpec{code: "VOUCHERY", kind: "fixed", value: 1000, perUser: 100})
	for i := range raceIterations {
		a, b := sh.buyer(t, fmt.Sprintf("hapus-a-%d", i)), sh.buyer(t, fmt.Sprintf("hapus-b-%d", i))
		place := func(u buyer, code string, first, second string) string {
			sh.add(t, u, first, 1)
			sh.add(t, u, second, 2)
			return assertOrderDetail(t, sh.checkout(t, u.Token, uuidx.NewV7(), withVoucher(checkoutBody(u.AddressID), code)),
				http.StatusCreated, "checkout "+code).ID
		}
		orders := []string{place(a, "VOUCHERX", m, l), place(a, "VOUCHERY", l, m), place(b, "VOUCHERY", m, l), place(b, "VOUCHERX", l, m)}
		results := runTogether(t,
			func() (response, error) { return sh.tryCall(http.MethodDelete, "/v1/me", nil, a.Token, nil) },
			func() (response, error) { return sh.tryCall(http.MethodDelete, "/v1/me", nil, b.Token, nil) })
		if results[0].Status != http.StatusNoContent || results[1].Status != http.StatusNoContent {
			t.Fatalf("iteration %d: deletions %s, %s; want 204 twice", i, describe(results[0]), describe(results[1]))
		}
		for _, id := range orders {
			sh.assertEvents(t, id, "order.created", "order.cancelled")
		}
		if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = ANY($1) AND status = 'cancelled' AND cancel_reason = 'buyer_cancelled'`, orders); n != 4 {
			t.Fatalf("iteration %d: %d of 4 orders cancelled", i, n)
		}
		if sh.stock(t, m) != 100000 || sh.stock(t, l) != 100000 || sh.usedCount(t, x) != 0 || sh.usedCount(t, y) != 0 {
			t.Fatalf("iteration %d: stock %d/%d, used %d/%d; want everything back", i, sh.stock(t, m), sh.stock(t, l), sh.usedCount(t, x), sh.usedCount(t, y))
		}
		sh.assertAnonymised(t, a.ID)
		sh.assertAnonymised(t, b.ID)
	}
	assertNoServerErrors(t, sh.server)
}

// TestRace_DeletionVersusAdminSave: a buyer with one variant in two unpaid
// orders deletes the account while a seller saves that product in reverse
// id order. The deletion restores the two orders' stock in one statement
// (a second write of the same row would lock the product and deadlock with
// the save, which holds it): 204, no deadlock, and the stock is exact
// either way: the save's value plus both orders' units when the save came
// first, the original stock when the deletion did (the save then 409).
func TestRace_DeletionVersusAdminSave(t *testing.T) {
	sh := newShop(t, nil)
	tally := map[string]int{}
	for i := range raceIterations {
		p := sh.product(t, fmt.Sprintf("kaos-hapus-admin-%d", i), variant(fmt.Sprintf("HA-%d-M", i), "M", 10000, 40),
			variant(fmt.Sprintf("HA-%d-L", i), "L", 10000, 40))
		m, l := p.Variants[fmt.Sprintf("HA-%d-M", i)], p.Variants[fmt.Sprintf("HA-%d-L", i)]
		b := sh.buyer(t, fmt.Sprintf("hapus-admin-%d", i))
		sh.order(t, b, line{m, 2}, line{l, 1})
		sh.order(t, b, line{l, 3}, line{m, 4})
		save := reverseSave(t, sh.adminForm(t, p.ID), 100, "")
		// A save is quicker than a deletion; starting it 0-12 ms later
		// lets either one take the locks first.
		delay := time.Duration(i%5) * 3 * time.Millisecond
		results := runTogether(t,
			func() (response, error) { return sh.tryCall(http.MethodDelete, "/v1/me", nil, b.Token, nil) },
			func() (response, error) {
				time.Sleep(delay)
				return sh.trySave(p.ID, save)
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if results[0].Status != http.StatusNoContent {
			t.Fatalf("iteration %d: DELETE /v1/me = %s", i, describe(results[0]))
		}
		var wantM, wantL int
		switch {
		case results[1].Status == http.StatusOK:
			wantM, wantL = 100+6, 100+4
			tally["save first"]++
		case is(results[1], http.StatusConflict, "VERSION_CONFLICT"):
			wantM, wantL = 40, 40
			tally["deletion first"]++
		default:
			t.Fatalf("iteration %d: save = %s", i, describe(results[1]))
		}
		if sh.stock(t, m) != wantM || sh.stock(t, l) != wantL {
			t.Fatalf("iteration %d: stock M %d L %d, want %d and %d", i, sh.stock(t, m), sh.stock(t, l), wantM, wantL)
		}
		if n := sh.count(t, `SELECT count(*) FROM orders WHERE user_id = $1 AND status = 'pending_payment'`, b.ID); n != 0 {
			t.Fatalf("iteration %d: %d unpaid orders left", i, n)
		}
	}
	t.Logf("over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}

// TestRace_ShopVersusDeleteMe: a cart add, a login merge or a checkout of
// the same account runs at the moment the account is deleted (rotating
// over the iterations). The deletion is 204; the other request either
// finished first (and the deletion then cleaned up after it) or found the
// account gone (401). Afterwards the account is anonymised, has no cart,
// no idempotency key and no unpaid order, the stock is whole, and its
// token is refused.
func TestRace_ShopVersusDeleteMe(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-hapus-belanja", variant("HB-M", "M", 10000, 100000), variant("HB-L", "L", 10000, 100000))
	m, l := p.Variants["HB-M"], p.Variants["HB-L"]
	ops := []string{"add", "merge", "checkout"}
	tally := map[string]int{}
	for i := range raceIterations {
		op := ops[i%len(ops)]
		b := sh.buyer(t, fmt.Sprintf("hapus-belanja-%d", i))
		var req func() (response, error)
		switch op {
		case "add":
			sh.add(t, b, m, 1)
			req = func() (response, error) {
				return sh.tryCall(http.MethodPost, "/v1/cart/items", map[string]any{"variant_id": l, "quantity": 2}, b.Token, nil)
			}
		case "merge":
			sh.add(t, b, m, 1)
			token := assertCart(t, sh.addItem(t, "", "", l, 2), "guest add").Token
			req = func() (response, error) {
				return sh.tryCall(http.MethodPost, "/v1/cart/merge", nil, b.Token, cartHeaders(token))
			}
		case "checkout":
			sh.add(t, b, m, 2)
			sh.add(t, b, l, 1)
			req = func() (response, error) { return sh.tryCheckout(b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)) }
		}
		// A deletion is quicker than a checkout; starting it 0-30 ms
		// later lets either one finish first.
		delay := time.Duration(i%4) * 10 * time.Millisecond
		results := runTogether(t, req, func() (response, error) {
			time.Sleep(delay)
			return sh.tryCall(http.MethodDelete, "/v1/me", nil, b.Token, nil)
		})
		assertNo5xx(t, fmt.Sprintf("iteration %d (%s)", i, op), results...)
		if results[1].Status != http.StatusNoContent {
			t.Fatalf("iteration %d (%s): DELETE /v1/me = %s", i, op, describe(results[1]))
		}
		r := results[0]
		ok := slices.Contains([]int{http.StatusOK, http.StatusCreated}, r.Status)
		if !ok && !is(r, http.StatusUnauthorized, "UNAUTHORIZED") {
			t.Fatalf("iteration %d (%s): %s, want success or 401", i, op, describe(r))
		}
		tally[fmt.Sprintf("%s %d", op, r.Status)]++

		sh.assertAnonymised(t, b.ID)
		if n := sh.count(t, `SELECT count(*) FROM carts WHERE user_id = $1`, b.ID) +
			sh.count(t, `SELECT count(*) FROM idempotency_keys WHERE user_id = $1`, b.ID) +
			sh.count(t, `SELECT count(*) FROM orders WHERE user_id = $1 AND status <> 'cancelled'`, b.ID); n != 0 {
			t.Fatalf("iteration %d (%s): %d carts, keys or live orders left", i, op, n)
		}
		if sh.stock(t, m) != 100000 || sh.stock(t, l) != 100000 {
			t.Fatalf("iteration %d (%s): stock %d/%d, want it all back", i, op, sh.stock(t, m), sh.stock(t, l))
		}
		assertError(t, sh.addItem(t, b.Token, "", m, 1), http.StatusUnauthorized, "UNAUTHORIZED")
		assertError(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusUnauthorized, "UNAUTHORIZED")
	}
	if n := sh.count(t, `SELECT count(*) FROM carts WHERE user_id IS NULL`); n > raceIterations/len(ops)+1 {
		t.Errorf("%d guest carts left; at most the merges that lost to a deletion may stay", n)
	}
	t.Logf("over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}
