//go:build integration

package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// TestCheckout_RateLimitPerBuyer runs the real Redis limiter with
// APP_CHECKOUT_LIMIT_PER_MINUTE=3. Each of preview, shipping quotes and
// checkout lets a buyer through three times a minute, whatever the answer;
// the fourth is 429 RATE_LIMITED with Retry-After, before the body is
// validated and before the Idempotency-Key is looked at, and writes
// nothing. The three routes count apart, the limit is per buyer (another
// buyer is unaffected), and a browser may read Retry-After.
func TestCheckout_RateLimitPerBuyer(t *testing.T) {
	const web = "http://localhost:5173"
	s := startServer(t, map[string]string{"APP_CHECKOUT_LIMIT_PER_MINUTE": "3", "APP_CORS_ALLOWED_ORIGINS": web})
	sh := &shop{server: s, cat: newCatalog(t, s.db), staff: s.accountWithRole(t, user.RoleAdmin).AccessToken}
	p := sh.product(t, "kaos-batas-bayar", variant("BB-M", "M", 10000, 50))
	b := sh.buyer(t, "batas-bayar")
	other := sh.buyer(t, "batas-bayar-lain")
	sh.add(t, b, p.Variants["BB-M"], 1)
	sh.add(t, other, p.Variants["BB-M"], 1)

	preview := func(u buyer, body any) response {
		return sh.call(t, http.MethodPost, "/v1/checkout/preview", body, u.Token)
	}
	quotes := func(u buyer) response {
		return sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes?address_id="+u.AddressID, nil, u.Token)
	}

	// Preview: three of anything (200, a 400, a 409), then 429 even for a
	// body that would fail validation.
	assertPreview(t, preview(b, map[string]any{}))
	assertError(t, preview(b, map[string]any{"courier": "jne"}), http.StatusBadRequest, "VALIDATION_FAILED")
	assertError(t, preview(b, map[string]any{"voucher_code": "TIDAKADA"}), http.StatusConflict, "VOUCHER_NOT_APPLICABLE")
	assertRateLimited(t, preview(b, map[string]any{}), time.Minute, "4th preview")
	assertRateLimited(t, preview(b, `{"bukan json`), time.Minute, "preview with a broken body over the limit")

	// Quotes count on their own.
	for range 3 {
		assertQuotes(t, quotes(b))
	}
	assertRateLimited(t, quotes(b), time.Minute, "4th shipping quotes")

	// Checkout: the limit comes before the Idempotency-Key check.
	assertError(t, sh.checkout(t, b.Token, "", checkoutBody(b.AddressID)), http.StatusBadRequest, "IDEMPOTENCY_KEY_REQUIRED")
	assertError(t, sh.checkout(t, b.Token, uuidx.NewV7(), map[string]any{}), http.StatusBadRequest, "VALIDATION_FAILED")
	assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusCreated, "3rd checkout")
	sh.add(t, b, p.Variants["BB-M"], 1)
	assertRateLimited(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), time.Minute, "4th checkout")
	assertRateLimited(t, sh.checkout(t, b.Token, "", checkoutBody(b.AddressID)), time.Minute, "checkout without a key over the limit")
	if n := sh.count(t, `SELECT count(*) FROM orders WHERE user_id = $1`, b.ID) +
		sh.count(t, `SELECT count(*) FROM idempotency_keys WHERE user_id = $1`, b.ID); n != 2 {
		t.Errorf("%d orders and keys, want the one order and its key: a 429 writes nothing", n)
	}

	// A cross-origin 429 can be read, Retry-After included.
	resp, err := sh.tryCall(http.MethodPost, "/v1/checkout/preview", map[string]any{}, b.Token, map[string]string{"Origin": web})
	if err != nil {
		t.Fatal(err)
	}
	assertRateLimited(t, resp, time.Minute, "cross-origin preview over the limit")
	if resp.Header.Get("Access-Control-Allow-Origin") != web {
		t.Errorf("Access-Control-Allow-Origin = %q on the 429", resp.Header.Get("Access-Control-Allow-Origin"))
	}
	assertExposes(t, resp, exposedHeaders...)

	// Another buyer has a budget of their own.
	assertPreview(t, preview(other, map[string]any{}))
	assertQuotes(t, quotes(other))
	assertOrderDetail(t, sh.checkout(t, other.Token, uuidx.NewV7(), checkoutBody(other.AddressID)), http.StatusCreated, "another buyer's checkout")
	assertNoErrorLog(t, sh.server)
}
