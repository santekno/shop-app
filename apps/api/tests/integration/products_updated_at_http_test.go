//go:build integration

package integration_test

import (
	"net/http"
	"testing"
	"time"
)

// TestProductUpdatedAt_MovesOnAdminSavesOnly: the public product carries
// updated_at (Bab 11 artikel 11, the sitemap's lastmod), the same in
// GET /v1/products/{slug} and in GET /v1/products, and equal to the row's.
// A checkout that takes stock, and the cancel that gives it back, leave it
// alone: the page's content did not change. An admin save moves it.
func TestProductUpdatedAt_MovesOnAdminSavesOnly(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-lastmod", variant("LM-M", "M", 50000, 10))
	m := p.Variants["LM-M"]

	stored := func() time.Time {
		t.Helper()
		var at time.Time
		if err := sh.db.QueryRowContext(t.Context(), `SELECT updated_at FROM products WHERE id = $1`, p.ID).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	// read is the product's updated_at in both public reads, which must agree
	// with each other and with the row, and its variant's stock.
	read := func(what string) (time.Time, int32) {
		t.Helper()
		detail := assertProductDetail(t, sh.get(t, "/v1/products/"+p.Slug))
		// The test's database holds this one product.
		list, _ := assertProductList(t, sh.get(t, "/v1/products"))
		var listed *productOut
		for i := range list {
			if list[i].ID == p.ID {
				listed = &list[i]
			}
		}
		if listed == nil {
			t.Fatalf("%s: %s is not in GET /v1/products", what, p.Slug)
		}
		want := stored()
		if !detail.UpdatedAt.Equal(want) || !listed.UpdatedAt.Equal(want) {
			t.Errorf("%s: updated_at %s (detail), %s (list), want the row's %s", what, detail.UpdatedAt, listed.UpdatedAt, want)
		}
		if len(detail.Variants) != 1 {
			t.Fatalf("%s: variants %+v", what, detail.Variants)
		}
		return detail.UpdatedAt, detail.Variants[0].Stock
	}

	created, stock := read("after create")
	if stock != 10 {
		t.Fatalf("stock %d, want 10", stock)
	}

	b := sh.buyer(t, "lastmod")
	o := sh.order(t, b, line{m, 3})
	afterCheckout, stock := read("after checkout")
	if stock != 7 {
		t.Errorf("stock %d after a checkout of 3, want 7", stock)
	}
	if !afterCheckout.Equal(created) {
		t.Errorf("a checkout moved updated_at from %s to %s", created, afterCheckout)
	}

	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	afterCancel, stock := read("after cancel")
	if stock != 10 || !afterCancel.Equal(created) {
		t.Errorf("after the cancel: stock %d, updated_at %s; want 10 and the unchanged %s", stock, afterCancel, created)
	}

	sh.bearer = sh.staff
	admin := assertAdminProduct(t, sh.get(t, "/v1/admin/products/"+p.ID).Body)
	var version int32
	for _, v := range admin.Variants {
		if v.ID == m {
			version = v.Version
		}
	}
	saved := sh.send(t, http.MethodPut, "/v1/admin/products/"+p.ID,
		productJSON(t, admin.CategoryID, p.Slug, "active", withVersion(variantJSON(m, "LM-M", "M", 55000, 10), version)))
	if saved.Status != http.StatusOK {
		t.Fatalf("admin PUT = %d: %s", saved.Status, saved.Body)
	}
	afterSave, _ := read("after an admin save")
	if !afterSave.After(created) {
		t.Errorf("an admin save left updated_at at %s, want it after %s", afterSave, created)
	}
	if adminSaved := assertAdminProduct(t, saved.Body); !adminSaved.UpdatedAt.Equal(afterSave) {
		t.Errorf("the admin answer says updated_at %s, the public read %s", adminSaved.UpdatedAt, afterSave)
	}
	assertNoServerErrors(t, sh.server)
}
