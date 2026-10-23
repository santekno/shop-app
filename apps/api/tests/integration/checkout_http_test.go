//go:build integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
)

// TestCheckout_PlacesOrder places an order and checks everything the one
// transaction of ADR 0006 writes: the 201 with Location (and no replay
// header), the order waiting for payment for APP_PAYMENT_TTL, the line and
// address snapshots, the stock taken from each variant (its version
// bumped), the ordered lines gone from the cart, order.created in the
// outbox, and the answer stored under the idempotency key. GET of the
// order answers the same body. Later catalog and address edits do not
// change the order.
func TestCheckout_PlacesOrder(t *testing.T) {
	sh := newShop(t, map[string]string{"APP_PAYMENT_TTL": "2h"})
	p := sh.product(t, "kaos-pesan", variant("PS-M", "M", 89000, 10), variant("PS-L", "L", 99000, 5))
	m, l := p.Variants["PS-M"], p.Variants["PS-L"]
	b := sh.buyer(t, "pesan")
	sh.add(t, b, l, 1)
	sh.add(t, b, m, 3)
	versionBefore := sh.count(t, `SELECT version FROM product_variants WHERE id = $1`, m)
	key := uuidx.NewV7()

	before := time.Now()
	resp := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID))
	o := assertOrderDetail(t, resp, http.StatusCreated, "POST /v1/checkout")
	if loc := resp.Header.Get("Location"); loc != "/v1/orders/"+o.ID {
		t.Errorf("Location = %q, want /v1/orders/%s", loc, o.ID)
	}
	if h := resp.Header.Get("Idempotency-Replayed"); h != "" {
		t.Errorf("Idempotency-Replayed = %q on a first answer", h)
	}
	if o.Status != "pending_payment" || o.CancelReason != nil || o.PaidAt != nil || o.VoucherCode != nil {
		t.Errorf("new order = %+v, want pending_payment without payment or voucher", o)
	}
	if d := o.PaymentExpiresAt.Sub(o.CreatedAt); d < 2*time.Hour-time.Second || d > 2*time.Hour+time.Second {
		t.Errorf("payment_expires_at is %s after created_at, want APP_PAYMENT_TTL 2h", d)
	}
	if wib := before.In(time.FixedZone("WIB", 7*3600)).Format("20060102"); o.Code[3:11] != wib {
		t.Errorf("code %s, want the date %s in WIB", o.Code, wib)
	}
	wantItems := map[string]orderItemOut{
		m: {VariantID: m, ProductName: "Kaos kaos-pesan", VariantName: "M", SKU: "PS-M", UnitPrice: moneyOf(89000), Quantity: 3, LineTotal: moneyOf(267000)},
		l: {VariantID: l, ProductName: "Kaos kaos-pesan", VariantName: "L", SKU: "PS-L", UnitPrice: moneyOf(99000), Quantity: 1, LineTotal: moneyOf(99000)},
	}
	if len(o.Items) != 2 {
		t.Fatalf("items = %+v", o.Items)
	}
	for _, it := range o.Items {
		want := wantItems[it.VariantID]
		want.ID = it.ID
		if it != want {
			t.Errorf("item = %+v, want %+v", it, want)
		}
	}
	a := o.Shipping.Address
	if o.Shipping.Courier != "jne" || o.Shipping.Service != "REG" || o.Shipping.TrackingNumber != nil ||
		a.RecipientName != "Budi Santoso" || a.City != "Bandung" || a.PostalCode != "40111" || a.Street != "Jl. Merdeka No. 10" {
		t.Errorf("shipping = %+v", o.Shipping)
	}
	// 4 units × 200 g = 800 g: one kilogram of JNE REG.
	if o.Totals != (totalsOut{moneyOf(366000), moneyOf(0), moneyOf(10000), moneyOf(376000), 800}) {
		t.Errorf("totals = %+v", o.Totals)
	}

	if sh.stock(t, m) != 7 || sh.stock(t, l) != 4 {
		t.Errorf("stock M %d, L %d; want 7 and 4", sh.stock(t, m), sh.stock(t, l))
	}
	if v := sh.count(t, `SELECT version FROM product_variants WHERE id = $1`, m); v <= versionBefore {
		t.Errorf("version %d → %d: a sale must bump it", versionBefore, v)
	}
	if c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, b.Token, ""), "cart after checkout"); len(c.Lines) != 0 {
		t.Errorf("cart after checkout = %+v, want empty", c.Lines)
	}
	sh.assertEvents(t, o.ID, "order.created")
	var payload map[string]any
	raw := queryStrings(t, sh.db, `SELECT payload::text FROM outbox_events WHERE aggregate_id = $1`, o.ID)[0]
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["order_id"] != o.ID || payload["code"] != o.Code || payload["user_id"] != b.ID ||
		payload["status"] != "pending_payment" || payload["total"] != float64(376000) || payload["currency"] != "IDR" {
		t.Errorf("order.created payload = %v", payload)
	}
	if n := sh.count(t, `SELECT count(*) FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND response_status = 201
		AND order_id = $3 AND response_body::text = $4`, b.ID, key, o.ID, string(resp.Body)); n != 1 {
		t.Error("the idempotency key does not hold the exact 201 answer")
	}
	got := sh.call(t, http.MethodGet, "/v1/orders/"+o.ID, nil, b.Token)
	assertOrderDetail(t, got, http.StatusOK, "GET /v1/orders/{id}")
	if string(got.Body) != string(resp.Body) {
		t.Errorf("GET the order:\n%s\nwant the checkout's answer:\n%s", got.Body, resp.Body)
	}

	// Snapshots: rename, reprice and re-address everything; the order
	// stays as it was bought.
	mustExec(t, sh.db, `UPDATE products SET name = 'Nama Baru' WHERE id = $1`, p.ID)
	mustExec(t, sh.db, `UPDATE product_variants SET name = 'XL', sku = 'PS-BARU', price = 1000 WHERE id = $1`, m)
	assertAddress(t, sh.call(t, http.MethodPatch, "/v1/me/addresses/"+b.AddressID, map[string]any{"city": "Surabaya"}, b.Token), http.StatusOK, "PATCH address")
	if after := sh.call(t, http.MethodGet, "/v1/orders/"+o.ID, nil, b.Token); string(after.Body) != string(resp.Body) {
		t.Errorf("the order changed with the catalog or the address:\n%s", after.Body)
	}
	assertNoErrorLog(t, sh.server)
}

// TestCheckout_Refusals: checkout needs a login, a cart, a complete choice
// and one of the buyer's addresses; none of the refusals writes anything.
func TestCheckout_Refusals(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-tolak-bayar", variant("TB-M", "M", 50000, 5))
	b := sh.buyer(t, "tolak-bayar")
	other := sh.buyer(t, "tolak-bayar-lain")

	assertUnauthorizedBearer(t, sh.checkout(t, "", uuidx.NewV7(), checkoutBody(b.AddressID)), "checkout without a login")
	assertError(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusConflict, "CART_EMPTY")
	sh.add(t, b, p.Variants["TB-M"], 1)
	for name, tt := range map[string]struct {
		body   any
		detail string
	}{
		"no address":              {map[string]any{"courier": "jne", "service": "REG"}, "address_id"},
		"no courier":              {map[string]any{"address_id": b.AddressID, "service": "REG"}, "courier"},
		"no service":              {map[string]any{"address_id": b.AddressID, "courier": "jne"}, "service"},
		"unknown courier":         {map[string]any{"address_id": b.AddressID, "courier": "anteraja", "service": "REG"}, "courier"},
		"a client-side fee":       {`{"address_id":"` + b.AddressID + `","courier":"jne","service":"REG","shipping_fee":0}`, "body"},
		"another buyer's address": {checkoutBody(other.AddressID), "address_id"},
	} {
		t.Run(name, func(t *testing.T) {
			details := assertError(t, sh.checkout(t, b.Token, uuidx.NewV7(), tt.body), http.StatusBadRequest, "VALIDATION_FAILED")
			if _, ok := details[tt.detail]; !ok {
				t.Errorf("details = %v, want %q", details, tt.detail)
			}
		})
	}
	if n := sh.count(t, `SELECT count(*) FROM orders`) + sh.count(t, `SELECT count(*) FROM idempotency_keys`) +
		sh.count(t, `SELECT count(*) FROM outbox_events`); n != 0 {
		t.Errorf("refused checkouts wrote %d rows", n)
	}
	assertNoErrorLog(t, sh.server)
}

// TestCheckout_EmailUnverified: an account that has not verified its email
// cannot order (403 EMAIL_UNVERIFIED, nothing written, key released); after
// the real verification link, the same key places the order.
func TestCheckout_EmailUnverified(t *testing.T) {
	mailer := &recordingMailer{}
	sh := newShop(t, nil, app.WithMailer(mailer))
	p := sh.product(t, "kaos-verif", variant("VF-M", "M", 50000, 5))
	email := uniqueEmail("belum-verif")
	sh.register(t, email, testPassword, "Belum Verifikasi")
	pair := sh.login(t, email, testPassword)
	addr := assertAddress(t, sh.call(t, http.MethodPost, "/v1/me/addresses", addressBody("Rumah", true), pair.AccessToken), http.StatusCreated, "address")
	assertCart(t, sh.addItem(t, pair.AccessToken, "", p.Variants["VF-M"], 1), "add")
	key := uuidx.NewV7()

	assertError(t, sh.checkout(t, pair.AccessToken, key, checkoutBody(addr.ID)), http.StatusForbidden, "EMAIL_UNVERIFIED")
	if n := sh.count(t, `SELECT count(*) FROM orders`) + sh.count(t, `SELECT count(*) FROM idempotency_keys`); n != 0 {
		t.Errorf("an unverified checkout wrote %d rows", n)
	}
	if s := sh.stock(t, p.Variants["VF-M"]); s != 5 {
		t.Errorf("stock = %d, want 5", s)
	}

	if r := sh.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": mailer.lastToken(t, email, subjectVerify)}, ""); r.Status != http.StatusNoContent {
		t.Fatalf("verify-email = %d: %s", r.Status, r.Body)
	}
	assertOrderDetail(t, sh.checkout(t, pair.AccessToken, key, checkoutBody(addr.ID)), http.StatusCreated, "checkout after verifying")
}

// TestCheckout_TooManyPendingOrders: five unpaid orders are the limit (409
// TOO_MANY_PENDING_ORDERS with details.max, the cart kept); paying or
// cancelling one frees a place.
func TestCheckout_TooManyPendingOrders(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-antre", variant("AN-M", "M", 10000, 50))
	m := p.Variants["AN-M"]
	b := sh.buyer(t, "antre")
	var orders []orderOut
	for range 5 {
		orders = append(orders, sh.order(t, b, line{m, 1}))
	}
	sh.add(t, b, m, 1)
	details := assertError(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusConflict, "TOO_MANY_PENDING_ORDERS")
	if details["max"] != float64(5) {
		t.Errorf("details = %v, want max 5", details)
	}
	if c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, b.Token, ""), "cart"); len(c.Lines) != 1 {
		t.Errorf("the refused checkout emptied the cart: %+v", c.Lines)
	}
	if s := sh.stock(t, m); s != 45 {
		t.Errorf("stock = %d, want 45", s)
	}

	sh.markPaid(t, orders[0].ID)
	assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusCreated, "after one is paid")
	sh.add(t, b, m, 1)
	assertError(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusConflict, "TOO_MANY_PENDING_ORDERS")
	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+orders[1].ID+"/cancel", nil, b.Token), http.StatusOK, "cancel one")
	assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusCreated, "after one is cancelled")
	if n := sh.count(t, `SELECT count(*) FROM orders WHERE user_id = $1 AND status = 'pending_payment'`, b.ID); n != 5 {
		t.Errorf("%d unpaid orders, want 5", n)
	}
}
