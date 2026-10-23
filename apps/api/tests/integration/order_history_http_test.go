//go:build integration

package integration_test

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// TestOrderHistory pages through a buyer's seven orders three at a time:
// newest first, every order once, next_cursor null on the last page, and
// no other buyer's order. A cursor that is not one of ours, and a limit
// out of range, are 400.
func TestOrderHistory(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-riwayat", variant("RW-M", "M", 10000, 50))
	m := p.Variants["RW-M"]
	b := sh.buyer(t, "riwayat")
	other := sh.buyer(t, "riwayat-lain")
	theirs := sh.order(t, other, line{m, 1})
	var want []string
	for i := range 7 {
		o := sh.order(t, b, line{m, 1})
		if i < 4 {
			sh.markPaid(t, o.ID) // stay under the five unpaid orders
		}
		want = append([]string{o.ID}, want...)
	}

	var got []string
	cursor, pages := "", 0
	for {
		path := "/v1/orders?limit=3"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		list, next := assertOrderList(t, sh.call(t, http.MethodGet, path, nil, b.Token), "GET /v1/orders")
		pages++
		for _, o := range list {
			got = append(got, o.ID)
		}
		if next == "" || pages > 5 {
			break
		}
		cursor = next
	}
	if pages != 3 || strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%d pages: %v\nwant 3 pages, newest first: %v", pages, got, want)
	}
	if slices.Contains(got, theirs.ID) {
		t.Error("the history lists another buyer's order")
	}
	all, next := assertOrderList(t, sh.call(t, http.MethodGet, "/v1/orders", nil, b.Token), "GET /v1/orders (defaults)")
	if len(all) != 7 || next != "" {
		t.Errorf("default page: %d orders, next %q; want all 7 and null", len(all), next)
	}
	if list, _ := assertOrderList(t, sh.call(t, http.MethodGet, "/v1/orders", nil, sh.buyer(t, "riwayat-kosong").Token), "empty history"); len(list) != 0 {
		t.Errorf("a new buyer's history = %+v", list)
	}

	for _, q := range []string{"?limit=0", "?limit=51", "?limit=dua", "?cursor=bukan-kursor", "?cursor=" + strings.Repeat("a", 513)} {
		assertError(t, sh.call(t, http.MethodGet, "/v1/orders"+q, nil, b.Token), http.StatusBadRequest, "VALIDATION_FAILED")
	}
	// A cursor of the admin's queue is not one of this list's.
	_, queueCursor := assertOrderList(t, sh.staffCall(t, http.MethodGet, "/v1/admin/orders?limit=1", nil), "admin queue")
	if queueCursor == "" {
		t.Fatal("the admin queue has one page only; the fixture needs two paid orders")
	}
	assertError(t, sh.call(t, http.MethodGet, "/v1/orders?cursor="+queueCursor, nil, b.Token), http.StatusBadRequest, "VALIDATION_FAILED")
	assertUnauthorizedBearer(t, sh.call(t, http.MethodGet, "/v1/orders", nil, ""), "history without a login")
	assertNoErrorLog(t, sh.server)
}

// TestOrders_OtherBuyersOrder is the IDOR check (OWASP API1): another
// buyer's order is 404 exactly like a missing one, on every buyer route,
// and nothing changes; the owner and the staff still see it.
func TestOrders_OtherBuyersOrder(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-idor", variant("ID-M", "M", 10000, 10))
	owner := sh.buyer(t, "pemilik")
	thief := sh.buyer(t, "pengintip")
	o := sh.order(t, owner, line{p.Variants["ID-M"], 2})

	missing := sh.call(t, http.MethodGet, "/v1/orders/"+uuidx.NewV7(), nil, thief.Token)
	assertError(t, missing, http.StatusNotFound, "NOT_FOUND")
	for _, r := range []struct{ method, path string }{
		{http.MethodGet, "/v1/orders/" + o.ID},
		{http.MethodPost, "/v1/orders/" + o.ID + "/cancel"},
		{http.MethodPost, "/v1/orders/" + o.ID + "/complete"},
	} {
		resp := sh.call(t, r.method, r.path, nil, thief.Token)
		assertError(t, resp, http.StatusNotFound, "NOT_FOUND")
		if string(resp.Body) != string(missing.Body) {
			t.Errorf("%s %s: %s, want the same body as a missing order: %s", r.method, r.path, resp.Body, missing.Body)
		}
	}
	for _, path := range []string{"/v1/orders/bukan-uuid", "/v1/orders/bukan-uuid/cancel"} {
		method := http.MethodGet
		if strings.HasSuffix(path, "cancel") {
			method = http.MethodPost
		}
		assertError(t, sh.call(t, method, path, nil, owner.Token), http.StatusNotFound, "NOT_FOUND")
	}
	if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND status = 'pending_payment'`, o.ID); n != 1 {
		t.Error("another buyer changed the order")
	}
	if s := sh.stock(t, p.Variants["ID-M"]); s != 8 {
		t.Errorf("stock = %d, want 8", s)
	}
	assertOrderDetail(t, sh.call(t, http.MethodGet, "/v1/orders/"+o.ID, nil, owner.Token), http.StatusOK, "owner GET")
	assertOrderDetail(t, sh.staffCall(t, http.MethodGet, "/v1/admin/orders/"+o.ID, nil), http.StatusOK, "staff GET")
	sh.assertEvents(t, o.ID, "order.created")
}
