//go:build integration

package integration_test

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// TestImageUpload_PresignPutConfirm walks the upload flow against the
// real SeaweedFS: the API signs a PUT for exactly the declared type and
// size under uploads/, the file goes straight to S3, and confirm reads
// what arrived and hands the image to the worker (processing). Confirming
// again answers the same image. The original is private (403 to an
// anonymous reader), and the storefront shows nothing until the worker
// has made the variants.
func TestImageUpload_PresignPutConfirm(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-foto", variant("FT-M", "M", 50000, 10))
	data := jpegOf(t, 1200, 900)

	u := assertUpload(t, sh.startUpload(t, p.ID, "image/jpeg", len(data)), "start upload")
	if u.Image.Position != 0 || u.Image.SizeBytes != len(data) || u.Image.ContentType != "image/jpeg" {
		t.Errorf("pending image %+v", u.Image)
	}
	key := sh.imageKey(t, u.Image.ID)
	if key != product.ImageKey(p.ID, u.Image.ID) || !strings.Contains(u.Upload.URL, "/"+key+"?") {
		t.Errorf("the URL %s is not signed for %s", u.Upload.URL, key)
	}
	assertError(t, sh.confirm(t, p.ID, u.Image.ID, ""), http.StatusConflict, "UPLOAD_MISSING")
	if status := put(t, u.Upload, data, nil); status != http.StatusOK {
		t.Fatalf("PUT = %d, want 200", status)
	}

	img := assertImageDetail(t, sh.confirm(t, p.ID, u.Image.ID, "Kaos tampak depan"), "confirm")
	if img.Status != product.ImageProcessing || img.Alt != "Kaos tampak depan" || img.ID != u.Image.ID {
		t.Errorf("confirmed image %+v, want processing with its alt", img)
	}
	if n := sh.count(t, `SELECT count(*) FROM product_images WHERE id = $1 AND width = 1200 AND height = 900`, img.ID); n != 1 {
		t.Error("confirm did not store the original's dimensions")
	}
	again := assertImageDetail(t, sh.confirm(t, p.ID, u.Image.ID, "lain"), "confirm again")
	if again.Status != product.ImageProcessing || again.Alt != "Kaos tampak depan" {
		t.Errorf("a second confirm changed the image: %+v", again)
	}

	if status, _, _ := anonymousGet(t, objectURL(key)); status != http.StatusForbidden {
		t.Errorf("anonymous GET of the original = %d, want 403: uploads/ is private", status)
	}
	if _, images := sh.productDetail(t, p.Slug); len(images) != 0 {
		t.Errorf("the storefront shows %d images before the worker made them", len(images))
	}
	if admin := sh.adminImages(t, p.ID); len(admin) != 1 || admin[0].Status != product.ImageProcessing {
		t.Errorf("admin images %+v, want the processing one", admin)
	}
	assertNoServerErrors(t, sh.server)
}

// TestImageUpload_SignedHeadersEnforced: the presigned PUT is signed with
// Content-Type and Content-Length, so SeaweedFS refuses an upload of
// another type or another size, and nothing is stored under the key.
func TestImageUpload_SignedHeadersEnforced(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-tanda-tangan", variant("TT2-M", "M", 50000, 10))
	data := jpegOf(t, 400, 300)
	u := assertUpload(t, sh.startUpload(t, p.ID, "image/jpeg", len(data)), "start upload")
	key := sh.imageKey(t, u.Image.ID)

	other := map[string]string{"Content-Type": "image/png", "Content-Length": u.Upload.Headers["Content-Length"]}
	if status := put(t, u.Upload, data, other); status != http.StatusForbidden {
		t.Errorf("PUT as image/png = %d, want 403", status)
	}
	bigger := append(bytes.Clone(data), make([]byte, 1000)...)
	sized := map[string]string{"Content-Type": "image/jpeg", "Content-Length": u.Upload.Headers["Content-Length"]}
	if status := put(t, u.Upload, bigger, map[string]string{"Content-Type": "image/jpeg"}); status != http.StatusForbidden {
		t.Errorf("PUT of %d bytes for a URL signed for %d = %d, want 403", len(bigger), len(data), status)
	}
	if status := put(t, u.Upload, data[:len(data)-10], sized); status == http.StatusOK {
		t.Errorf("PUT of a shorter body was accepted")
	}
	if objectExists(t, key) {
		t.Fatal("a refused PUT left an object behind")
	}
	assertError(t, sh.confirm(t, p.ID, u.Image.ID, ""), http.StatusConflict, "UPLOAD_MISSING")
	if status := put(t, u.Upload, data, nil); status != http.StatusOK {
		t.Errorf("the exact PUT = %d, want 200", status)
	}
}

// TestImageUpload_ConfirmChecks: confirm checks the bytes, not the
// request, because not every S3 store enforces every signed header. Each
// refusal is 422 UPLOAD_INVALID with its reason, and deletes the pending
// image and the file. Files that a strict store would refuse are planted
// directly in the bucket with the API's keys.
func TestImageUpload_ConfirmChecks(t *testing.T) {
	bucket := testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-periksa", variant("PR-M", "M", 50000, 10))
	jpg := jpegOf(t, 300, 200)

	tests := []struct {
		name     string
		declared string
		size     int
		planted  []byte
		as       string // the content type the file is stored with
		reason   string
	}{
		{name: "another size", declared: "image/jpeg", size: len(jpg) + 1, planted: jpg, as: "image/jpeg", reason: "size_mismatch"},
		{name: "another type", declared: "image/png", size: len(jpg), planted: jpg, as: "image/jpeg", reason: "content_type_mismatch"},
		{name: "a JPEG declared as PNG", declared: "image/png", size: len(jpg), planted: jpg, as: "image/png",
			reason: "not_an_image_of_the_declared_type"},
		{name: "a PNG header and nothing else", declared: "image/png", size: 40,
			planted: append(pngHeaderOnly(100, 100)[:16], bytes.Repeat([]byte{0xAB}, 24)...), as: "image/png", reason: "unreadable_image"},
		{name: "too wide", declared: "image/png", size: len(pngHeaderOnly(6001, 10)), planted: pngHeaderOnly(6001, 10),
			as: "image/png", reason: "too_many_pixels"},
		{name: "too many pixels", declared: "image/png", size: len(pngHeaderOnly(5000, 5000)), planted: pngHeaderOnly(5000, 5000),
			as: "image/png", reason: "too_many_pixels"},
		{name: "text", declared: "image/webp", size: 64, planted: bytes.Repeat([]byte("a"), 64), as: "image/webp",
			reason: "not_an_image_of_the_declared_type"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			u := assertUpload(t, sh.startUpload(t, p.ID, tc.declared, tc.size), "start upload")
			key := sh.imageKey(t, u.Image.ID)
			if _, err := bucket.Put(t.Context(), key, tc.as, bytes.NewReader(tc.planted)); err != nil {
				t.Fatalf("plant the file: %v", err)
			}
			details := assertError(t, sh.confirm(t, p.ID, u.Image.ID, ""), http.StatusUnprocessableEntity, "UPLOAD_INVALID")
			if details["reason"] != tc.reason {
				t.Errorf("reason %v, want %s", details["reason"], tc.reason)
			}
			if sh.imageStatus(t, u.Image.ID) != "" || objectExists(t, key) {
				t.Errorf("the refused image or its file is still there")
			}
			assertError(t, sh.confirm(t, p.ID, u.Image.ID, ""), http.StatusNotFound, "NOT_FOUND")
		})
	}
	assertNoServerErrors(t, sh.server)
}

// TestImageUpload_LimitAndValidation: at most 10 images per product,
// pending ones included (409 IMAGE_LIMIT_REACHED with details.max), and
// deleting one makes room again; the declared type and size are
// validated; another product's image, an unknown product and ids that
// are not UUIDs are 404; only staff may upload.
func TestImageUpload_LimitAndValidation(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-batas-foto", variant("BF-M", "M", 50000, 10))
	other := sh.product(t, "kaos-lain-foto", variant("LF-M", "M", 50000, 10))

	var first adminImageOut
	for i := range product.MaxImagesPerProduct {
		u := assertUpload(t, sh.startUpload(t, p.ID, "image/png", 1000+i), "upload")
		if u.Image.Position != i {
			t.Errorf("image %d at position %d", i, u.Image.Position)
		}
		if i == 0 {
			first = u.Image
		}
	}
	details := assertError(t, sh.startUpload(t, p.ID, "image/png", 1000), http.StatusConflict, "IMAGE_LIMIT_REACHED")
	if details["max"] != float64(product.MaxImagesPerProduct) {
		t.Errorf("details %v, want max 10", details)
	}
	if resp := sh.staffCall(t, http.MethodDelete, "/v1/admin/products/"+p.ID+"/images/"+first.ID, nil); resp.Status != http.StatusNoContent {
		t.Fatalf("DELETE image = %s, want 204", describe(resp))
	}
	assertError(t, sh.staffCall(t, http.MethodDelete, "/v1/admin/products/"+p.ID+"/images/"+first.ID, nil), http.StatusNotFound, "NOT_FOUND")
	u := assertUpload(t, sh.startUpload(t, p.ID, "image/webp", 2000), "upload after a delete")
	if u.Image.Position != product.MaxImagesPerProduct {
		t.Errorf("new image at position %d, want %d", u.Image.Position, product.MaxImagesPerProduct)
	}

	for _, body := range []map[string]any{
		{"content_type": "image/gif", "size_bytes": 100},
		{"content_type": "image/jpeg", "size_bytes": 0},
		{"content_type": "image/jpeg", "size_bytes": product.MaxImageBytes + 1},
		{"content_type": "image/jpeg"},
	} {
		assertError(t, sh.staffCall(t, http.MethodPost, "/v1/admin/products/"+other.ID+"/images/uploads", body),
			http.StatusBadRequest, "VALIDATION_FAILED")
	}
	assertError(t, sh.staffCall(t, http.MethodPost, "/v1/admin/products/"+other.ID+"/images/uploads",
		`{"content_type":"image/jpeg","size_bytes":10,"extra":1}`), http.StatusBadRequest, "VALIDATION_FAILED")
	assertError(t, sh.startUpload(t, uuidx.NewV7(), "image/jpeg", 100), http.StatusNotFound, "NOT_FOUND")
	assertError(t, sh.startUpload(t, "bukan-uuid", "image/jpeg", 100), http.StatusNotFound, "NOT_FOUND")
	assertError(t, sh.confirm(t, other.ID, u.Image.ID, ""), http.StatusNotFound, "NOT_FOUND")
	assertError(t, sh.confirm(t, p.ID, "bukan-uuid", ""), http.StatusNotFound, "NOT_FOUND")
	assertError(t, sh.confirm(t, p.ID, u.Image.ID, strings.Repeat("a", 201)), http.StatusBadRequest, "VALIDATION_FAILED")

	b := sh.buyer(t, "bukan-staf")
	assertError(t, sh.call(t, http.MethodPost, "/v1/admin/products/"+other.ID+"/images/uploads",
		map[string]any{"content_type": "image/jpeg", "size_bytes": 100}, b.Token), http.StatusForbidden, "FORBIDDEN")
	assertError(t, sh.call(t, http.MethodPost, "/v1/admin/products/"+other.ID+"/images/uploads",
		map[string]any{"content_type": "image/jpeg", "size_bytes": 100}, ""), http.StatusUnauthorized, "UNAUTHORIZED")
	seller := sh.accountWithRole(t, user.RoleSeller)
	assertUpload(t, sh.call(t, http.MethodPost, "/v1/admin/products/"+other.ID+"/images/uploads",
		map[string]any{"content_type": "image/jpeg", "size_bytes": 100}, seller.AccessToken), "a seller uploads")
	if n := sh.count(t, `SELECT count(*) FROM product_images WHERE product_id = $1`, other.ID); n != 1 {
		t.Errorf("%d images on the other product, want only the seller's", n)
	}
	assertNoServerErrors(t, sh.server)
}

// TestImageUpload_Delete: deleting a ready image removes its row, its
// original and its variants from the bucket.
func TestImageUpload_Delete(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-hapus-foto", variant("HF-M", "M", 50000, 10))
	img := sh.uploaded(t, p.ID, "image/jpeg", jpegOf(t, 900, 600), "")
	sh.processImages(t)
	keys := append(queryStrings(t, sh.db, `SELECT original_key FROM product_images WHERE id = $1`, img.ID),
		queryStrings(t, sh.db, `SELECT v->>'key' FROM product_images, jsonb_array_elements(variants) v WHERE id = $1`, img.ID)...)
	if len(keys) != 3 {
		t.Fatalf("keys %v, want the original and two variants", keys)
	}
	for _, k := range keys {
		if !objectExists(t, k) {
			t.Fatalf("%s is not in the bucket", k)
		}
	}
	if resp := sh.staffCall(t, http.MethodDelete, "/v1/admin/products/"+p.ID+"/images/"+img.ID, nil); resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
		t.Fatalf("DELETE = %s, want 204", describe(resp))
	}
	for _, k := range keys {
		if objectExists(t, k) {
			t.Errorf("%s is still in the bucket", k)
		}
	}
	if sh.imageStatus(t, img.ID) != "" {
		t.Error("the image row is still there")
	}
}

// TestImageUpload_StorageDisabled: without S3_ENDPOINT the three image
// routes answer 503 STORAGE_DISABLED, logged at WARN (the configuration
// chose it), and the product routes work without images.
func TestImageUpload_StorageDisabled(t *testing.T) {
	sh := newShop(t, map[string]string{"S3_ENDPOINT": ""})
	p := sh.product(t, "kaos-tanpa-foto", variant("TF-M", "M", 50000, 10))
	img := uuidx.NewV7()
	assertError(t, sh.startUpload(t, p.ID, "image/jpeg", 100), http.StatusServiceUnavailable, "STORAGE_DISABLED")
	assertError(t, sh.confirm(t, p.ID, img, ""), http.StatusServiceUnavailable, "STORAGE_DISABLED")
	assertError(t, sh.staffCall(t, http.MethodDelete, "/v1/admin/products/"+p.ID+"/images/"+img, nil),
		http.StatusServiceUnavailable, "STORAGE_DISABLED")
	if _, images := sh.productDetail(t, p.Slug); len(images) != 0 {
		t.Errorf("images %v without storage", images)
	}
	assertLogged(t, sh.server, "WARN", "image uploads are off: S3_ENDPOINT is not set")
	assertLogged(t, sh.server, "WARN", "request refused: switched off by configuration", "STORAGE_DISABLED")
	assertNoErrorLog(t, sh.server)
}
