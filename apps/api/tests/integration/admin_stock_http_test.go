//go:build integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// Stock adjustments (Bab 12 artikel 05): POST
// /v1/admin/products/{id}/variants/{variant_id}/stock-adjustments against
// real PostgreSQL, alone and racing checkouts.

// stockPath is the adjustment URL of one variant.
func stockPath(productID, variantID string) string {
	return "/v1/admin/products/" + productID + "/variants/" + variantID + "/stock-adjustments"
}

// assertVariantDetail checks a 200 AdminVariantDetail against the contract
// and decodes its variant.
func assertVariantDetail(t *testing.T, resp response, what string) adminVariantOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	top := object(t, resp.Body, "AdminVariantDetail", what)
	obj := object(t, top["data"], "AdminVariant", what+".data")
	assertMoney(t, obj["price"], what+".data.price")
	var v adminVariantOut
	if err := json.Unmarshal(top["data"], &v); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	return v
}

// productVersion is a product's version and updated_at in PostgreSQL, as
// text so the two compare exactly.
func (sh *shop) productVersion(t *testing.T, productID string) string {
	t.Helper()
	return queryStrings(t, sh.db, `SELECT version::text || ' ' || updated_at::text FROM products WHERE id = $1`, productID)[0]
}

// variantVersion is a variant's version in PostgreSQL.
func (sh *shop) variantVersion(t *testing.T, variantID string) int {
	t.Helper()
	return sh.count(t, `SELECT version FROM product_variants WHERE id = $1`, variantID)
}

// TestAdminStock_Adjust walks both forms of the adjustment and every
// refusal: each change bumps the variant's version and never the
// product's version or updated_at; a refused change changes nothing.
func TestAdminStock_Adjust(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-stok", variant("ST-M", "M", 50000, 10), variant("ST-L", "L", 60000, 10))
	other := sh.product(t, "kaos-stok-lain", variant("SL-M", "M", 50000, 10))
	m, l := p.Variants["ST-M"], p.Variants["ST-L"]
	path := stockPath(p.ID, m)
	productBefore := sh.productVersion(t, p.ID)

	version := sh.variantVersion(t, m)
	v := assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": 20}), "delta +20")
	if v.ID != m || v.SKU != "ST-M" || v.Stock != 30 || int(v.Version) != version+1 || v.Price != moneyOf(50000) {
		t.Errorf("after +20: %+v, want stock 30 and version %d", v, version+1)
	}
	v = assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": -2}), "delta -2")
	if v.Stock != 28 || int(v.Version) != version+2 {
		t.Errorf("after -2: %+v", v)
	}
	v = assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"set": 15, "expected": 28}), "count")
	if v.Stock != 15 || int(v.Version) != version+3 {
		t.Errorf("after the count: %+v", v)
	}

	refused := func(body map[string]any, code string, stock float64) {
		t.Helper()
		before := sh.variantVersion(t, m)
		details := assertErrorDetails(t, sh.staffCall(t, http.MethodPost, path, body), http.StatusConflict, code)
		if details["variant_id"] != m || details["stock"] != stock {
			t.Errorf("%v: details %v, want variant_id %s and stock %v", body, details, m, stock)
		}
		if code == "STOCK_OUT_OF_RANGE" && (details["min"] != 0.0 || details["max"] != float64(product.MaxVariantStock)) {
			t.Errorf("%v: details %v, want min 0 and max %d", body, details, product.MaxVariantStock)
		}
		if sh.stock(t, m) != int(stock) || sh.variantVersion(t, m) != before {
			t.Errorf("%v: a refused change wrote the variant", body)
		}
	}
	refused(map[string]any{"delta": -16}, "STOCK_OUT_OF_RANGE", 15)
	refused(map[string]any{"delta": product.MaxVariantStock - 14}, "STOCK_OUT_OF_RANGE", 15)
	refused(map[string]any{"set": 40, "expected": 12}, "STOCK_CHANGED", 15)

	// To 0 and to the maximum exactly.
	if v := assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": -15}), "to 0"); v.Stock != 0 {
		t.Errorf("to 0: %+v", v)
	}
	if v := assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": product.MaxVariantStock}), "to max"); v.Stock != product.MaxVariantStock {
		t.Errorf("to the maximum: %+v", v)
	}
	if sh.stock(t, l) != 10 {
		t.Errorf("the other variant moved: %d", sh.stock(t, l))
	}
	if after := sh.productVersion(t, p.ID); after != productBefore {
		t.Errorf("stock changes moved the product's version or updated_at: %s → %s", productBefore, after)
	}

	t.Run("not found", func(t *testing.T) {
		for _, p := range []string{
			stockPath(p.ID, uuidx.NewV7()),
			stockPath(p.ID, other.Variants["SL-M"]), // another product's variant
			stockPath(other.ID, m),
			stockPath(uuidx.NewV7(), m),
			stockPath(p.ID, "bukan-uuid"),
			stockPath("bukan-uuid", m),
		} {
			assertError(t, sh.staffCall(t, http.MethodPost, p, map[string]any{"delta": 1}), http.StatusNotFound, "NOT_FOUND")
		}
	})

	t.Run("archived variant", func(t *testing.T) {
		mustExec(t, sh.db, `UPDATE product_variants SET archived_at = now() WHERE id = $1`, l)
		for _, body := range []map[string]any{{"delta": 1}, {"set": 3, "expected": 10}} {
			details := assertErrorDetails(t, sh.staffCall(t, http.MethodPost, stockPath(p.ID, l), body), http.StatusConflict, "VARIANT_ARCHIVED")
			if details["variant_id"] != l {
				t.Errorf("details = %v", details)
			}
		}
		if sh.stock(t, l) != 10 {
			t.Errorf("the archived variant's stock moved: %d", sh.stock(t, l))
		}
	})

	t.Run("access", func(t *testing.T) {
		assertError(t, sh.call(t, http.MethodPost, path, map[string]any{"delta": 1}, ""), http.StatusUnauthorized, "UNAUTHORIZED")
		_, buyer := sh.newAccount(t, "stok-pembeli")
		assertError(t, sh.call(t, http.MethodPost, path, map[string]any{"delta": -1}, buyer.AccessToken), http.StatusForbidden, "FORBIDDEN")
		seller := sh.accountWithRole(t, user.RoleSeller).AccessToken
		if v := assertVariantDetail(t, sh.call(t, http.MethodPost, path, map[string]any{"delta": -1}, seller), "seller"); v.Stock != product.MaxVariantStock-1 {
			t.Errorf("the seller's change: %+v", v)
		}
	})
	assertNoErrorLog(t, sh.server)
}

// TestAdminStock_BadBodies: every body that is neither {"delta"} nor
// {"set","expected"} in range is 400 VALIDATION_FAILED and changes
// nothing.
func TestAdminStock_BadBodies(t *testing.T) {
	sh := newShop(t, nil)
	sh.bearer = sh.staff
	p := sh.product(t, "kaos-stok-salah", variant("SS-M", "M", 50000, 10))
	m := p.Variants["SS-M"]
	version := sh.variantVersion(t, m)
	for _, body := range []string{
		`{}`, `{"delta":0}`, `{"delta":1,"set":1,"expected":1}`, `{"set":5}`, `{"expected":5}`,
		`{"delta":1000001}`, `{"delta":-1000001}`, `{"set":-1,"expected":0}`, `{"set":1000001,"expected":0}`,
		`{"set":1,"expected":-1}`, `{"set":1,"expected":1000001}`, `{"delta":"5"}`, `{"delta":1.5}`,
		`{"delta":1,"extra":true}`, `[]`, `null`,
	} {
		resp := sh.send(t, http.MethodPost, stockPath(p.ID, m), body)
		if resp.Status != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400: %s", body, resp.Status, resp.Body)
		}
	}
	if sh.stock(t, m) != 10 || sh.variantVersion(t, m) != version {
		t.Error("a refused body changed the variant")
	}
	assertNoErrorLog(t, sh.server)
}

// TestAdminStock_IncreaseCapAfterRestore: a cancel's restore can leave the
// stock above 1,000,000. From there an increase is refused, a decrease
// still works, and a count (whose expected stops at 1,000,000) cannot name
// the stock at all.
func TestAdminStock_IncreaseCapAfterRestore(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-stok-penuh", variant("SP-M", "M", 10000, 10))
	m := p.Variants["SP-M"]
	path := stockPath(p.ID, m)
	assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"set": product.MaxVariantStock, "expected": 10}), "set to max")
	b := sh.buyer(t, "stok-penuh")
	o := sh.order(t, b, line{m, 3})
	assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": 3}), "back to max")
	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	if s := sh.stock(t, m); s != product.MaxVariantStock+3 {
		t.Fatalf("stock after the restore = %d, want %d", s, product.MaxVariantStock+3)
	}

	details := assertErrorDetails(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": 1}), http.StatusConflict, "STOCK_OUT_OF_RANGE")
	if details["stock"] != float64(product.MaxVariantStock+3) {
		t.Errorf("details = %v", details)
	}
	if v := assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": -1}), "a decrease above the cap"); v.Stock != product.MaxVariantStock+2 {
		t.Errorf("after -1: %+v", v)
	}
	assertError(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"set": 5, "expected": product.MaxVariantStock + 2}),
		http.StatusBadRequest, "VALIDATION_FAILED")
	// One change is at most 1,000,000 either way: two bring it to 0.
	assertError(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": -(product.MaxVariantStock + 2)}),
		http.StatusBadRequest, "VALIDATION_FAILED")
	assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": -product.MaxVariantStock}), "-1,000,000")
	if v := assertVariantDetail(t, sh.staffCall(t, http.MethodPost, path, map[string]any{"delta": -2}), "to 0"); v.Stock != 0 {
		t.Errorf("after the decreases: %+v", v)
	}
	// The admin's form, which bounds stock at 1,000,000 too, still loads.
	if got := assertAdminProduct(t, sh.staffCall(t, http.MethodGet, "/v1/admin/products/"+p.ID, nil).Body); got.Variants[0].Stock != 0 {
		t.Errorf("admin GET: %+v", got.Variants[0])
	}
	assertNoErrorLog(t, sh.server)
}

// TestRace_StockAdjustVersusCheckout: buyers check out while sellers add
// and take stock away, all released together. No answer is 5xx, the stock
// is never negative and ends exactly at the start minus what the placed
// orders hold plus what the accepted changes added, and the variant's
// version moved once per accepted write.
func TestRace_StockAdjustVersusCheckout(t *testing.T) {
	// No quote barrier: a checkout that finds too little stock answers
	// before it asks for a quote, so the six would never all arrive.
	sh := newShop(t, nil)
	bs := sh.buyers(t, "stok-balap", 6)
	tally := map[string]int{}
	// Six checkouts of 2 against 8 units; the changes make room for more
	// or take it away, and some of them must be refused.
	deltas := []int{-3, 4, -5, 2, -1, -6}
	for i := range raceIterations {
		sh.resetBuyers(t)
		sku := fmt.Sprintf("SB-%d", i)
		p := sh.product(t, fmt.Sprintf("kaos-stok-balap-%d", i), variant(sku, "M", 50000, 8))
		v := p.Variants[sku]
		for _, b := range bs {
			sh.add(t, b, v, 2)
		}
		version := sh.variantVersion(t, v)
		reqs := make([]func() (response, error), 0, len(bs)+len(deltas))
		for _, b := range bs {
			reqs = append(reqs, func() (response, error) {
				return sh.tryCheckout(b.Token, uuidx.NewV7(), checkoutBody(b.AddressID))
			})
		}
		for _, d := range deltas {
			reqs = append(reqs, func() (response, error) {
				return sh.tryCall(http.MethodPost, stockPath(p.ID, v), map[string]any{"delta": d}, sh.staff, nil)
			})
		}
		results := runTogether(t, reqs...)
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)

		placed, added, writes := 0, 0, 0
		for j, r := range results {
			switch {
			case j < len(bs) && r.Status == http.StatusCreated:
				placed++
			case j < len(bs) && is(r, http.StatusConflict, "CHECKOUT_PROBLEMS"):
			case j >= len(bs) && r.Status == http.StatusOK:
				added += deltas[j-len(bs)]
				writes++
			case j >= len(bs) && is(r, http.StatusConflict, "STOCK_OUT_OF_RANGE"):
			default:
				t.Errorf("iteration %d, request %d: %s", i, j, describe(r))
			}
		}
		for k, n := range statusCounts(t, results) {
			tally[k] += n
		}
		sold := sh.count(t, `SELECT COALESCE(sum(quantity), 0) FROM order_items WHERE variant_id = $1`, v)
		stock := sh.stock(t, v)
		if sold != placed*2 || stock < 0 || stock != 8-sold+added {
			t.Fatalf("iteration %d: %d orders, %d units in order lines, %d added, stock %d; want stock 8 - sold + added, never negative",
				i, placed, sold, added, stock)
		}
		if got := sh.variantVersion(t, v); got != version+placed+writes {
			t.Fatalf("iteration %d: version %d → %d after %d orders and %d changes", i, version, got, placed, writes)
		}
	}
	t.Logf("answers over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}
