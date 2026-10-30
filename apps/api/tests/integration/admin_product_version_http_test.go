//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The product's own optimistic lock (Bab 12 artikel 05, migration
// 000021): two admins on one product, a save racing an archive, and a
// form that kept a variant another admin archived.

// formBody is the PUT body of form as an admin's form sends it back: the
// product's version, and each variant with the version it was loaded with.
func formBody(t *testing.T, form adminProductOut, status string, extra ...map[string]any) string {
	t.Helper()
	vs := make([]map[string]any, 0, len(form.Variants)+len(extra))
	for _, v := range form.Variants {
		w := withVersion(variantJSON(v.ID, v.SKU, v.Name, int(v.Price.Amount), int(v.Stock)), v.Version)
		w["weight_grams"] = v.WeightGrams
		vs = append(vs, w)
	}
	vs = append(vs, extra...)
	return asVersion(t, productJSON(t, form.CategoryID, form.Slug, status, vs...), form.Version)
}

// variantSKUs lists the SKUs of variants.
func variantSKUs(vs []adminVariantOut) []string {
	out := make([]string, 0, len(vs))
	for _, v := range vs {
		out = append(out, v.SKU)
	}
	slices.Sort(out)
	return out
}

// TestAdminVersion_AnotherAdminsVariantSurvives: admin B adds a variant
// while admin A's form is open. A's save, which does not list it, is 409
// VERSION_CONFLICT naming the product, and B's variant stays on sale; A
// reloads and saves.
func TestAdminVersion_AnotherAdminsVariantSurvives(t *testing.T) {
	sh := newShop(t, nil)
	other := sh.accountWithRole(t, user.RoleAdmin).AccessToken
	p := sh.product(t, "kaos-dua-admin", variant("DA-M", "M", 50000, 10))
	load := func() adminProductOut { return sh.adminForm(t, p.ID) }

	formA := load()
	formB := load()
	saved := assertAdminProduct(t, sh.call(t, http.MethodPut, "/v1/admin/products/"+p.ID,
		formBody(t, formB, "active", variantJSON("", "DA-XL", "XL", 65000, 7)), other).Body)
	if saved.Version != formB.Version+1 || !slices.Equal(variantSKUs(saved.Variants), []string{"DA-M", "DA-XL"}) {
		t.Fatalf("B's save = %+v, want version %d and DA-XL added", saved, formB.Version+1)
	}

	resp := sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, formA, "active"))
	if details := assertErrorDetails(t, resp, http.StatusConflict, "VERSION_CONFLICT"); details["product_id"] != p.ID || details["variant_id"] != nil {
		t.Errorf("details = %v, want product_id %s only", details, p.ID)
	}
	if n := sh.count(t, `SELECT count(*) FROM product_variants WHERE sku = 'DA-XL' AND archived_at IS NULL`); n != 1 {
		t.Fatal("A's stale save archived the variant B added")
	}
	sp := assertProductDetail(t, sh.get(t, "/v1/products/"+p.Slug))
	var onSale []string
	for _, v := range sp.Variants {
		onSale = append(onSale, v.SKU)
	}
	if slices.Sort(onSale); !slices.Equal(onSale, []string{"DA-M", "DA-XL"}) {
		t.Errorf("storefront variants = %v, want DA-M and DA-XL", onSale)
	}
	// It can be bought.
	b := sh.buyer(t, "dua-admin")
	var xl string
	for _, v := range saved.Variants {
		if v.SKU == "DA-XL" {
			xl = v.ID
		}
	}
	sh.order(t, b, line{xl, 1})

	// Reload, and A's save goes through with the variant in it.
	fresh := load()
	again := assertAdminProduct(t, sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, fresh, "draft")).Body)
	if again.Status != "draft" || again.Version != fresh.Version+1 || len(again.Variants) != 2 {
		t.Errorf("A's save after reloading = %+v", again)
	}
	assertNoErrorLog(t, sh.server)
}

// TestAdminVersion_ArchiveBetweenLoadAndSave: a form loaded before the
// product was archived cannot put it back on sale; reloading can.
func TestAdminVersion_ArchiveBetweenLoadAndSave(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-arsip-versi", variant("AV-M", "M", 50000, 10))
	form := sh.adminForm(t, p.ID)
	if r := sh.staffCall(t, http.MethodDelete, "/v1/admin/products/"+p.ID, nil); r.Status != http.StatusNoContent {
		t.Fatalf("DELETE = %d: %s", r.Status, r.Body)
	}
	archived := sh.adminForm(t, p.ID)
	if archived.Version != form.Version+1 {
		t.Errorf("version after the archive = %d, want %d", archived.Version, form.Version+1)
	}
	// Archiving again is 204 and still bumps the version.
	sh.staffCall(t, http.MethodDelete, "/v1/admin/products/"+p.ID, nil)
	if v := sh.adminForm(t, p.ID).Version; v != archived.Version+1 {
		t.Errorf("version after a second archive = %d, want %d", v, archived.Version+1)
	}

	details := assertErrorDetails(t, sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, form, "active")),
		http.StatusConflict, "VERSION_CONFLICT")
	if details["product_id"] != p.ID {
		t.Errorf("details = %v", details)
	}
	if r := sh.get(t, "/v1/products/"+p.Slug); r.Status != http.StatusNotFound {
		t.Errorf("the stale save put the product back on sale: GET = %d", r.Status)
	}
	restored := assertAdminProduct(t, sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID,
		formBody(t, sh.adminForm(t, p.ID), "active")).Body)
	if restored.Status != "active" {
		t.Errorf("restore after reloading: %+v", restored)
	}
	assertNoErrorLog(t, sh.server)
}

// TestAdminVersion_VariantArchived: a form that took the product's new
// version (the dashboard's merge) but kept a variant another admin
// archived is 409 VARIANT_ARCHIVED naming it, and nothing is written.
func TestAdminVersion_VariantArchived(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-varian-arsip", variant("VA-M", "M", 50000, 10), variant("VA-L", "L", 60000, 10))
	form := sh.adminForm(t, p.ID)
	// Another admin's save without VA-L archives it.
	keepM := form
	keepM.Variants = slices.DeleteFunc(slices.Clone(form.Variants), func(v adminVariantOut) bool { return v.SKU == "VA-L" })
	latest := assertAdminProduct(t, sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, keepM, "active")).Body)

	merged := form
	merged.Version = latest.Version
	for i, v := range merged.Variants {
		if v.SKU == "VA-M" {
			merged.Variants[i].Version = latest.Variants[0].Version
			merged.Variants[i].Stock = 3
		}
	}
	l := p.Variants["VA-L"]
	before := sh.productVersion(t, p.ID)
	details := assertErrorDetails(t, sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, merged, "active")),
		http.StatusConflict, "VARIANT_ARCHIVED")
	if details["variant_id"] != l {
		t.Errorf("details = %v, want variant_id %s", details, l)
	}
	if sh.stock(t, p.Variants["VA-M"]) != 10 || sh.productVersion(t, p.ID) != before {
		t.Error("the refused save wrote something")
	}
	if n := sh.count(t, `SELECT count(*) FROM product_variants WHERE id = $1 AND archived_at IS NOT NULL`, l); n != 1 {
		t.Error("VA-L is no longer archived")
	}
	// Without the archived variant the merged form saves.
	merged.Variants = slices.DeleteFunc(merged.Variants, func(v adminVariantOut) bool { return v.SKU == "VA-L" })
	if got := assertAdminProduct(t, sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, merged, "active")).Body); got.Variants[0].Stock != 3 {
		t.Errorf("the merged save: %+v", got)
	}
	assertNoErrorLog(t, sh.server)
}

// TestAdminVersion_StockMovesOnlyTheVariant: a checkout, a cancel and a
// stock adjustment bump the variant's version, never the product's, so a
// form open on another variant's price is not refused for them.
func TestAdminVersion_StockMovesOnlyTheVariant(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-versi-stok", variant("VK-M", "M", 50000, 10))
	m := p.Variants["VK-M"]
	form := sh.adminForm(t, p.ID)
	b := sh.buyer(t, "versi-stok")
	o := sh.order(t, b, line{m, 2})
	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	assertVariantDetail(t, sh.staffCall(t, http.MethodPost, stockPath(p.ID, m), map[string]any{"delta": 5}), "adjust")
	now := sh.adminForm(t, p.ID)
	if now.Version != form.Version || now.Variants[0].Version != form.Variants[0].Version+3 || now.Variants[0].Stock != 15 {
		t.Errorf("after checkout, cancel and adjustment: product version %d → %d, variant %d → %d, stock %d; want the product unchanged, the variant +3, stock 15",
			form.Version, now.Version, form.Variants[0].Version, now.Variants[0].Version, now.Variants[0].Stock)
	}
	// The form's stale variant is what refuses the save, by name.
	details := assertErrorDetails(t, sh.staffCall(t, http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, form, "active")),
		http.StatusConflict, "VERSION_CONFLICT")
	if details["variant_id"] != m || details["product_id"] != nil {
		t.Errorf("details = %v, want variant_id %s only", details, m)
	}
	assertNoErrorLog(t, sh.server)
}

// TestAdminVersion_Required: a PUT without the product's version is 400
// VALIDATION_FAILED naming version; POST ignores the one it is sent.
func TestAdminVersion_Required(t *testing.T) {
	sh := newShop(t, nil)
	sh.bearer = sh.staff
	p := sh.product(t, "kaos-tanpa-versi", variant("TV-M", "M", 50000, 10))
	form := sh.adminForm(t, p.ID)
	body := productJSON(t, form.CategoryID, form.Slug, "active",
		withVersion(variantJSON(form.Variants[0].ID, "TV-M", "M", 50000, 10), form.Variants[0].Version))
	details := assertErrorDetails(t, sh.send(t, http.MethodPut, "/v1/admin/products/"+p.ID, body), http.StatusBadRequest, "VALIDATION_FAILED")
	if _, ok := details["version"]; !ok {
		t.Errorf("details = %v, want version", details)
	}
	created := sh.send(t, http.MethodPost, "/v1/admin/products",
		asVersion(t, productJSON(t, form.CategoryID, "kaos-versi-baru", "active", variantJSON("", "TV-N", "N", 1000, 1)), 41))
	if got := assertAdminProduct(t, created.Body); created.Status != http.StatusCreated || got.Version == 41 || got.Version != form.Version {
		t.Errorf("POST with version 41 = %d, version %d; want 201 and a new product's version, %d", created.Status, got.Version, form.Version)
	}
}

// TestRace_TwoAdminSaves: two admins save the same loaded form at once.
// Exactly one wins; the other is 409 naming the product, and the product's
// version moved once.
func TestRace_TwoAdminSaves(t *testing.T) {
	sh := newShop(t, nil)
	other := sh.accountWithRole(t, user.RoleAdmin).AccessToken
	for i := range raceIterations {
		p := sh.product(t, fmt.Sprintf("kaos-simpan-balap-%d", i), variant(fmt.Sprintf("SBL-%d", i), "M", 50000, 10))
		form := sh.adminForm(t, p.ID)
		results := runTogether(t,
			func() (response, error) {
				return sh.tryCall(http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, form, "active"), sh.staff, nil)
			},
			func() (response, error) {
				return sh.tryCall(http.MethodPut, "/v1/admin/products/"+p.ID, formBody(t, form, "draft"), other, nil)
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		won := slices.IndexFunc(results, func(r response) bool { return r.Status == http.StatusOK })
		if won < 0 || !is(results[1-won], http.StatusConflict, "VERSION_CONFLICT") {
			t.Fatalf("iteration %d: %s and %s, want one 200 and one 409", i, describe(results[0]), describe(results[1]))
		}
		if v := sh.adminForm(t, p.ID).Version; v != form.Version+1 {
			t.Fatalf("iteration %d: version %d, want %d", i, v, form.Version+1)
		}
	}
	assertNoServerErrors(t, sh.server)
}
