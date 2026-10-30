//go:build integration

package integration_test

import (
	"net/http"
	"slices"
	"testing"
)

// TestAdminHTTP_Archive checks DELETE /v1/admin/products/{id}: 204 with no
// body, the product leaves the storefront but stays for the admin with its
// variants, DELETE again is 204, and a status change brings it back.
func TestAdminHTTP_Archive(t *testing.T) {
	s, _ := catalogServer(t, nil)
	p := assertProductDetail(t, s.get(t, "/v1/products/kaos-polos-hitam"))
	admin := assertAdminProduct(t, s.get(t, "/v1/admin/products/"+p.ID).Body)

	for _, round := range []string{"first", "again"} {
		resp := s.send(t, http.MethodDelete, "/v1/admin/products/"+p.ID, "")
		if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
			t.Fatalf("%s DELETE = %d with %d body bytes, want 204 and no body", round, resp.Status, len(resp.Body))
		}
	}

	if r := s.get(t, "/v1/products/kaos-polos-hitam"); r.Status != http.StatusNotFound {
		t.Errorf("storefront GET of an archived product = %d, want 404", r.Status)
	}
	listed, _ := s.pageAllHTTP(t, nil)
	if slices.Contains(listed, "kaos-polos-hitam") {
		t.Error("the archived product is still listed")
	}

	archived := assertAdminProduct(t, s.get(t, "/v1/admin/products/"+p.ID).Body)
	if archived.Status != "archived" || len(archived.Variants) != len(admin.Variants) || !archived.UpdatedAt.After(admin.UpdatedAt) {
		t.Errorf("admin view after DELETE = %+v, want status archived, the same variants, a later updated_at", archived)
	}
	if n := queryInt(t, s.db, `SELECT count(*) FROM products WHERE id = $1`, p.ID); n != 1 {
		t.Error("DELETE removed the row; it must only archive it")
	}

	// Restoring is a status change.
	body := asVersion(t, productJSON(t, archived.CategoryID, archived.Slug, "active",
		withVersion(variantJSON(archived.Variants[0].ID, archived.Variants[0].SKU, archived.Variants[0].Name,
			int(archived.Variants[0].Price.Amount), 3), archived.Variants[0].Version)), archived.Version)
	if r := s.send(t, http.MethodPut, "/v1/admin/products/"+p.ID, body); r.Status != http.StatusOK {
		t.Fatalf("PUT status active = %d: %s", r.Status, r.Body)
	}
	assertProductDetail(t, s.get(t, "/v1/products/"+archived.Slug))
}
