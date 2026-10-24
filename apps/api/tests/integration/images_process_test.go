//go:build integration

package integration_test

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

// assertVariant fetches a variant anonymously, as the storefront's
// browsers do, and checks it is a public JPEG of the announced size with
// no EXIF left. It returns the decoded image.
func assertVariant(t *testing.T, v imageVariantOut, what string) []byte {
	t.Helper()
	status, contentType, body := anonymousGet(t, v.URL)
	if status != http.StatusOK || contentType != "image/jpeg" {
		t.Fatalf("anonymous GET %s = %d %s, want 200 image/jpeg: products/ is public", v.URL, status, contentType)
	}
	img := decodeJPEG(t, body, what)
	if b := img.Bounds(); b.Dx() != v.Width || b.Dy() != v.Height {
		t.Errorf("%s is %dx%d, announced %dx%d", what, b.Dx(), b.Dy(), v.Width, v.Height)
	}
	if bytes.Contains(body, []byte("Exif\x00\x00")) {
		t.Errorf("%s still carries EXIF", what)
	}
	return body
}

// TestImageProcess_Variants: the worker's job turns a confirmed photo into
// 400 and 800 pixel wide JPEGs under products/, publicly readable, with
// the original's proportions; the image becomes ready, and the storefront
// lists it on the product page and in the product list, pointing at the
// widest variant. The original stays private.
func TestImageProcess_Variants(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-varian", variant("VR-M", "M", 50000, 10))
	img := sh.uploaded(t, p.ID, "image/jpeg", jpegOf(t, 1200, 900), "Kaos varian")
	if n := sh.processImages(t); n != 1 {
		t.Fatalf("ProcessPending = %d, want 1", n)
	}
	if sh.imageStatus(t, img.ID) != product.ImageReady {
		t.Fatalf("image %s, want ready", sh.imageStatus(t, img.ID))
	}
	if n := sh.processImages(t); n != 0 {
		t.Errorf("a second run processed %d images", n)
	}

	_, images := sh.productDetail(t, p.Slug)
	if len(images) != 1 {
		t.Fatalf("the storefront shows %d images, want 1", len(images))
	}
	got := images[0]
	if got.ID != img.ID || got.Alt != "Kaos varian" || len(got.Variants) != 2 ||
		got.Variants[0].Width != 400 || got.Variants[0].Height != 300 ||
		got.Variants[1].Width != 800 || got.Variants[1].Height != 600 {
		t.Fatalf("storefront image %+v, want 400x300 and 800x600", got)
	}
	for i, v := range got.Variants {
		if !strings.HasSuffix(v.URL, "/products/"+p.ID+"/"+img.ID+"/"+[]string{"400", "800"}[i]+".jpg") {
			t.Errorf("variant URL %s", v.URL)
		}
		assertVariant(t, v, v.URL)
	}
	if status, _, _ := anonymousGet(t, objectURL(product.ImageKey(p.ID, img.ID))); status != http.StatusForbidden {
		t.Errorf("anonymous GET of the original = %d, want 403", status)
	}

	list := sh.get(t, "/v1/products?category=kaos")
	assertProductList(t, list)
	var found bool
	for _, raw := range array(t, decodeObject(t, list.Body)["data"], "products") {
		obj := decodeObject(t, raw)
		if strings.Contains(string(obj["id"]), p.ID) {
			found = true
			if listed := assertStorefrontImages(t, obj["images"], "listed images"); len(listed) != 1 || listed[0].URL != got.URL {
				t.Errorf("the list shows %+v, want the product page's image", listed)
			}
		}
	}
	if !found {
		t.Error("the product is not in the list")
	}
	admin := sh.adminImages(t, p.ID)
	if len(admin) != 1 || admin[0].Status != product.ImageReady || admin[0].URL == nil || *admin[0].URL != got.URL ||
		*admin[0].Width != 800 || *admin[0].Height != 600 {
		t.Errorf("admin image %+v", admin)
	}
	assertNoServerErrors(t, sh.server)
}

// TestImageProcess_ExifOrientation: a phone stores a portrait photo
// landscape with EXIF Orientation 6 ("turn 90° clockwise to display").
// The variants have no EXIF, so the worker turns them: portrait sizes from
// the displayed width, and the original's top-left corner is the
// variant's top-right.
func TestImageProcess_ExifOrientation(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-putar", variant("PU-M", "M", 50000, 10))
	img := sh.uploaded(t, p.ID, "image/jpeg", withOrientation(jpegOf(t, 1200, 900), 6), "")
	sh.processImages(t)

	_, images := sh.productDetail(t, p.Slug)
	if len(images) != 1 {
		t.Fatalf("%d images, want 1", len(images))
	}
	vs := images[0].Variants
	if len(vs) != 2 || vs[0].Width != 400 || vs[0].Height != 533 || vs[1].Width != 800 || vs[1].Height != 800*1200/900 {
		t.Fatalf("variants %+v, want portrait 400x533 and 800x1066", vs)
	}
	for _, v := range vs {
		decoded := decodeJPEG(t, assertVariant(t, v, v.URL), v.URL)
		w := decoded.Bounds().Dx()
		if !isRed(decoded, w-10, 10) || isRed(decoded, 10, 10) || isRed(decoded, w-10, decoded.Bounds().Dy()-10) {
			t.Errorf("variant %dw is not turned clockwise: the red corner is not top-right", v.Width)
		}
	}
	if n := sh.count(t, `SELECT count(*) FROM product_images WHERE id = $1 AND width = 1200 AND height = 900`, img.ID); n != 1 {
		t.Error("the original's stored dimensions changed")
	}
}

// TestImageProcess_SmallPNG: a PNG narrower than 800 pixels is never
// scaled up: its variants are 400 wide and its own width, both JPEG.
func TestImageProcess_SmallPNG(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-kecil", variant("KC-M", "M", 50000, 10))
	sh.uploaded(t, p.ID, "image/png", pngOf(t, 600, 400), "")
	sh.processImages(t)
	_, images := sh.productDetail(t, p.Slug)
	if len(images) != 1 || len(images[0].Variants) != 2 ||
		images[0].Variants[0].Width != 400 || images[0].Variants[1].Width != 600 || images[0].Variants[1].Height != 400 {
		t.Fatalf("images %+v, want 400w and 600w", images)
	}
	for _, v := range images[0].Variants {
		assertVariant(t, v, v.URL)
	}
}

// TestImageProcess_StorefrontShowsOnlyReady: of a product's ready,
// processing, pending and failed images (an original that no longer
// decodes fails for good), the storefront lists the ready one only, in
// position order; the admin lists all four with their statuses.
func TestImageProcess_StorefrontShowsOnlyReady(t *testing.T) {
	bucket := testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-siap", variant("SP-M", "M", 50000, 10))

	ready := sh.uploaded(t, p.ID, "image/jpeg", jpegOf(t, 900, 900), "siap")
	broken := sh.uploaded(t, p.ID, "image/jpeg", jpegOf(t, 900, 900), "rusak")
	// The file is replaced after confirm checked it: the worker cannot
	// decode it, and the image fails for good.
	if _, err := bucket.Put(t.Context(), sh.imageKey(t, broken.ID), "image/jpeg", bytes.NewReader([]byte("\xff\xd8bukan jpeg"))); err != nil {
		t.Fatal(err)
	}
	if n := sh.processImages(t); n != 2 {
		t.Fatalf("ProcessPending = %d, want 2 (ready and failed)", n)
	}
	processing := sh.uploaded(t, p.ID, "image/jpeg", jpegOf(t, 900, 900), "proses")
	pending := assertUpload(t, sh.startUpload(t, p.ID, "image/png", 100), "pending upload").Image

	_, images := sh.productDetail(t, p.Slug)
	if len(images) != 1 || images[0].ID != ready.ID {
		t.Errorf("the storefront shows %+v, want only the ready image", images)
	}
	want := map[string]string{ready.ID: product.ImageReady, broken.ID: product.ImageFailed,
		processing.ID: product.ImageProcessing, pending.ID: product.ImagePendingUpload}
	admin := sh.adminImages(t, p.ID)
	if len(admin) != 4 {
		t.Fatalf("admin lists %d images, want 4", len(admin))
	}
	for i, img := range admin {
		if img.Status != want[img.ID] || img.Position != i {
			t.Errorf("admin image %d: %s at %d, want %s in position order", i, img.Status, img.Position, want[img.ID])
		}
	}
	assertNoServerErrors(t, sh.server)
}

// TestProcessImages_Command runs `api process-images` for real on the
// test database and bucket; with storage off it does nothing and says so.
func TestProcessImages_Command(t *testing.T) {
	testBucket(t)
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-perintah-foto", variant("PF-M", "M", 50000, 10))
	img := sh.uploaded(t, p.ID, "image/jpeg", jpegOf(t, 1000, 500), "")
	logs := runCommand(t, "process-images")
	if !strings.Contains(logs, "processed product images") || !strings.Contains(logs, "finished=1") {
		t.Errorf("process-images logged:\n%s", logs)
	}
	if sh.imageStatus(t, img.ID) != product.ImageReady {
		t.Errorf("image %s, want ready", sh.imageStatus(t, img.ID))
	}

	startServer(t, map[string]string{"S3_ENDPOINT": ""})
	if logs := runCommand(t, "process-images"); !strings.Contains(logs, "image uploads are off") {
		t.Errorf("process-images with storage off logged:\n%s", logs)
	}
}
