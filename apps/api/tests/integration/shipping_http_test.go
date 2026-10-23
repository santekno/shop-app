//go:build integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
)

// TestShippingQuotes prices the cart with the fixed table (no
// BITESHIP_API_KEY): every service of the three couriers, cheapest first,
// per started kilogram of the cart's weight, lines with problems included.
func TestShippingQuotes(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-ongkir", variant("ON-M", "M", 50000, 20))
	m := p.Variants["ON-M"]
	b := sh.buyer(t, "ongkir")
	other := sh.buyer(t, "ongkir-lain")
	quotes := func(addressID string) response {
		return sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes?address_id="+addressID, nil, b.Token)
	}

	assertError(t, quotes(b.AddressID), http.StatusConflict, "CART_EMPTY")
	sh.add(t, b, m, 6) // 1 200 g: two started kilograms
	mustExec(t, sh.db, `UPDATE product_variants SET price = 51000 WHERE id = $1`, m)

	q := assertQuotes(t, quotes(b.AddressID))
	want := []quoteOut{
		{"sicepat", "SiCepat", "REG", "Reguler", moneyOf(18000), "2-3 days"},
		{"jne", "JNE", "REG", "Reguler", moneyOf(20000), "2-3 days"},
		{"jnt", "J&T Express", "EZ", "Regular", moneyOf(20000), "2-3 days"},
		{"sicepat", "SiCepat", "BEST", "Besok Sampai Tujuan", moneyOf(34000), "1 day"},
		{"jne", "JNE", "YES", "Yakin Esok Sampai", moneyOf(36000), "1 day"},
	}
	if q.WeightGrams != 1200 || asJSON(t, q.Quotes) != asJSON(t, want) {
		t.Errorf("quotes = %d g %s\nwant 1200 g %s", q.WeightGrams, asJSON(t, q.Quotes), asJSON(t, want))
	}

	for name, query := range map[string]string{
		"no address_id": "", "address_id not a uuid": "?address_id=rumah",
	} {
		t.Run(name, func(t *testing.T) {
			details := assertError(t, sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes"+query, nil, b.Token),
				http.StatusBadRequest, "VALIDATION_FAILED")
			if _, ok := details["address_id"]; !ok {
				t.Errorf("details = %v, want address_id", details)
			}
		})
	}
	for name, id := range map[string]string{"another buyer's address": other.AddressID, "unknown address": uuidx.NewV7()} {
		t.Run(name, func(t *testing.T) {
			details := assertError(t, quotes(id), http.StatusBadRequest, "VALIDATION_FAILED")
			if details["address_id"] != "names none of your addresses" {
				t.Errorf("details = %v", details)
			}
		})
	}
	assertUnauthorizedBearer(t, sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes?address_id="+b.AddressID, nil, ""), "quotes without a login")
}

// TestShipping_ProviderDown makes the courier API fail: quotes, a priced
// preview and checkout answer 503 UPSTREAM_UNAVAILABLE; checkout writes
// nothing and frees its key, so the same key places the order once the
// provider is back, with the fee the provider quoted. A preview without a
// courier never asks the provider.
func TestShipping_ProviderDown(t *testing.T) {
	provider := &testShipping{}
	sh := newShop(t, nil, app.WithShippingProvider(provider))
	p := sh.product(t, "kaos-kurir-mati", variant("KR-M", "M", 50000, 5))
	m := p.Variants["KR-M"]
	b := sh.buyer(t, "kurir-mati")
	sh.add(t, b, m, 2)

	provider.failing.Store(true)
	assertError(t, sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes?address_id="+b.AddressID, nil, b.Token),
		http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE")
	assertError(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", checkoutBody(b.AddressID), b.Token),
		http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE")
	calls := provider.calls.Load()
	assertPreview(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", map[string]any{"address_id": b.AddressID}, b.Token))
	if provider.calls.Load() != calls {
		t.Error("a preview without a courier asked the provider")
	}
	key := uuidx.NewV7()
	assertError(t, sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)), http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE")
	if n := sh.count(t, `SELECT count(*) FROM orders`) + sh.count(t, `SELECT count(*) FROM idempotency_keys`); n != 0 {
		t.Errorf("a checkout the provider failed left %d orders and keys", n)
	}
	if s := sh.stock(t, m); s != 5 {
		t.Errorf("stock = %d, want 5", s)
	}

	provider.failing.Store(false)
	resp := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID))
	o := assertOrderDetail(t, resp, http.StatusCreated, "checkout after the provider is back")
	if resp.Header.Get("Idempotency-Replayed") != "" || o.Totals.ShippingFee != moneyOf(10000) {
		t.Errorf("retry = replayed %q, fee %d; want a fresh order with the quoted fee", resp.Header.Get("Idempotency-Replayed"), o.Totals.ShippingFee.Amount)
	}
	// The server logs the provider failures it answered 503 for; nothing
	// else may be an error.
	assertNo5xx(t, "after recovery", resp)
}

// TestShipping_UnknownService: checkout takes the fee of the chosen
// service from the provider's answer, so a service the courier does not
// offer is refused as a validation error, not priced from the client.
func TestShipping_UnknownService(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-layanan", variant("LY-M", "M", 50000, 5))
	b := sh.buyer(t, "layanan")
	sh.add(t, b, p.Variants["LY-M"], 1)
	for _, body := range []map[string]any{
		{"address_id": b.AddressID, "courier": "jne", "service": "EZ"},
		{"address_id": b.AddressID, "courier": "jnt", "service": "REG"},
	} {
		details := assertError(t, sh.checkout(t, b.Token, uuidx.NewV7(), body), http.StatusBadRequest, "VALIDATION_FAILED")
		if _, ok := details["service"]; !ok {
			t.Errorf("details = %v, want service", details)
		}
	}
	o := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(),
		map[string]any{"address_id": b.AddressID, "courier": "sicepat", "service": "BEST"}), http.StatusCreated, "SiCepat BEST")
	if o.Shipping.Courier != "sicepat" || o.Shipping.Service != "BEST" || o.Totals.ShippingFee != moneyOf(17000) {
		t.Errorf("order shipping = %+v, fee %d", o.Shipping, o.Totals.ShippingFee.Amount)
	}
	assertNoErrorLog(t, sh.server)
}
