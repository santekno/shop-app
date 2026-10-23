//go:build integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// TestCheckoutPreview_Problems fills a cart with one good line and one of
// each problem: the preview answers 409 CHECKOUT_PROBLEMS with every bad
// line in cart order, with what the buyer needs to fix it; checkout refuses
// the same lines and frees its key; once the buyer fixes them the preview
// passes. Nothing is written by a preview.
func TestCheckoutPreview_Problems(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-pratinjau", variant("PR-OK", "OK", 50000, 10), variant("PR-ARSIP", "Arsip", 40000, 10),
		variant("PR-SEDIKIT", "Sedikit", 30000, 10), variant("PR-HARGA", "Harga", 20000, 10))
	v := p.Variants
	b := sh.buyer(t, "pratinjau")

	assertError(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", map[string]any{}, b.Token), http.StatusConflict, "CART_EMPTY")
	assertUnauthorizedBearer(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", map[string]any{}, ""), "preview without a login")

	sh.add(t, b, v["PR-OK"], 1)
	sh.add(t, b, v["PR-ARSIP"], 2)
	sh.add(t, b, v["PR-SEDIKIT"], 3)
	sh.add(t, b, v["PR-HARGA"], 1)
	mustExec(t, sh.db, `UPDATE product_variants SET archived_at = now() WHERE id = $1`, v["PR-ARSIP"])
	mustExec(t, sh.db, `UPDATE product_variants SET stock = 1 WHERE id = $1`, v["PR-SEDIKIT"])
	mustExec(t, sh.db, `UPDATE product_variants SET price = 25000 WHERE id = $1`, v["PR-HARGA"])

	want := []problemOut{
		{VariantID: v["PR-ARSIP"], SKU: "PR-ARSIP", Problem: "unavailable", Quantity: 2, Available: 0,
			UnitPrice: moneyOf(40000), PriceWhenAdded: moneyOf(40000)},
		{VariantID: v["PR-SEDIKIT"], SKU: "PR-SEDIKIT", Problem: "insufficient_stock", Quantity: 3, Available: 1,
			UnitPrice: moneyOf(30000), PriceWhenAdded: moneyOf(30000)},
		{VariantID: v["PR-HARGA"], SKU: "PR-HARGA", Problem: "price_changed", Quantity: 1, Available: 10,
			UnitPrice: moneyOf(25000), PriceWhenAdded: moneyOf(20000)},
	}
	got := assertCheckoutProblems(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", map[string]any{}, b.Token), "preview")
	if asJSON(t, got) != asJSON(t, want) {
		t.Errorf("preview problems =\n%s\nwant\n%s", asJSON(t, got), asJSON(t, want))
	}

	key := uuidx.NewV7()
	got = assertCheckoutProblems(t, sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)), "checkout")
	if asJSON(t, got) != asJSON(t, want) {
		t.Errorf("checkout problems = %s, want the preview's", asJSON(t, got))
	}
	if n := sh.count(t, `SELECT count(*) FROM idempotency_keys`); n != 0 {
		t.Errorf("a refused checkout left %d idempotency keys, want its key released", n)
	}

	// Fix every line: remove, lower to the stock, accept the price.
	sh.cartReq(t, http.MethodDelete, "/v1/cart/items/"+v["PR-ARSIP"], nil, b.Token, "")
	sh.cartReq(t, http.MethodPatch, "/v1/cart/items/"+v["PR-SEDIKIT"], map[string]any{"quantity": 1}, b.Token, "")
	sh.cartReq(t, http.MethodPatch, "/v1/cart/items/"+v["PR-HARGA"], map[string]any{"quantity": 1}, b.Token, "")
	pv := assertPreview(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", map[string]any{}, b.Token))
	if len(pv.Lines) != 3 || pv.Totals.Subtotal != moneyOf(50000+30000+25000) || pv.Shipping != nil || pv.Voucher != nil ||
		pv.Totals.Total != pv.Totals.Subtotal || pv.Totals.WeightGrams != 600 {
		t.Errorf("preview after the fixes = %+v", pv)
	}

	// The same key works now: it was released, not remembered.
	o := assertOrderDetail(t, sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)), http.StatusCreated, "checkout after the fixes")
	if len(o.Items) != 3 {
		t.Errorf("order has %d items, want 3", len(o.Items))
	}
	assertNoErrorLog(t, sh.server)
}

// TestCheckoutPreview_Refusals: the choice must be complete and the
// address the buyer's own; a preview writes nothing.
func TestCheckoutPreview_Refusals(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-tolak-pratinjau", variant("TP-M", "M", 50000, 10))
	b := sh.buyer(t, "tolak-pratinjau")
	other := sh.buyer(t, "tolak-pratinjau-lain")
	sh.add(t, b, p.Variants["TP-M"], 2)

	tests := []struct {
		name   string
		body   any
		detail string
	}{
		{"courier without service", map[string]any{"address_id": b.AddressID, "courier": "jne"}, "service"},
		{"service without courier", map[string]any{"address_id": b.AddressID, "service": "REG"}, "courier"},
		{"courier without address", map[string]any{"courier": "jne", "service": "REG"}, "address_id"},
		{"unknown courier", map[string]any{"address_id": b.AddressID, "courier": "pos", "service": "REG"}, "courier"},
		{"address not a uuid", map[string]any{"address_id": "rumah"}, "address_id"},
		{"voucher with a symbol", map[string]any{"voucher_code": "HEMAT-10"}, "voucher_code"},
		{"voucher too short", map[string]any{"voucher_code": "AB"}, "voucher_code"},
		{"unknown field", `{"total":1}`, "body"},
		{"another buyer's address", map[string]any{"address_id": other.AddressID}, "address_id"},
		{"an address that does not exist", map[string]any{"address_id": uuidx.NewV7(), "courier": "jne", "service": "REG"}, "address_id"},
		{"a service the courier does not offer", map[string]any{"address_id": b.AddressID, "courier": "jne", "service": "KILAT"}, "service"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			details := assertError(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", tt.body, b.Token), http.StatusBadRequest, "VALIDATION_FAILED")
			if _, ok := details[tt.detail]; !ok {
				t.Errorf("details = %v, want %q", details, tt.detail)
			}
		})
	}
	if n := sh.count(t, `SELECT count(*) FROM orders`) + sh.count(t, `SELECT count(*) FROM outbox_events`); n != 0 {
		t.Errorf("previews wrote %d orders and events", n)
	}
	if s := sh.stock(t, p.Variants["TP-M"]); s != 10 {
		t.Errorf("stock = %d after previews, want 10", s)
	}
	assertNoErrorLog(t, sh.server)
}
