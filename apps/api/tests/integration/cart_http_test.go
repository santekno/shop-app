//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

// TestCart_SignedIn walks a signed-in buyer's cart through every route:
// an empty cart, adding (a second add sums), changing and removing lines,
// oldest line first, and the totals; PostgreSQL holds one cart for the
// user with exactly those lines.
func TestCart_SignedIn(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-keranjang", variant("KK-M", "M", 89000, 10), variant("KK-L", "L", 99000, 4))
	m, l := p.Variants["KK-M"], p.Variants["KK-L"]
	b := sh.buyer(t, "keranjang")

	empty := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, b.Token, ""), "GET /v1/cart (new user)")
	if len(empty.Lines) != 0 || empty.ItemCount != 0 || empty.Subtotal != moneyOf(0) {
		t.Errorf("a new user's cart = %+v, want empty", empty)
	}
	if n := sh.count(t, `SELECT count(*) FROM carts WHERE user_id = $1`, b.ID); n != 0 {
		t.Errorf("reading an empty cart stored %d carts, want none", n)
	}

	c := sh.add(t, b, m, 2)
	if got := c.line(t, m); got.Quantity != 2 || got.UnitPrice != moneyOf(89000) || got.PriceWhenAdded != moneyOf(89000) ||
		got.Problem != nil || got.SKU != "KK-M" || got.ProductSlug != "kaos-keranjang" || got.Stock != 10 || got.WeightGrams != 200 {
		t.Errorf("line after the first add = %+v", got)
	}
	sh.add(t, b, m, 1)
	c = sh.add(t, b, l, 1)
	if len(c.Lines) != 2 || c.Lines[0].VariantID != m || c.Lines[1].VariantID != l || c.Lines[0].Quantity != 3 {
		t.Errorf("cart = %+v, want M×3 (summed) then L×1, oldest first", c.Lines)
	}
	if c.ItemCount != 4 || c.Subtotal != moneyOf(3*89000+99000) {
		t.Errorf("item_count %d, subtotal %d", c.ItemCount, c.Subtotal.Amount)
	}

	c = assertCart(t, sh.cartReq(t, http.MethodPatch, "/v1/cart/items/"+m, map[string]any{"quantity": 7}, b.Token, ""), "PATCH")
	if c.line(t, m).Quantity != 7 {
		t.Errorf("PATCH quantity 7: line = %+v", c.line(t, m))
	}
	c = assertCart(t, sh.cartReq(t, http.MethodDelete, "/v1/cart/items/"+l, nil, b.Token, ""), "DELETE")
	if len(c.Lines) != 1 || c.Lines[0].VariantID != m {
		t.Errorf("after DELETE = %+v, want only M", c.Lines)
	}
	got := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, b.Token, ""), "GET /v1/cart")
	if asJSON(t, got) != asJSON(t, c) {
		t.Errorf("GET %+v differs from the last write's answer %+v", got, c)
	}

	if n := sh.count(t, `SELECT count(*) FROM carts WHERE user_id = $1 AND token_hash IS NULL`, b.ID); n != 1 {
		t.Errorf("%d carts for the user, want exactly one", n)
	}
	if n := sh.count(t, `SELECT count(*) FROM cart_items i JOIN carts c ON c.id = i.cart_id
		WHERE c.user_id = $1 AND i.variant_id = $2 AND i.quantity = 7 AND i.unit_price = 89000`, b.ID, m); n != 1 {
		t.Error("cart_items does not hold M×7 at Rp89.000")
	}
	if n := sh.count(t, `SELECT count(*) FROM cart_items`); n != 1 {
		t.Errorf("%d cart_items rows, want 1", n)
	}

	// Another buyer's cart is separate.
	other := sh.buyer(t, "keranjang-lain")
	if c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, other.Token, ""), "GET other"); len(c.Lines) != 0 {
		t.Errorf("another buyer sees %d lines", len(c.Lines))
	}
	assertNoErrorLog(t, sh.server)
}

// TestCart_Refusals sends one bad cart write per case: the status, code and
// details the contract names, and nothing stored.
func TestCart_Refusals(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-tolak", variant("KT-M", "M", 50000, 3), variant("KT-B", "Besar", 50000, 500),
		variant("KT-A", "Arsip", 50000, 5))
	m, big, archived := p.Variants["KT-M"], p.Variants["KT-B"], p.Variants["KT-A"]
	mustExec(t, sh.db, `UPDATE product_variants SET archived_at = now() WHERE id = $1`, archived)
	draft := sh.cat.createWithStatus(t, product.StatusDraft, "kaos", "kaos-draf", "Kaos Draf", "draf", variant("KD-M", "M", 50000, 5))
	draftVariant := queryStrings(t, sh.db, `SELECT id FROM product_variants WHERE product_id = $1`, draft)[0]
	b := sh.buyer(t, "tolak")
	sh.add(t, b, big, 60)

	tests := []struct {
		name, method, path string
		body               any
		status             int
		code               string
		detail             string // a key of details that must be present
	}{
		{"zero quantity", "POST", "/v1/cart/items", map[string]any{"variant_id": m, "quantity": 0}, 400, "VALIDATION_FAILED", "quantity"},
		{"100 units", "POST", "/v1/cart/items", map[string]any{"variant_id": m, "quantity": 100}, 400, "VALIDATION_FAILED", "quantity"},
		{"not a uuid", "POST", "/v1/cart/items", map[string]any{"variant_id": "kaos", "quantity": 1}, 400, "VALIDATION_FAILED", "variant_id"},
		{"unknown field", "POST", "/v1/cart/items", `{"variant_id":"` + m + `","quantity":1,"price":1}`, 400, "VALIDATION_FAILED", "body"},
		{"unknown variant", "POST", "/v1/cart/items", map[string]any{"variant_id": uuidx.NewV7(), "quantity": 1}, 409, "VARIANT_UNAVAILABLE", ""},
		{"archived variant", "POST", "/v1/cart/items", map[string]any{"variant_id": archived, "quantity": 1}, 409, "VARIANT_UNAVAILABLE", ""},
		{"draft product", "POST", "/v1/cart/items", map[string]any{"variant_id": draftVariant, "quantity": 1}, 409, "VARIANT_UNAVAILABLE", ""},
		{"more than the stock", "POST", "/v1/cart/items", map[string]any{"variant_id": m, "quantity": 4}, 409, "INSUFFICIENT_STOCK", "available"},
		{"sum past 99", "POST", "/v1/cart/items", map[string]any{"variant_id": big, "quantity": 40}, 409, "QUANTITY_LIMIT", "max"},
		{"PATCH a line not in the cart", "PATCH", "/v1/cart/items/" + m, map[string]any{"quantity": 1}, 404, "NOT_FOUND", ""},
		{"PATCH not a uuid", "PATCH", "/v1/cart/items/kaos", map[string]any{"quantity": 1}, 404, "NOT_FOUND", ""},
		{"PATCH zero", "PATCH", "/v1/cart/items/" + big, map[string]any{"quantity": 0}, 400, "VALIDATION_FAILED", "quantity"},
		{"PATCH past the stock", "PATCH", "/v1/cart/items/" + big, map[string]any{"quantity": 99}, 200, "", ""},
		{"DELETE a line not in the cart", "DELETE", "/v1/cart/items/" + m, nil, 404, "NOT_FOUND", ""},
		{"DELETE not a uuid", "DELETE", "/v1/cart/items/x", nil, 404, "NOT_FOUND", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := sh.cartReq(t, tt.method, tt.path, tt.body, b.Token, "")
			if tt.status == http.StatusOK {
				assertCart(t, resp, tt.name)
				return
			}
			details := assertError(t, resp, tt.status, tt.code)
			if tt.detail != "" {
				if _, ok := details[tt.detail]; !ok {
					t.Errorf("details = %v, want %q", details, tt.detail)
				}
			}
			if tt.code == "INSUFFICIENT_STOCK" && details["available"] != float64(3) {
				t.Errorf("available = %v, want 3", details["available"])
			}
			if tt.code == "QUANTITY_LIMIT" && details["max"] != float64(99) {
				t.Errorf("max = %v, want 99", details["max"])
			}
		})
	}
	if q := sh.count(t, `SELECT quantity FROM cart_items WHERE variant_id = $1`, big); q != 99 {
		t.Errorf("the big line holds %d, want 99 from the one accepted PATCH", q)
	}
	if n := sh.count(t, `SELECT count(*) FROM cart_items`); n != 1 {
		t.Errorf("%d cart lines, want only the big one", n)
	}

	// A token that is sent must be valid, even on routes guests may use.
	resp := sh.cartReq(t, http.MethodGet, "/v1/cart", nil, "not-a-jwt", "")
	assertUnauthorizedBearer(t, resp, "GET /v1/cart with a bad token")
	assertNoErrorLog(t, sh.server)
}

// TestCart_Full fills a cart to 50 lines; the 51st variant is 409
// CART_FULL, while adding to a line already there still works.
func TestCart_Full(t *testing.T) {
	sh := newShop(t, nil)
	var ids []string
	for i := range 2 {
		var vs []product.VariantInput
		for j := range 26 {
			vs = append(vs, variant(fmt.Sprintf("PENUH-%d-%02d", i, j), fmt.Sprintf("V%d", j), 1000, 5))
		}
		p := sh.product(t, fmt.Sprintf("kaos-penuh-%d", i), vs...)
		for _, id := range p.Variants {
			ids = append(ids, id)
		}
	}
	b := sh.buyer(t, "penuh")
	for _, id := range ids[:50] {
		sh.add(t, b, id, 1)
	}
	details := assertError(t, sh.addItem(t, b.Token, "", ids[50], 1), http.StatusConflict, "CART_FULL")
	if details["max"] != float64(50) {
		t.Errorf("max = %v, want 50", details["max"])
	}
	if c := sh.add(t, b, ids[0], 1); len(c.Lines) != 50 || c.line(t, ids[0]).Quantity != 2 {
		t.Errorf("adding to an existing line of a full cart: %d lines", len(c.Lines))
	}
}

// TestCart_Problems shows a line's problem as the catalog changes under
// it: a new price (saving the same quantity accepts it), too little stock,
// and an archived variant.
func TestCart_Problems(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-masalah", variant("KM-M", "M", 50000, 10))
	m := p.Variants["KM-M"]
	b := sh.buyer(t, "masalah")
	sh.add(t, b, m, 4)
	get := func() cartLineOut {
		return assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, b.Token, ""), "GET /v1/cart").line(t, m)
	}

	mustExec(t, sh.db, `UPDATE product_variants SET price = 55000 WHERE id = $1`, m)
	if l := get(); l.Problem == nil || *l.Problem != "price_changed" || l.UnitPrice != moneyOf(55000) ||
		l.PriceWhenAdded != moneyOf(50000) || l.LineTotal != moneyOf(4*55000) {
		t.Errorf("after a price rise: %+v, want price_changed at 55000 (seen 50000)", l)
	}
	c := assertCart(t, sh.cartReq(t, http.MethodPatch, "/v1/cart/items/"+m, map[string]any{"quantity": 4}, b.Token, ""), "PATCH same quantity")
	if l := c.line(t, m); l.Problem != nil || l.PriceWhenAdded != moneyOf(55000) {
		t.Errorf("saving the same quantity did not accept the price: %+v", l)
	}

	mustExec(t, sh.db, `UPDATE product_variants SET stock = 3 WHERE id = $1`, m)
	if l := get(); l.Problem == nil || *l.Problem != "insufficient_stock" || l.Stock != 3 {
		t.Errorf("after the stock fell to 3: %+v, want insufficient_stock", l)
	}
	mustExec(t, sh.db, `UPDATE product_variants SET archived_at = now() WHERE id = $1`, m)
	if l := get(); l.Problem == nil || *l.Problem != "unavailable" {
		t.Errorf("after archiving: %+v, want unavailable", l)
	}
	// An archived line can still be removed.
	if c := assertCart(t, sh.cartReq(t, http.MethodDelete, "/v1/cart/items/"+m, nil, b.Token, ""), "DELETE archived"); len(c.Lines) != 0 {
		t.Errorf("after DELETE: %+v", c.Lines)
	}
}
