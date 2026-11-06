package product_test

// Bab 14 artikel-12: Handler.ProductJSON, the product shape the wishlist
// shares with the storefront list.

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// ProductJSON is the shape the wishlist reuses: the same as the list's
// items, with the storefront images.
func TestHandler_ProductJSON(t *testing.T) {
	p := storefrontProduct()
	p.Images = storefrontImages()
	h := product.NewHandler(&fakeService{}, &fakeService{}, httpapi.NewValidator()).
		WithImages(&fakeImages{}, publicURL)

	out := h.ProductJSON(p)

	// The same value the list route sends for the same product.
	svc := &fakeService{page: product.Page{Products: []product.Product{p}}}
	rec := serveImages(svc, &fakeImages{}, http.MethodGet, "/v1/products", "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	listItem := decodeJSON(t, rec)["data"].([]any)[0].(map[string]any)

	got := jsonOf(t, out)
	testx.AssertEqual(t, got["id"], any(productID))
	testx.AssertEqual(t, got["slug"], any("kaos-polos-hitam"))
	testx.AssertEqual(t, got["in_stock"], any(true))
	testx.AssertEqual(t, got["created_at"], any("2026-10-01T12:00:00Z"))
	testx.AssertEqual(t, len(got["variants"].([]any)), 2)
	images := got["images"].([]any)
	testx.AssertEqual(t, len(images), 1, "only the ready image with variants")
	testx.AssertEqual(t, images[0].(map[string]any)["url"], any("https://cdn.test/products/p/i/800.jpg"))
	testx.AssertEqual(t, len(got), len(listItem), "same fields as the list item")
	for k := range listItem {
		_, ok := got[k]
		testx.AssertTrue(t, ok, "field %q of the list item is missing from ProductJSON", k)
	}

	t.Run("without images the field is [], not null", func(t *testing.T) {
		q := storefrontProduct()
		got := jsonOf(t, h.ProductJSON(q))
		imgs, ok := got["images"].([]any)
		testx.AssertTrue(t, ok, "images = %v", got["images"])
		testx.AssertEqual(t, len(imgs), 0)
	})
}

func jsonOf(t *testing.T, v any) map[string]any {
	t.Helper()
	b, err := json.Marshal(v)
	testx.AssertNoError(t, err)
	var m map[string]any
	testx.AssertNoError(t, json.Unmarshal(b, &m))
	return m
}
