//go:build integration

package integration_test

import (
	"net/http"
	"testing"
)

// TestAdminVersion_Conflict is the seller's stale form of ADR 0006: the
// admin loads a product, a buyer checks out (and later cancels) while the
// form is open, and the save with the loaded version is 409
// VERSION_CONFLICT naming the variant, without overwriting the stock the
// buyer took. Reloading and saving again works; every stock change bumps
// the version the admin GET shows.
func TestAdminVersion_Conflict(t *testing.T) {
	sh := newShop(t, nil)
	sh.bearer = sh.staff
	p := sh.product(t, "kaos-versi", variant("VS-M", "M", 50000, 10), variant("VS-L", "L", 60000, 10))
	m, l := p.Variants["VS-M"], p.Variants["VS-L"]
	load := func() adminProductOut { return assertAdminProduct(t, sh.get(t, "/v1/admin/products/"+p.ID).Body) }
	variantOf := func(ap adminProductOut, id string) adminVariantOut {
		for _, v := range ap.Variants {
			if v.ID == id {
				return v
			}
		}
		t.Fatalf("no variant %s in %+v", id, ap.Variants)
		return adminVariantOut{}
	}
	save := func(ap adminProductOut, stock int) response {
		body := productJSON(t, ap.CategoryID, ap.Slug, "active",
			withVersion(variantJSON(m, "VS-M", "M", 50000, stock), variantOf(ap, m).Version),
			withVersion(variantJSON(l, "VS-L", "L", 60000, 10), variantOf(ap, l).Version))
		return sh.send(t, http.MethodPut, "/v1/admin/products/"+p.ID, body)
	}

	form := load()
	b := sh.buyer(t, "versi")
	o := sh.order(t, b, line{m, 3})
	if v := variantOf(load(), m); v.Stock != 7 || v.Version <= variantOf(form, m).Version {
		t.Errorf("after a sale: %+v, want stock 7 and a newer version than %d", v, variantOf(form, m).Version)
	}

	details := assertErrorDetails(t, save(form, 20), http.StatusConflict, "VERSION_CONFLICT")
	if details["variant_id"] != m {
		t.Errorf("details = %v, want variant_id %s", details, m)
	}
	if s := sh.stock(t, m); s != 7 {
		t.Errorf("the stale save overwrote the stock: %d, want 7", s)
	}
	if variantOf(load(), l).Version != variantOf(form, l).Version {
		t.Error("the refused save changed the other variant")
	}

	fresh := load()
	saved := assertAdminProduct(t, save(fresh, 20).Body)
	if v := variantOf(saved, m); v.Stock != 20 || v.Version <= variantOf(fresh, m).Version {
		t.Errorf("after reloading and saving: %+v", v)
	}

	// A cancel gives stock back and bumps the version too.
	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	assertErrorDetails(t, save(saved, 5), http.StatusConflict, "VERSION_CONFLICT")
	if s := sh.stock(t, m); s != 23 {
		t.Errorf("stock = %d after the cancel, want 20 + 3", s)
	}
	assertNoErrorLog(t, sh.server)
}
