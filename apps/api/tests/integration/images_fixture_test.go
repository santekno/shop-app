//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/storage"
)

// The Bab 6 image harness: uploads go to the real SeaweedFS that `make
// test-integration` starts (S3_ENDPOINT, the bucket `api migrate`
// created), over a presigned PUT exactly as a browser sends it. Every
// test's product has a new id, so tests never meet in the shared bucket.

// testBucket is the S3 bucket of the Compose SeaweedFS, with the API's
// keys, for a test to look at (or plant) objects directly. It skips the
// test when S3_ENDPOINT is unset, like testx does for PostgreSQL; make
// test-integration always sets it and fails on any skip.
func testBucket(t *testing.T) *storage.S3 {
	t.Helper()
	endpoint := os.Getenv("S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("S3_ENDPOINT is not set; run make test-integration")
	}
	s, err := storage.New(storage.Config{
		Endpoint: endpoint, Region: "us-east-1", Bucket: os.Getenv("S3_BUCKET"),
		AccessKey: os.Getenv("S3_ACCESS_KEY"), SecretKey: os.Getenv("S3_SECRET_KEY"),
	})
	if err != nil {
		t.Fatalf("storage.New: %v", err)
	}
	if err := s.EnsureBucket(t.Context()); err != nil {
		t.Fatalf("bucket: %v", err)
	}
	return s
}

// adminImageOut is AdminProductImage.
type adminImageOut struct {
	ID          string            `json:"id"`
	Status      string            `json:"status"`
	Position    int               `json:"position"`
	Alt         string            `json:"alt"`
	ContentType string            `json:"content_type"`
	SizeBytes   int               `json:"size_bytes"`
	URL         *string           `json:"url"`
	Width       *int              `json:"width"`
	Height      *int              `json:"height"`
	Variants    []imageVariantOut `json:"variants"`
}

// imageVariantOut is ImageVariant.
type imageVariantOut struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	URL    string `json:"url"`
}

// imageOut is ProductImage, the storefront's.
type imageOut struct {
	ID       string            `json:"id"`
	URL      string            `json:"url"`
	Alt      string            `json:"alt"`
	Width    int               `json:"width"`
	Height   int               `json:"height"`
	Variants []imageVariantOut `json:"variants"`
}

// presignedOut is ImageUpload.upload.
type presignedOut struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expires_at"`
}

// uploadOut is ImageUpload.
type uploadOut struct {
	Image  adminImageOut `json:"image"`
	Upload presignedOut  `json:"upload"`
}

// assertAdminImage checks one AdminProductImage: url, width and height are
// null until the image is ready.
func assertAdminImage(t *testing.T, raw json.RawMessage, what string) adminImageOut {
	t.Helper()
	obj := object(t, raw, "AdminProductImage", what)
	assertTimestamp(t, obj["created_at"], what+".created_at")
	assertTimestamp(t, obj["updated_at"], what+".updated_at")
	for i, v := range array(t, obj["variants"], what+".variants") {
		object(t, v, "ImageVariant", what+".variants["+strconv.Itoa(i)+"]")
	}
	var img adminImageOut
	if err := json.Unmarshal(raw, &img); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	ready := img.Status == product.ImageReady
	if !uuidPattern.MatchString(img.ID) || (img.URL != nil) != ready || (img.Width != nil) != ready ||
		(img.Height != nil) != ready || (len(img.Variants) > 0) != ready || !product.AllowedImageType(img.ContentType) {
		t.Errorf("%s: %+v breaks the contract", what, img)
	}
	return img
}

// assertStorefrontImages checks a Product's images: ProductImage each,
// pointing at its widest variant, never at an original.
func assertStorefrontImages(t *testing.T, raw json.RawMessage, what string) []imageOut {
	t.Helper()
	var out []imageOut
	for i, r := range array(t, raw, what) {
		w := what + "[" + strconv.Itoa(i) + "]"
		obj := object(t, r, "ProductImage", w)
		for j, v := range array(t, obj["variants"], w+".variants") {
			object(t, v, "ImageVariant", w+".variants["+strconv.Itoa(j)+"]")
		}
		var img imageOut
		if err := json.Unmarshal(r, &img); err != nil {
			t.Fatal(err)
		}
		if len(img.Variants) == 0 {
			t.Fatalf("%s: no variants", w)
		}
		last := img.Variants[len(img.Variants)-1]
		if img.URL != last.URL || img.Width != last.Width || img.Height != last.Height ||
			strings.Contains(img.URL, "/uploads/") || !strings.Contains(img.URL, "/products/") {
			t.Errorf("%s: %+v, want the widest variant under products/", w, img)
		}
		out = append(out, img)
	}
	return out
}

// startUpload is POST …/images/uploads as the admin.
func (sh *shop) startUpload(t *testing.T, productID, contentType string, size int) response {
	t.Helper()
	return sh.staffCall(t, http.MethodPost, "/v1/admin/products/"+productID+"/images/uploads",
		map[string]any{"content_type": contentType, "size_bytes": size})
}

// assertUpload checks a 201 ImageUploadDetail.
func assertUpload(t *testing.T, resp response, what string) uploadOut {
	t.Helper()
	if resp.Status != http.StatusCreated {
		t.Fatalf("%s = %d, want 201: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "ImageUploadDetail", what)
	data := object(t, top["data"], "ImageUpload", what+" data")
	img := assertAdminImage(t, data["image"], what+".image")
	up := decodeObject(t, data["upload"])
	assertKeys(t, up, []string{"method", "url", "headers", "expires_at"}, what+".upload")
	assertTimestamp(t, up["expires_at"], what+".upload.expires_at")
	var u uploadOut
	if err := json.Unmarshal(top["data"], &u); err != nil {
		t.Fatal(err)
	}
	if img.Status != product.ImagePendingUpload || u.Upload.Method != http.MethodPut ||
		u.Upload.Headers["Content-Type"] != img.ContentType || u.Upload.Headers["Content-Length"] != strconv.Itoa(img.SizeBytes) ||
		len(u.Upload.Headers) != 2 || !strings.Contains(u.Upload.URL, "/uploads/") {
		t.Errorf("%s: %+v, want a pending image and a PUT signed for its type and size under uploads/", what, u)
	}
	if d := time.Until(u.Upload.ExpiresAt); d < 14*time.Minute || d > product.UploadTTL+time.Minute {
		t.Errorf("%s: the URL works for %s, want 15 minutes", what, d)
	}
	return u
}

// put sends body to the presigned URL with headers (the ones the API
// returned, unless the test changes them) and returns the S3 status.
func put(t *testing.T, u presignedOut, body []byte, headers map[string]string) int {
	t.Helper()
	if headers == nil {
		headers = u.Headers
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, u.Method, u.URL, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		if k == "Content-Length" {
			n, _ := strconv.ParseInt(v, 10, 64)
			req.ContentLength = n
			continue
		}
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// A body shorter than the signed length makes the transport fail.
		return 0
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

// upload starts an upload of data as contentType, PUTs it and returns the
// pending image.
func (sh *shop) upload(t *testing.T, productID, contentType string, data []byte) adminImageOut {
	t.Helper()
	u := assertUpload(t, sh.startUpload(t, productID, contentType, len(data)), "start upload")
	if status := put(t, u.Upload, data, nil); status != http.StatusOK {
		t.Fatalf("PUT to the presigned URL = %d, want 200", status)
	}
	return u.Image
}

// confirm is POST …/images/{image_id}/confirm as the admin.
func (sh *shop) confirm(t *testing.T, productID, imageID, alt string) response {
	t.Helper()
	return sh.staffCall(t, http.MethodPost, "/v1/admin/products/"+productID+"/images/"+imageID+"/confirm",
		map[string]any{"alt": alt})
}

// assertImageDetail checks a 200 AdminProductImageDetail.
func assertImageDetail(t *testing.T, resp response, what string) adminImageOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	top := object(t, resp.Body, "AdminProductImageDetail", what)
	return assertAdminImage(t, top["data"], what+" data")
}

// uploaded uploads data and confirms it: a processing image.
func (sh *shop) uploaded(t *testing.T, productID, contentType string, data []byte, alt string) adminImageOut {
	t.Helper()
	img := sh.upload(t, productID, contentType, data)
	return assertImageDetail(t, sh.confirm(t, productID, img.ID, alt), "confirm")
}

// imageService is the worker's image service on sh's database and the
// Compose bucket.
func (sh *shop) imageService(t *testing.T) *product.ImageService {
	t.Helper()
	return product.NewImageService(product.NewPostgresRepository(sh.db), testBucket(t))
}

// processImages runs the worker's image job once.
func (sh *shop) processImages(t *testing.T) int {
	t.Helper()
	n, err := sh.imageService(t).ProcessPending(t.Context())
	if err != nil {
		t.Fatalf("ProcessPending: %v", err)
	}
	return n
}

// anonymousGet reads url without credentials, as a browser does, and
// returns the status, the content type and the body.
func anonymousGet(t *testing.T, url string) (int, string, []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header.Get("Content-Type"), body
}

// objectURL is the plain (unsigned) URL of key in the Compose bucket.
func objectURL(key string) string {
	return strings.TrimRight(os.Getenv("S3_ENDPOINT"), "/") + "/" + os.Getenv("S3_BUCKET") + "/" + key
}

// imageKey is the S3 key of a stored image's original.
func (sh *shop) imageKey(t *testing.T, imageID string) string {
	t.Helper()
	keys := queryStrings(t, sh.db, `SELECT original_key FROM product_images WHERE id = $1`, imageID)
	if len(keys) != 1 {
		t.Fatalf("image %s not found", imageID)
	}
	return keys[0]
}

// imageStatus is an image's status, or "" when its row is gone.
func (sh *shop) imageStatus(t *testing.T, imageID string) string {
	t.Helper()
	s := queryStrings(t, sh.db, `SELECT status FROM product_images WHERE id = $1`, imageID)
	if len(s) == 0 {
		return ""
	}
	return s[0]
}

// objectExists reports whether key is in the bucket.
func objectExists(t *testing.T, key string) bool {
	t.Helper()
	_, err := testBucket(t).Stat(t.Context(), key)
	return err == nil
}

// photo is a w×h picture whose top-left quadrant is red and the rest
// blue, so a test can tell which way a variant is turned.
func photo(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.RGBA{B: 255, A: 255}
			if x < w/2 && y < h/2 {
				c = color.RGBA{R: 255, A: 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

// jpegOf is photo(w, h) as a JPEG.
func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, photo(w, h), &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// pngOf is photo(w, h) as a PNG.
func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, photo(w, h)); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// withOrientation inserts an EXIF APP1 segment with the Orientation tag
// right after the JPEG's SOI marker, as a phone camera writes it
// (big-endian TIFF, one IFD entry).
func withOrientation(jpg []byte, orientation uint16) []byte {
	var tiff bytes.Buffer
	tiff.WriteString("MM\x00\x2a")
	_ = binary.Write(&tiff, binary.BigEndian, uint32(8))      // IFD0 offset
	_ = binary.Write(&tiff, binary.BigEndian, uint16(1))      // one entry
	_ = binary.Write(&tiff, binary.BigEndian, uint16(0x0112)) // Orientation
	_ = binary.Write(&tiff, binary.BigEndian, uint16(3))      // SHORT
	_ = binary.Write(&tiff, binary.BigEndian, uint32(1))      // count
	_ = binary.Write(&tiff, binary.BigEndian, orientation)
	_ = binary.Write(&tiff, binary.BigEndian, uint16(0))
	_ = binary.Write(&tiff, binary.BigEndian, uint32(0)) // no next IFD
	segment := append([]byte("Exif\x00\x00"), tiff.Bytes()...)
	var out bytes.Buffer
	out.Write(jpg[:2])
	out.Write([]byte{0xFF, 0xE1})
	_ = binary.Write(&out, binary.BigEndian, uint16(len(segment)+2)) //nolint:gosec // a few dozen bytes
	out.Write(segment)
	out.Write(jpg[2:])
	return out.Bytes()
}

// pngHeaderOnly is a PNG signature and an IHDR chunk claiming w×h, with a
// correct CRC and no image data: image.DecodeConfig reads it, Decode
// cannot.
func pngHeaderOnly(w, h uint32) []byte {
	var ihdr bytes.Buffer
	ihdr.WriteString("IHDR")
	_ = binary.Write(&ihdr, binary.BigEndian, w)
	_ = binary.Write(&ihdr, binary.BigEndian, h)
	ihdr.Write([]byte{8, 6, 0, 0, 0}) // 8-bit RGBA
	var out bytes.Buffer
	out.WriteString("\x89PNG\r\n\x1a\n")
	_ = binary.Write(&out, binary.BigEndian, uint32(ihdr.Len()-4)) //nolint:gosec // 13 bytes
	out.Write(ihdr.Bytes())
	_ = binary.Write(&out, binary.BigEndian, crc32.ChecksumIEEE(ihdr.Bytes()))
	return out.Bytes()
}

// decodeJPEG decodes a variant fetched from the bucket.
func decodeJPEG(t *testing.T, data []byte, what string) image.Image {
	t.Helper()
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("%s is not a JPEG: %v", what, err)
	}
	return img
}

// isRed reports whether the pixel at x, y is clearly red (JPEG is lossy).
func isRed(img image.Image, x, y int) bool {
	r, g, b, _ := img.At(x, y).RGBA()
	return r > 0xC000 && g < 0x4000 && b < 0x4000
}

// productDetail is GET /v1/products/{slug} checked against the contract,
// with its images.
func (sh *shop) productDetail(t *testing.T, slug string) (productOut, []imageOut) {
	t.Helper()
	resp := sh.get(t, "/v1/products/"+slug)
	p := assertProductDetail(t, resp)
	top := decodeObject(t, resp.Body)
	data := decodeObject(t, top["data"])
	return p, assertStorefrontImages(t, data["images"], "product.images")
}

// adminImages is the admin GET of a product's images, checked against the
// contract.
func (sh *shop) adminImages(t *testing.T, productID string) []adminImageOut {
	t.Helper()
	resp := sh.staffCall(t, http.MethodGet, "/v1/admin/products/"+productID, nil)
	if resp.Status != http.StatusOK {
		t.Fatalf("admin GET product = %s", describe(resp))
	}
	top := object(t, resp.Body, "AdminProductDetail", "admin product")
	data := object(t, top["data"], "AdminProduct", "admin product data")
	var out []adminImageOut
	for i, raw := range array(t, data["images"], "admin product images") {
		out = append(out, assertAdminImage(t, raw, "admin images["+strconv.Itoa(i)+"]"))
	}
	return out
}
