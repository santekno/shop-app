//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

// TestRace_ImageUploadVersusAdminSave: a seller starts a photo upload at
// the moment another saves the product with its variants in reverse id
// order. The upload locks the product first, as the save does, so the two
// queue instead of deadlocking: both succeed, the image is recorded and
// the save's stock stands.
func TestRace_ImageUploadVersusAdminSave(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	for i := range raceIterations {
		p := sh.product(t, fmt.Sprintf("kaos-foto-admin-%d", i), variant(fmt.Sprintf("FA-%d-M", i), "M", 10000, 40),
			variant(fmt.Sprintf("FA-%d-L", i), "L", 10000, 40))
		save := reverseSave(t, sh.adminForm(t, p.ID), 70, "")
		delay := time.Duration(i%5) * 2 * time.Millisecond
		results := runTogether(t,
			func() (response, error) {
				return sh.tryCall(http.MethodPost, "/v1/admin/products/"+p.ID+"/images/uploads",
					map[string]any{"content_type": "image/jpeg", "size_bytes": 1000 + i}, sh.staff, nil)
			},
			func() (response, error) { time.Sleep(delay); return sh.trySave(p.ID, save) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		assertUpload(t, results[0], "upload")
		if results[1].Status != http.StatusOK {
			t.Fatalf("iteration %d: save = %s", i, describe(results[1]))
		}
		if sh.stock(t, p.Variants[fmt.Sprintf("FA-%d-M", i)]) != 70 ||
			sh.count(t, `SELECT count(*) FROM product_images WHERE product_id = $1`, p.ID) != 1 {
			t.Fatalf("iteration %d: the save's stock or the image is missing", i)
		}
	}
	assertNoServerErrors(t, sh.server)
}

// TestRace_TwoUploads: two uploads of one product at once take turns on
// the product row: on an empty product they get positions 0 and 1; on a
// product with 9 images exactly one gets the tenth place and the other is
// 409 IMAGE_LIMIT_REACHED.
func TestRace_TwoUploads(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	upload := func(productID string, size int) func() (response, error) {
		return func() (response, error) {
			return sh.tryCall(http.MethodPost, "/v1/admin/products/"+productID+"/images/uploads",
				map[string]any{"content_type": "image/png", "size_bytes": size}, sh.staff, nil)
		}
	}
	for i := range raceIterations {
		empty := sh.product(t, fmt.Sprintf("kaos-dua-foto-%d", i), variant(fmt.Sprintf("DF-%d", i), "M", 10000, 40))
		results := runTogether(t, upload(empty.ID, 100), upload(empty.ID, 200))
		positions := []int{assertUpload(t, results[0], "upload").Image.Position, assertUpload(t, results[1], "upload").Image.Position}
		slices.Sort(positions)
		if !slices.Equal(positions, []int{0, 1}) {
			t.Fatalf("iteration %d: positions %v, want 0 and 1", i, positions)
		}

		full := sh.product(t, fmt.Sprintf("kaos-hampir-penuh-%d", i), variant(fmt.Sprintf("HP-%d", i), "M", 10000, 40))
		for j := range product.MaxImagesPerProduct - 1 {
			assertUpload(t, sh.startUpload(t, full.ID, "image/png", 100+j), "fill")
		}
		results = runTogether(t, upload(full.ID, 100), upload(full.ID, 200))
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if ok := countStatus(t, results, http.StatusCreated, http.StatusConflict, "IMAGE_LIMIT_REACHED"); ok != 1 {
			t.Fatalf("iteration %d: %d uploads took the last place, want 1", i, ok)
		}
		if n := sh.count(t, `SELECT count(*) FROM product_images WHERE product_id = $1`, full.ID); n != product.MaxImagesPerProduct {
			t.Fatalf("iteration %d: %d images, want %d", i, n, product.MaxImagesPerProduct)
		}
		if n := sh.count(t, `SELECT count(DISTINCT position) FROM product_images WHERE product_id = $1`, full.ID); n != product.MaxImagesPerProduct {
			t.Fatalf("iteration %d: %d distinct positions", i, n)
		}
	}
	assertNoServerErrors(t, sh.server)
}
