//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
)

// TestRace_VoucherLastUse: four buyers check out at once with a voucher
// that has one use left. The guarded UPDATE gives it to exactly one; the
// others are 409 VOUCHER_NOT_APPLICABLE (exhausted) and place nothing, and
// used_count ends at its limit.
func TestRace_VoucherLastUse(t *testing.T) {
	provider := &testShipping{}
	sh := newShop(t, nil, app.WithShippingProvider(provider))
	bs := sh.buyers(t, "voucher-akhir", 4)
	p := sh.product(t, "kaos-voucher-akhir", variant("VA-M", "M", 50000, 10000))
	for i := range raceIterations {
		sh.resetBuyers(t)
		code := fmt.Sprintf("AKHIR%d", i)
		id := sh.voucher(t, voucherSpec{code: code, kind: "fixed", value: 5000, usageLimit: 3})
		mustExec(t, sh.db, `UPDATE vouchers SET used_count = 2 WHERE id = $1`, id)
		for _, b := range bs {
			sh.add(t, b, p.Variants["VA-M"], 1)
		}
		provider.barrier(len(bs))
		results := sh.checkoutAll(t, bs, func(b buyer) map[string]any { return withVoucher(checkoutBody(b.AddressID), code) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		won := 0
		for _, r := range results {
			if r.Status == http.StatusCreated {
				won++
				continue
			}
			if details := assertError(t, r, http.StatusConflict, "VOUCHER_NOT_APPLICABLE"); details["reason"] != "exhausted" {
				t.Errorf("iteration %d: loser's reason %v, want exhausted", i, details["reason"])
			}
		}
		orders := sh.count(t, `SELECT count(*) FROM orders WHERE voucher_id = $1`, id)
		if won != 1 || orders != 1 || sh.usedCount(t, id) != 3 {
			t.Fatalf("iteration %d: %d won, %d orders, used_count %d; want 1, 1, 3", i, won, orders, sh.usedCount(t, id))
		}
	}
	assertNoServerErrors(t, sh.server)
}

// TestRace_VoucherPerUser: a buyer limited to one use cancels the order
// that used it while checking out again with it. Whichever commits first,
// the buyer never holds more live orders with the voucher than the limit,
// and used_count always equals those orders: the cancel gives the use back
// once, and the checkout counts it only when it got the voucher (or is
// refused per_user_limit, never a 5xx).
func TestRace_VoucherPerUser(t *testing.T) {
	sh := newShop(t, nil)
	b := sh.buyer(t, "voucher-pribadi")
	p := sh.product(t, "kaos-voucher-pribadi", variant("VP-M", "M", 50000, 10000))
	tally := map[string]int{}
	for i := range raceIterations {
		sh.resetBuyers(t)
		code := fmt.Sprintf("SEORANG%d", i)
		id := sh.voucher(t, voucherSpec{code: code, kind: "fixed", value: 5000, perUser: 1})
		sh.add(t, b, p.Variants["VP-M"], 1)
		first := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), code)),
			http.StatusCreated, "first use")
		sh.add(t, b, p.Variants["VP-M"], 1)
		results := runTogether(t,
			func() (response, error) {
				return sh.tryCall(http.MethodPost, "/v1/orders/"+first.ID+"/cancel", nil, b.Token, nil)
			},
			func() (response, error) {
				return sh.tryCheckout(b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), code))
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if results[0].Status != http.StatusOK {
			t.Fatalf("iteration %d: cancel = %s", i, describe(results[0]))
		}
		second := results[1]
		if second.Status != http.StatusCreated {
			if details := assertError(t, second, http.StatusConflict, "VOUCHER_NOT_APPLICABLE"); details["reason"] != "per_user_limit" {
				t.Fatalf("iteration %d: second checkout = %s", i, describe(second))
			}
		}
		tally[fmt.Sprint(second.Status)]++
		live := sh.count(t, `SELECT count(*) FROM orders WHERE voucher_id = $1 AND user_id = $2 AND status <> 'cancelled'`, id, b.ID)
		if live > 1 || sh.usedCount(t, id) != live {
			t.Fatalf("iteration %d: %d live orders with the voucher, used_count %d", i, live, sh.usedCount(t, id))
		}
	}
	t.Logf("second checkout over %d iterations: %v (201: the cancel committed first)", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}
