//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// TestCart_GuestToken: a guest's first add creates a cart and returns its
// token once, in the body and in X-Cart-Token; only the SHA-256 of the
// secret is stored; the token reads and writes that cart; malformed,
// unknown and forged tokens are 404 CART_NOT_FOUND; and a signed-in
// request ignores the header and uses the user's own cart.
func TestCart_GuestToken(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-tamu", variant("TM-M", "M", 70000, 9), variant("TM-L", "L", 75000, 9))
	m, l := p.Variants["TM-M"], p.Variants["TM-L"]

	if c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, "", ""), "guest GET without a token"); len(c.Lines) != 0 {
		t.Errorf("a guest without a token sees %+v", c)
	}
	created := assertCart(t, sh.addItem(t, "", "", m, 2), "guest's first add")
	if created.Token == "" || len(created.Lines) != 1 {
		t.Fatalf("first guest add = %+v, want a new cart with a token", created)
	}
	cartID, secret, _ := strings.Cut(created.Token, ".")
	if n := sh.count(t, `SELECT count(*) FROM carts WHERE id = $1 AND user_id IS NULL AND octet_length(token_hash) = 32
		AND token_hash = sha256(decode(translate($2, '-_', '+/') || '=', 'base64'))`, cartID, secret); n != 1 {
		t.Error("the guest cart row does not hold the SHA-256 of the token's secret")
	}
	if n := sh.count(t, `SELECT count(*) FROM carts WHERE position(convert_to($1, 'UTF8') in token_hash) > 0`, secret); n != 0 {
		t.Error("the token's secret is stored in clear")
	}

	again := assertCart(t, sh.addItem(t, "", created.Token, l, 1), "guest add with the token")
	if again.Token != "" || len(again.Lines) != 2 {
		t.Errorf("second add = %+v, want the same cart with two lines and no new token", again)
	}
	assertCart(t, sh.cartReq(t, http.MethodPatch, "/v1/cart/items/"+m, map[string]any{"quantity": 5}, "", created.Token), "guest PATCH")
	assertCart(t, sh.cartReq(t, http.MethodDelete, "/v1/cart/items/"+l, nil, "", created.Token), "guest DELETE")
	if c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, "", created.Token), "guest GET"); len(c.Lines) != 1 || c.Lines[0].Quantity != 5 {
		t.Errorf("guest cart = %+v, want M×5", c.Lines)
	}
	if n := sh.count(t, `SELECT count(*) FROM carts`); n != 1 {
		t.Errorf("%d carts, want the one guest cart", n)
	}

	forged := cartID + "." + strings.Repeat("A", 43)
	for name, token := range map[string]string{
		"malformed": "bukan-token", "unknown cart": uuidx.NewV7() + "." + secret, "wrong secret": forged,
		"too long": strings.Repeat("x", 101),
	} {
		t.Run(name, func(t *testing.T) {
			assertError(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, "", token), http.StatusNotFound, "CART_NOT_FOUND")
			assertError(t, sh.addItem(t, "", token, m, 1), http.StatusNotFound, "CART_NOT_FOUND")
			assertError(t, sh.cartReq(t, http.MethodPatch, "/v1/cart/items/"+m, map[string]any{"quantity": 1}, "", token),
				http.StatusNotFound, "CART_NOT_FOUND")
			assertError(t, sh.cartReq(t, http.MethodDelete, "/v1/cart/items/"+m, nil, "", token), http.StatusNotFound, "CART_NOT_FOUND")
		})
	}

	// A signed-in request uses the user's cart, whatever X-Cart-Token says.
	b := sh.buyer(t, "tamu-login")
	if c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, b.Token, created.Token), "user GET with a guest token"); len(c.Lines) != 0 {
		t.Errorf("a signed-in request read the guest cart: %+v", c.Lines)
	}
	if c := assertCart(t, sh.addItem(t, b.Token, created.Token, l, 1), "user add with a guest token"); c.Token != "" || len(c.Lines) != 1 {
		t.Errorf("a signed-in add = %+v, want the user's cart and no token", c)
	}
	if c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, "", created.Token), "guest GET"); len(c.Lines) != 1 || c.Lines[0].VariantID != m {
		t.Errorf("the guest cart changed: %+v", c.Lines)
	}
	assertNoErrorLog(t, sh.server)
}

// TestCart_GuestCartRateLimit: one client address may create 30 guest
// carts an hour (the real Redis limiter); the 31st is 429 with
// Retry-After, while adds to an existing guest cart are not counted.
func TestCart_GuestCartRateLimit(t *testing.T) {
	s := startServer(t, nil)
	sh := &shop{server: s, cat: newCatalog(t, s.db)}
	p := sh.product(t, "kaos-batas", variant("BT-M", "M", 10000, 99))
	m := p.Variants["BT-M"]
	var token string
	for i := range 30 {
		c := assertCart(t, sh.addItem(t, "", "", m, 1), fmt.Sprintf("guest cart %d", i+1))
		token = c.Token
	}
	resp := sh.addItem(t, "", "", m, 1)
	assertError(t, resp, http.StatusTooManyRequests, "RATE_LIMITED")
	if resp.Header.Get("Retry-After") == "" {
		t.Error("429 without Retry-After")
	}
	for range 5 {
		assertCart(t, sh.addItem(t, "", token, m, 1), "add to an existing guest cart")
	}
	if n := sh.count(t, `SELECT count(*) FROM carts`); n != 30 {
		t.Errorf("%d guest carts, want 30", n)
	}
}

// TestCart_Merge moves a guest cart into a user's cart after login and
// checks every rule of ADR 0006: quantities add up to the stock and to 99,
// a merge never lowers a line the user had, sold-out and unsellable guest
// lines stay behind, the user's lines keep the price their owner saw and
// new lines keep the guest's, and the token merges once.
func TestCart_Merge(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-gabung",
		variant("GB-A", "A", 10000, 10),  // both carts: 2 + 3 = 5
		variant("GB-B", "B", 10000, 6),   // user 5, guest 1, stock then 3: stays 5
		variant("GB-C", "C", 20000, 10),  // guest only: carried, guest's price
		variant("GB-D", "D", 10000, 5),   // guest only, then sold out: dropped
		variant("GB-E", "E", 10000, 5),   // guest only, then archived: dropped
		variant("GB-G", "G", 10000, 500), // both carts 60 + 60: capped at 99
		variant("GB-H", "H", 10000, 9),   // guest 5, stock then 2: carried as 2
	)
	v := p.Variants
	b := sh.buyer(t, "gabung")
	sh.add(t, b, v["GB-A"], 2)
	sh.add(t, b, v["GB-B"], 5)
	sh.add(t, b, v["GB-G"], 60)

	guest := assertCart(t, sh.addItem(t, "", "", v["GB-A"], 3), "guest add").Token
	for _, g := range []line{{v["GB-B"], 1}, {v["GB-C"], 4}, {v["GB-D"], 2}, {v["GB-E"], 1}, {v["GB-G"], 60}, {v["GB-H"], 5}} {
		assertCart(t, sh.addItem(t, "", guest, g.variantID, g.quantity), "guest add")
	}
	mustExec(t, sh.db, `UPDATE product_variants SET stock = 3 WHERE id = $1`, v["GB-B"])
	mustExec(t, sh.db, `UPDATE product_variants SET stock = 0 WHERE id = $1`, v["GB-D"])
	mustExec(t, sh.db, `UPDATE product_variants SET archived_at = now() WHERE id = $1`, v["GB-E"])
	mustExec(t, sh.db, `UPDATE product_variants SET stock = 2 WHERE id = $1`, v["GB-H"])
	mustExec(t, sh.db, `UPDATE product_variants SET price = 25000 WHERE id = $1`, v["GB-C"])

	// Validation and auth first.
	assertError(t, sh.cartReq(t, http.MethodPost, "/v1/cart/merge", nil, b.Token, ""), http.StatusBadRequest, "VALIDATION_FAILED")
	assertUnauthorizedBearer(t, sh.cartReq(t, http.MethodPost, "/v1/cart/merge", nil, "", guest), "merge without a login")

	merged := assertCart(t, sh.cartReq(t, http.MethodPost, "/v1/cart/merge", nil, b.Token, guest), "POST /v1/cart/merge")
	want := map[string]int32{v["GB-A"]: 5, v["GB-B"]: 5, v["GB-C"]: 4, v["GB-G"]: 99, v["GB-H"]: 2}
	if got := merged.quantities(); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("merged quantities = %v, want %v", got, want)
	}
	if c := merged.line(t, v["GB-C"]); c.PriceWhenAdded != moneyOf(20000) || c.Problem == nil || *c.Problem != "price_changed" {
		t.Errorf("C kept %+v, want the guest's price 20000 and price_changed", c)
	}
	if a := merged.line(t, v["GB-A"]); a.PriceWhenAdded != moneyOf(10000) {
		t.Errorf("A = %+v, want the user's price", a)
	}
	if bl := merged.line(t, v["GB-B"]); bl.Problem == nil || *bl.Problem != "insufficient_stock" {
		t.Errorf("B = %+v: the merge kept 5 over a stock of 3, so the line shows insufficient_stock", bl)
	}

	cartID, _, _ := strings.Cut(guest, ".")
	if n := sh.count(t, `SELECT count(*) FROM carts WHERE id = $1`, cartID); n != 0 {
		t.Error("the guest cart was not deleted")
	}
	if n := sh.count(t, `SELECT count(*) FROM cart_items WHERE cart_id = $1`, cartID); n != 0 {
		t.Error("the guest cart's lines are left")
	}
	assertError(t, sh.cartReq(t, http.MethodPost, "/v1/cart/merge", nil, b.Token, guest), http.StatusNotFound, "CART_NOT_FOUND")
	assertError(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, "", guest), http.StatusNotFound, "CART_NOT_FOUND")

	// A user without a cart gets one from the merge.
	fresh := sh.buyer(t, "gabung-baru")
	g2 := assertCart(t, sh.addItem(t, "", "", v["GB-A"], 1), "guest add").Token
	if c := assertCart(t, sh.cartReq(t, http.MethodPost, "/v1/cart/merge", nil, fresh.Token, g2), "merge into no cart"); len(c.Lines) != 1 {
		t.Errorf("merge into a user without a cart = %+v", c.Lines)
	}
	if n := sh.count(t, `SELECT count(*) FROM carts WHERE user_id = $1`, fresh.ID); n != 1 {
		t.Errorf("%d carts for the fresh user, want 1", n)
	}
	assertNoErrorLog(t, sh.server)
}

// TestCORS_ShopHeaders: a browser on an allowed origin may send
// X-Cart-Token and Idempotency-Key (preflight), and read X-Cart-Token on
// the answer that created a guest cart.
func TestCORS_ShopHeaders(t *testing.T) {
	const web = "http://localhost:5173"
	sh := newShop(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": web})
	for _, path := range []string{"/v1/cart/items", "/v1/checkout", "/v1/cart/merge"} {
		resp := sh.do(t, http.MethodOptions, path, map[string]string{
			"Origin": web, "Access-Control-Request-Method": http.MethodPost,
			"Access-Control-Request-Headers": "Authorization, Content-Type, X-Cart-Token, Idempotency-Key",
		})
		if resp.Status != http.StatusOK && resp.Status != http.StatusNoContent {
			t.Fatalf("preflight %s = %d", path, resp.Status)
		}
		allowed := strings.ToLower(resp.Header.Get("Access-Control-Allow-Headers"))
		for _, h := range []string{"x-cart-token", "idempotency-key", "authorization", "content-type"} {
			if !strings.Contains(allowed, h) {
				t.Errorf("preflight %s: Access-Control-Allow-Headers = %q, want %s", path, allowed, h)
			}
		}
	}

	p := sh.product(t, "kaos-cors", variant("CR-M", "M", 10000, 5))
	resp, err := sh.tryCall(http.MethodPost, "/v1/cart/items", map[string]any{"variant_id": p.Variants["CR-M"], "quantity": 1}, "",
		map[string]string{"Origin": web})
	if err != nil {
		t.Fatal(err)
	}
	c := assertCart(t, resp, "cross-origin guest add")
	if resp.Header.Get("Access-Control-Allow-Origin") != web || c.Token == "" {
		t.Errorf("Access-Control-Allow-Origin %q, token %q", resp.Header.Get("Access-Control-Allow-Origin"), c.Token)
	}
	assertExposes(t, resp, exposedHeaders...)
	if !slices.Contains(exposedHeaders, "X-Cart-Token") {
		t.Error("X-Cart-Token is not exposed")
	}
}
