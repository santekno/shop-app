//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// TestRace_SameIdempotencyKey: a phone retries one checkout five times at
// once with the same key and body. Exactly one order is placed and the
// stock is taken once; every answer is that order's 201 (byte for byte,
// replays marked) or 409 IDEMPOTENCY_IN_PROGRESS.
func TestRace_SameIdempotencyKey(t *testing.T) {
	sh := newShop(t, nil)
	b := sh.buyer(t, "kunci-sama")
	tally := map[string]int{}
	for i := range raceIterations {
		sh.resetBuyers(t)
		p := sh.product(t, fmt.Sprintf("kaos-kunci-sama-%d", i), variant(fmt.Sprintf("KS-%d", i), "M", 50000, 10))
		v := p.Variants[fmt.Sprintf("KS-%d", i)]
		sh.add(t, b, v, 2)
		key := uuidx.NewV7()
		reqs := make([]func() (response, error), 5)
		for j := range reqs {
			reqs[j] = func() (response, error) { return sh.tryCheckout(b.Token, key, checkoutBody(b.AddressID)) }
		}
		results := runTogether(t, reqs...)
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		var body string
		fresh := 0
		for _, r := range results {
			switch {
			case r.Status == http.StatusCreated:
				if body != "" && string(r.Body) != body {
					t.Errorf("iteration %d: two different 201 bodies", i)
				}
				body = string(r.Body)
				if r.Header.Get("Idempotency-Replayed") != "true" {
					fresh++
				}
			case is(r, http.StatusConflict, "IDEMPOTENCY_IN_PROGRESS"):
			default:
				t.Errorf("iteration %d: %s", i, describe(r))
			}
		}
		for k, n := range statusCounts(t, results) {
			tally[k] += n
		}
		orders := sh.count(t, `SELECT count(*) FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.variant_id = $1`, v)
		if fresh != 1 || orders != 1 || sh.stock(t, v) != 8 {
			t.Fatalf("iteration %d: %d unmarked 201s, %d orders, stock %d; want 1, 1, 8", i, fresh, orders, sh.stock(t, v))
		}
	}
	t.Logf("answers over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}
