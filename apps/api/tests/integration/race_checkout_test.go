//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
)

// The checkout races of ADR 0006. Each runs raceIterations times on fresh
// products, releases its requests from a barrier (and, where it matters,
// holds every shipping quote until all of them have read their carts, so
// the transactions really overlap), and is judged on the state PostgreSQL
// ends in: never on timing. No request may answer 5xx, and the server may
// log no error and no deadlock (assertNoServerErrors).

// resetBuyers lets a test reuse its buyers in the next iteration: their
// unpaid orders are closed with SQL (each iteration sells a new product,
// so no stock needs to come back) and every cart line is removed.
func (sh *shop) resetBuyers(t *testing.T) {
	t.Helper()
	mustExec(t, sh.db, `UPDATE orders SET status = 'cancelled', cancel_reason = 'seller_cancelled', cancelled_at = now()
		WHERE status = 'pending_payment'`)
	mustExec(t, sh.db, `DELETE FROM cart_items`)
}

// buyers creates n buyers.
func (sh *shop) buyers(t *testing.T, prefix string, n int) []buyer {
	t.Helper()
	out := make([]buyer, n)
	for i := range out {
		out[i] = sh.buyer(t, fmt.Sprintf("%s-%d", prefix, i))
	}
	return out
}

// checkoutAll sends one checkout per buyer, all released together, each
// with a fresh key, and returns the answers in buyer order.
func (sh *shop) checkoutAll(t *testing.T, bs []buyer, body func(buyer) map[string]any) []response {
	t.Helper()
	reqs := make([]func() (response, error), len(bs))
	for i, b := range bs {
		reqs[i] = func() (response, error) { return sh.tryCheckout(b.Token, uuidx.NewV7(), body(b)) }
	}
	return runTogether(t, reqs...)
}

// TestRace_LastUnits: six buyers hold one unit each of a variant with three
// left, and check out at once. Exactly three orders are placed, the other
// three are 409 CHECKOUT_PROBLEMS (insufficient_stock), the stock ends at
// 0 and never below, and the order lines add up to the three units sold.
func TestRace_LastUnits(t *testing.T) {
	provider := &testShipping{}
	sh := newShop(t, nil, app.WithShippingProvider(provider))
	bs := sh.buyers(t, "sisa", 6)
	tally := map[string]int{}
	for i := range raceIterations {
		sh.resetBuyers(t)
		p := sh.product(t, fmt.Sprintf("kaos-sisa-%d", i), variant(fmt.Sprintf("SISA-%d", i), "M", 50000, 3))
		v := p.Variants[fmt.Sprintf("SISA-%d", i)]
		for _, b := range bs {
			sh.add(t, b, v, 1)
		}
		provider.barrier(len(bs))
		results := sh.checkoutAll(t, bs, func(b buyer) map[string]any { return checkoutBody(b.AddressID) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		placed := 0
		for _, r := range results {
			switch {
			case r.Status == http.StatusCreated:
				placed++
			case is(r, http.StatusConflict, "CHECKOUT_PROBLEMS"):
				if lines := assertCheckoutProblems(t, r, "loser"); lines[0].Problem != "insufficient_stock" || lines[0].Available != 0 {
					t.Errorf("iteration %d: loser's problem %+v, want insufficient_stock with 0 available", i, lines[0])
				}
			default:
				t.Errorf("iteration %d: %s", i, describe(r))
			}
		}
		for k, n := range statusCounts(t, results) {
			tally[k] += n
		}
		sold := sh.count(t, `SELECT COALESCE(sum(quantity), 0) FROM order_items WHERE variant_id = $1`, v)
		if placed != 3 || sh.stock(t, v) != 0 || sold != 3 {
			t.Fatalf("iteration %d: %d orders, stock %d, %d units in order lines; want 3, 0, 3", i, placed, sh.stock(t, v), sold)
		}
	}
	t.Logf("answers over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}

// TestRace_OneCartTwoKeys: the web and the phone check out the same cart at
// once with different Idempotency-Keys, both after reading the cart. The
// cart lock lets exactly one order through; the other is 409 CART_CHANGED,
// writes nothing and releases its key.
func TestRace_OneCartTwoKeys(t *testing.T) {
	provider := &testShipping{}
	sh := newShop(t, nil, app.WithShippingProvider(provider))
	b := sh.buyer(t, "dua-kunci")
	for i := range raceIterations {
		sh.resetBuyers(t)
		p := sh.product(t, fmt.Sprintf("kaos-dua-kunci-%d", i), variant(fmt.Sprintf("DK-%d-M", i), "M", 50000, 10),
			variant(fmt.Sprintf("DK-%d-L", i), "L", 60000, 10))
		for _, v := range p.Variants {
			sh.add(t, b, v, 2)
		}
		keys := []string{uuidx.NewV7(), uuidx.NewV7()}
		provider.barrier(2)
		results := runTogether(t,
			func() (response, error) { return sh.tryCheckout(b.Token, keys[0], checkoutBody(b.AddressID)) },
			func() (response, error) { return sh.tryCheckout(b.Token, keys[1], checkoutBody(b.AddressID)) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		ok := slices.IndexFunc(results, func(r response) bool { return r.Status == http.StatusCreated })
		if ok < 0 || !is(results[1-ok], http.StatusConflict, "CART_CHANGED") {
			t.Fatalf("iteration %d: %s and %s, want one 201 and one 409 CART_CHANGED", i, describe(results[0]), describe(results[1]))
		}
		for _, v := range p.Variants {
			if s := sh.stock(t, v); s != 8 {
				t.Errorf("iteration %d: stock %d, want 8 (sold once)", i, s)
			}
		}
		if n := sh.count(t, `SELECT count(*) FROM orders WHERE user_id = $1 AND status = 'pending_payment'`, b.ID); n != 1 {
			t.Errorf("iteration %d: %d orders, want 1", i, n)
		}
		if got := queryStrings(t, sh.db, `SELECT key FROM idempotency_keys WHERE user_id = $1 AND key = ANY($2)`, b.ID, keys); len(got) != 1 || got[0] != keys[ok] {
			t.Errorf("iteration %d: keys left %v, want only the winner's", i, got)
		}
	}
	assertNoServerErrors(t, sh.server)
}

// TestRace_SharedVariantsOppositeOrder: two buyers hold the same two
// last-unit variants, added in opposite orders, and check out at once.
// Checkout locks variants in id order, so the two never wait on each
// other in a circle: one order, one 409 CHECKOUT_PROBLEMS, no deadlock.
// A third pair of buyers shares two plentiful variants the same way, and
// both of them get their order.
func TestRace_SharedVariantsOppositeOrder(t *testing.T) {
	provider := &testShipping{}
	sh := newShop(t, nil, app.WithShippingProvider(provider))
	bs := sh.buyers(t, "silang", 4)
	for i := range raceIterations {
		sh.resetBuyers(t)
		p := sh.product(t, fmt.Sprintf("kaos-silang-%d", i),
			variant(fmt.Sprintf("SL-%d-A", i), "A", 10000, 1), variant(fmt.Sprintf("SL-%d-B", i), "B", 10000, 1),
			variant(fmt.Sprintf("SL-%d-C", i), "C", 10000, 50), variant(fmt.Sprintf("SL-%d-D", i), "D", 10000, 50))
		v := func(s string) string { return p.Variants[fmt.Sprintf("SL-%d-%s", i, s)] }
		sh.add(t, bs[0], v("A"), 1)
		sh.add(t, bs[0], v("B"), 1)
		sh.add(t, bs[1], v("B"), 1)
		sh.add(t, bs[1], v("A"), 1)
		sh.add(t, bs[2], v("C"), 2)
		sh.add(t, bs[2], v("D"), 2)
		sh.add(t, bs[3], v("D"), 3)
		sh.add(t, bs[3], v("C"), 3)
		provider.barrier(len(bs))
		results := sh.checkoutAll(t, bs, func(b buyer) map[string]any { return checkoutBody(b.AddressID) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		scarce := statusCounts(t, results[:2])
		if scarce["201"] != 1 || scarce["409 CHECKOUT_PROBLEMS"] != 1 {
			t.Fatalf("iteration %d: last units = %v, want one 201 and one CHECKOUT_PROBLEMS", i, scarce)
		}
		if results[2].Status != http.StatusCreated || results[3].Status != http.StatusCreated {
			t.Fatalf("iteration %d: plentiful = %s, %s; want two 201", i, describe(results[2]), describe(results[3]))
		}
		if sh.stock(t, v("A")) != 0 || sh.stock(t, v("B")) != 0 || sh.stock(t, v("C")) != 45 || sh.stock(t, v("D")) != 45 {
			t.Fatalf("iteration %d: stock A %d B %d C %d D %d", i, sh.stock(t, v("A")), sh.stock(t, v("B")), sh.stock(t, v("C")), sh.stock(t, v("D")))
		}
	}
	assertNoServerErrors(t, sh.server)
}
