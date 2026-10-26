package product_test

// Bab 6 artikel-05: the image endpoints and the images in the product
// JSON.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/storage"
)

const imageID = "0190c8a0-0000-7000-8000-0000000000e1"

// fakeImages is product.Images: it records the calls and answers from its
// fields.
type fakeImages struct {
	starts   []string // "productID contentType size"
	upload   product.Upload
	startErr error

	confirms   []string // "productID imageID alt"
	confirmed  product.Image
	confirmErr error

	deletes   []string // "productID imageID"
	deleteErr error
}

func (f *fakeImages) StartUpload(_ context.Context, productID, contentType string, size int32) (product.Upload, error) {
	f.starts = append(f.starts, fmt.Sprintf("%s %s %d", productID, contentType, size))
	return f.upload, f.startErr
}

func (f *fakeImages) Confirm(_ context.Context, productID, imageID, alt string) (product.Image, error) {
	f.confirms = append(f.confirms, productID+" "+imageID+" "+alt)
	return f.confirmed, f.confirmErr
}

func (f *fakeImages) Delete(_ context.Context, productID, imageID string) error {
	f.deletes = append(f.deletes, productID+" "+imageID)
	return f.deleteErr
}

func publicURL(key string) string { return "https://cdn.test/" + key }

// serveImages is serve with the image endpoints on (images may be nil:
// WithImages was called with a nil service, as in a server without S3).
func serveImages(svc *fakeService, images product.Images, method, target, body string) *httptest.ResponseRecorder {
	h := product.NewHandler(svc, svc, httpapi.NewValidator())
	if images != nil {
		h.WithImages(images, publicURL)
	}
	r := chi.NewRouter()
	r.Route("/v1", func(r chi.Router) {
		h.Routes(r)
		r.Route("/admin", h.AdminRoutes)
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), method, target, strings.NewReader(body)))
	return rec
}

var (
	imgCreatedAt = time.Date(2026, 10, 24, 17, 0, 0, 0, time.FixedZone("WIB", 7*3600))
	twoSizes     = []product.ImageVariant{
		{Width: 400, Height: 300, Key: "products/p/i/400.jpg"},
		{Width: 800, Height: 600, Key: "products/p/i/800.jpg"},
	}
)

func pendingImage() product.Image {
	return product.Image{
		ID: imageID, ProductID: productID, Position: 2, Status: product.ImagePendingUpload, ContentType: "image/png",
		SizeBytes: 2048, OriginalKey: product.ImageKey(productID, imageID), CreatedAt: imgCreatedAt, UpdatedAt: imgCreatedAt,
	}
}

func uploadsURL(id string) string { return "/v1/admin/products/" + id + "/images/uploads" }

func TestImages_StartUpload(t *testing.T) {
	pending := pendingImage()
	pending.UpdatedAt = imgCreatedAt.Add(time.Second)
	images := &fakeImages{upload: product.Upload{
		Image: pending,
		Upload: storage.PresignedUpload{
			URL:       "https://uploads.test/goshop/uploads/x/original?X-Amz-Signature=abc",
			Headers:   map[string]string{"Content-Type": "image/png", "Content-Length": "2048"},
			ExpiresAt: time.Date(2026, 10, 24, 17, 15, 0, 0, time.FixedZone("WIB", 7*3600)),
		},
	}}

	rec := serveImages(&fakeService{}, images, http.MethodPost, uploadsURL(productID), `{"content_type":"image/png","size_bytes":2048}`)

	testx.AssertEqual(t, rec.Code, http.StatusCreated)
	testx.AssertEqual(t, strings.Join(images.starts, ","), productID+" image/png 2048")
	data := decodeJSON(t, rec)["data"].(map[string]any)
	img := data["image"].(map[string]any)
	testx.AssertEqual(t, img["id"], any(imageID))
	testx.AssertEqual(t, img["status"], any("pending_upload"))
	testx.AssertEqual(t, img["position"], any(json.Number("2")))
	testx.AssertEqual(t, img["content_type"], any("image/png"))
	testx.AssertEqual(t, img["size_bytes"], any(json.Number("2048")))
	testx.AssertNil(t, img["url"], "no url until ready")
	testx.AssertNil(t, img["width"])
	testx.AssertNil(t, img["height"])
	testx.AssertEqual(t, len(img["variants"].([]any)), 0)
	testx.AssertEqual(t, img["created_at"], any("2026-10-24T10:00:00Z"))
	testx.AssertEqual(t, img["updated_at"], any("2026-10-24T10:00:01Z"))
	up := data["upload"].(map[string]any)
	testx.AssertEqual(t, up["method"], any("PUT"))
	testx.AssertEqual(t, up["url"], any("https://uploads.test/goshop/uploads/x/original?X-Amz-Signature=abc"))
	testx.AssertEqual(t, up["expires_at"], any("2026-10-24T10:15:00Z"))
	headers := up["headers"].(map[string]any)
	testx.AssertEqual(t, len(headers), 2)
	testx.AssertEqual(t, headers["Content-Type"], any("image/png"))
	testx.AssertEqual(t, headers["Content-Length"], any("2048"))
}

func TestImages_StartUpload_Validation(t *testing.T) {
	tests := []struct {
		name  string
		body  string
		field string
	}{
		{name: "gif", body: `{"content_type":"image/gif","size_bytes":10}`, field: "content_type"},
		{name: "svg", body: `{"content_type":"image/svg+xml","size_bytes":10}`, field: "content_type"},
		{name: "no type", body: `{"size_bytes":10}`, field: "content_type"},
		{name: "upper case", body: `{"content_type":"IMAGE/PNG","size_bytes":10}`, field: "content_type"},
		{name: "empty file", body: `{"content_type":"image/png","size_bytes":0}`, field: "size_bytes"},
		{name: "negative size", body: `{"content_type":"image/png","size_bytes":-1}`, field: "size_bytes"},
		{name: "over 5 MiB", body: `{"content_type":"image/png","size_bytes":5242881}`, field: "size_bytes"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			images := &fakeImages{}
			rec := serveImages(&fakeService{}, images, http.MethodPost, uploadsURL(productID), tt.body)
			testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
			e := decodeError(t, rec)
			testx.AssertEqual(t, e.Error.Code, httpapi.CodeValidationFailed)
			_, ok := e.Error.Details[tt.field]
			testx.AssertTrue(t, ok, "details %v do not name %s", e.Error.Details, tt.field)
			testx.AssertEqual(t, len(images.starts), 0)
		})
	}
	t.Run("exactly 5 MiB is accepted", func(t *testing.T) {
		images := &fakeImages{upload: product.Upload{Image: pendingImage()}}
		rec := serveImages(&fakeService{}, images, http.MethodPost, uploadsURL(productID), `{"content_type":"image/webp","size_bytes":5242880}`)
		testx.AssertEqual(t, rec.Code, http.StatusCreated)
		testx.AssertEqual(t, strings.Join(images.starts, ","), productID+" image/webp 5242880")
	})
	t.Run("malformed json", func(t *testing.T) {
		images := &fakeImages{}
		rec := serveImages(&fakeService{}, images, http.MethodPost, uploadsURL(productID), `{"content_type":`)
		testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
		testx.AssertEqual(t, len(images.starts), 0)
	})
}

func TestImages_StartUpload_Errors(t *testing.T) {
	body := `{"content_type":"image/jpeg","size_bytes":100}`
	t.Run("not a uuid", func(t *testing.T) {
		images := &fakeImages{}
		rec := serveImages(&fakeService{}, images, http.MethodPost, uploadsURL("kaos-polos"), body)
		testx.AssertEqual(t, rec.Code, http.StatusNotFound)
		testx.AssertEqual(t, decodeError(t, rec).Error.Code, httpapi.CodeNotFound)
		testx.AssertEqual(t, len(images.starts), 0)
	})
	tests := []struct {
		err        error
		wantStatus int
		wantCode   string
	}{
		{err: product.ErrImageLimit, wantStatus: http.StatusConflict, wantCode: product.CodeImageLimit},
		{err: product.ErrNotFound, wantStatus: http.StatusNotFound, wantCode: httpapi.CodeNotFound},
		{err: errors.New("connection refused"), wantStatus: http.StatusInternalServerError, wantCode: httpapi.CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.err.Error(), func(t *testing.T) {
			images := &fakeImages{startErr: fmtWrap(tt.err)}
			rec := serveImages(&fakeService{}, images, http.MethodPost, uploadsURL(productID), body)
			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			e := decodeError(t, rec)
			testx.AssertEqual(t, e.Error.Code, tt.wantCode)
			if tt.wantCode == product.CodeImageLimit {
				testx.AssertEqual(t, e.Error.Details["max"], any(float64(10)))
			}
		})
	}
}

// fmtWrap wraps err as the service does, so the handler must match it
// with errors.Is.
func fmtWrap(err error) error { return errors.Join(errors.New("start upload"), err) }

func confirmURL(pid, iid string) string {
	return "/v1/admin/products/" + pid + "/images/" + iid + "/confirm"
}

func TestImages_Confirm(t *testing.T) {
	img := pendingImage()
	img.Status, img.Alt, img.Width, img.Height = product.ImageProcessing, "Kaos hitam", 1200, 900
	images := &fakeImages{confirmed: img}

	rec := serveImages(&fakeService{}, images, http.MethodPost, confirmURL(productID, imageID), `{"alt":"Kaos hitam"}`)

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.Join(images.confirms, ","), productID+" "+imageID+" Kaos hitam")
	data := decodeJSON(t, rec)["data"].(map[string]any)
	testx.AssertEqual(t, data["status"], any("processing"))
	testx.AssertEqual(t, data["alt"], any("Kaos hitam"))
	testx.AssertNil(t, data["url"], "processing: no url yet")
	testx.AssertNil(t, data["width"], "dimensions are shown once ready")
}

func TestImages_Confirm_EmptyBodyHasNoAlt(t *testing.T) {
	images := &fakeImages{confirmed: pendingImage()}
	rec := serveImages(&fakeService{}, images, http.MethodPost, confirmURL(productID, imageID), `{}`)
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.Join(images.confirms, ","), productID+" "+imageID+" ")
}

func TestImages_Confirm_Errors(t *testing.T) {
	tests := []struct {
		name       string
		target     string
		body       string
		images     *fakeImages
		wantStatus int
		wantCode   string
		wantReason string
		asked      bool
	}{
		{name: "product id not a uuid", target: confirmURL("123", imageID), body: `{}`, wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "image id not a uuid", target: confirmURL(productID, "abc"), body: `{}`, wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "alt over 200 characters", target: confirmURL(productID, imageID), body: `{"alt":"` + strings.Repeat("é", 201) + `"}`, wantStatus: 400, wantCode: httpapi.CodeValidationFailed},
		{name: "alt with NUL", target: confirmURL(productID, imageID), body: `{"alt":"a\u0000b"}`, wantStatus: 400, wantCode: httpapi.CodeValidationFailed},
		{name: "malformed json", target: confirmURL(productID, imageID), body: `{`, wantStatus: 400},
		{
			name: "unknown image", target: confirmURL(productID, imageID), body: `{}`, images: &fakeImages{confirmErr: product.ErrImageNotFound},
			wantStatus: 404, wantCode: httpapi.CodeNotFound, asked: true,
		},
		{
			name: "not uploaded yet", target: confirmURL(productID, imageID), body: `{}`, images: &fakeImages{confirmErr: product.ErrUploadMissing},
			wantStatus: 409, wantCode: product.CodeUploadMissing, asked: true,
		},
		{
			name: "invalid upload", target: confirmURL(productID, imageID), body: `{}`,
			images:     &fakeImages{confirmErr: &product.UploadInvalidError{Reason: "too_many_pixels"}},
			wantStatus: 422, wantCode: product.CodeUploadInvalid, wantReason: "too_many_pixels", asked: true,
		},
		{
			name: "failure", target: confirmURL(productID, imageID), body: `{}`, images: &fakeImages{confirmErr: errors.New("s3 down")},
			wantStatus: 500, wantCode: httpapi.CodeInternal, asked: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			images := tt.images
			if images == nil {
				images = &fakeImages{}
			}
			rec := serveImages(&fakeService{}, images, http.MethodPost, tt.target, tt.body)
			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			e := decodeError(t, rec)
			if tt.wantCode != "" {
				testx.AssertEqual(t, e.Error.Code, tt.wantCode)
			}
			if tt.wantReason != "" {
				testx.AssertEqual(t, e.Error.Details["reason"], any(tt.wantReason))
			}
			testx.AssertEqual(t, len(images.confirms) == 1, tt.asked)
		})
	}
	t.Run("alt of exactly 200 characters", func(t *testing.T) {
		images := &fakeImages{confirmed: pendingImage()}
		rec := serveImages(&fakeService{}, images, http.MethodPost, confirmURL(productID, imageID), `{"alt":"`+strings.Repeat("é", 200)+`"}`)
		testx.AssertEqual(t, rec.Code, http.StatusOK)
	})
}

func TestImages_Delete(t *testing.T) {
	target := "/v1/admin/products/" + productID + "/images/" + imageID
	t.Run("deleted", func(t *testing.T) {
		images := &fakeImages{}
		rec := serveImages(&fakeService{}, images, http.MethodDelete, target, "")
		testx.AssertEqual(t, rec.Code, http.StatusNoContent)
		testx.AssertEqual(t, rec.Body.Len(), 0)
		testx.AssertEqual(t, strings.Join(images.deletes, ","), productID+" "+imageID)
	})
	t.Run("unknown", func(t *testing.T) {
		images := &fakeImages{deleteErr: product.ErrImageNotFound}
		rec := serveImages(&fakeService{}, images, http.MethodDelete, target, "")
		testx.AssertEqual(t, rec.Code, http.StatusNotFound)
		testx.AssertEqual(t, decodeError(t, rec).Error.Code, httpapi.CodeNotFound)
	})
	t.Run("not a uuid", func(t *testing.T) {
		images := &fakeImages{}
		rec := serveImages(&fakeService{}, images, http.MethodDelete, "/v1/admin/products/"+productID+"/images/1", "")
		testx.AssertEqual(t, rec.Code, http.StatusNotFound)
		testx.AssertEqual(t, len(images.deletes), 0)
	})
}

func storefrontImages() []product.Image {
	return []product.Image{
		{ID: "ready", Status: product.ImageReady, Alt: "depan", Variants: twoSizes, OriginalKey: "uploads/p/i/original"},
		{ID: "ready-without-variants", Status: product.ImageReady, OriginalKey: "uploads/p/j/original"},
		{ID: "processing", Status: product.ImageProcessing, Variants: twoSizes, OriginalKey: "uploads/p/k/original"},
		{ID: "pending", Status: product.ImagePendingUpload, OriginalKey: "uploads/p/l/original"},
	}
}

func assertStorefrontImages(t *testing.T, raw any) {
	t.Helper()
	images := raw.([]any)
	testx.AssertEqual(t, len(images), 1, "only a ready image with variants is shown")
	img := images[0].(map[string]any)
	testx.AssertEqual(t, img["id"], any("ready"))
	testx.AssertEqual(t, img["url"], any("https://cdn.test/products/p/i/800.jpg"), "the widest variant, never the original")
	testx.AssertEqual(t, img["alt"], any("depan"))
	testx.AssertEqual(t, img["width"], any(json.Number("800")))
	testx.AssertEqual(t, img["height"], any(json.Number("600")))
	variants := img["variants"].([]any)
	testx.AssertEqual(t, len(variants), 2)
	v0 := variants[0].(map[string]any)
	testx.AssertEqual(t, v0["url"], any("https://cdn.test/products/p/i/400.jpg"))
	testx.AssertEqual(t, v0["width"], any(json.Number("400")))
	_, hasStatus := img["status"]
	testx.AssertFalse(t, hasStatus, "the storefront does not see statuses")
}

func TestImages_StorefrontJSON(t *testing.T) {
	p := storefrontProduct()
	p.Images = storefrontImages()

	t.Run("product page", func(t *testing.T) {
		rec := serveImages(&fakeService{product: p}, &fakeImages{}, http.MethodGet, "/v1/products/kaos-polos-hitam", "")
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		testx.AssertFalse(t, strings.Contains(rec.Body.String(), "original"), "the original's key leaked: %s", rec.Body.String())
		testx.AssertFalse(t, strings.Contains(rec.Body.String(), "uploads/"), "an uploads/ key leaked: %s", rec.Body.String())
		assertStorefrontImages(t, decodeJSON(t, rec)["data"].(map[string]any)["images"])
	})
	t.Run("list", func(t *testing.T) {
		other := storefrontProduct()
		other.ID, other.Slug = variantID, "lain"
		svc := &fakeService{page: product.Page{Products: []product.Product{p, other}}}
		rec := serveImages(svc, &fakeImages{}, http.MethodGet, "/v1/products", "")
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		data := decodeJSON(t, rec)["data"].([]any)
		testx.AssertEqual(t, len(data), 2)
		assertStorefrontImages(t, data[0].(map[string]any)["images"])
		testx.AssertEqual(t, len(data[1].(map[string]any)["images"].([]any)), 0, "no images is [], not null")
		testx.AssertFalse(t, strings.Contains(rec.Body.String(), "original"))
	})
	t.Run("without a public URL the key is the url", func(t *testing.T) {
		h := product.NewHandler(&fakeService{product: p}, &fakeService{}, httpapi.NewValidator())
		r := chi.NewRouter()
		r.Route("/v1", h.Routes)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/products/kaos-polos-hitam", nil))
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		img := decodeJSON(t, rec)["data"].(map[string]any)["images"].([]any)[0].(map[string]any)
		testx.AssertEqual(t, img["url"], any("products/p/i/800.jpg"))
	})
}

func TestImages_AdminJSON(t *testing.T) {
	p := adminProduct()
	p.Images = storefrontImages()
	p.Images[0].Width, p.Images[0].Height = 1600, 1200

	rec := serveImages(&fakeService{admin: p}, &fakeImages{}, http.MethodGet, "/v1/admin/products/"+productID, "")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	images := decodeJSON(t, rec)["data"].(map[string]any)["images"].([]any)
	testx.AssertEqual(t, len(images), 4, "the admin sees every image")
	byID := map[string]map[string]any{}
	for _, raw := range images {
		img := raw.(map[string]any)
		byID[img["id"].(string)] = img
	}
	ready := byID["ready"]
	testx.AssertEqual(t, ready["status"], any("ready"))
	testx.AssertEqual(t, ready["url"], any("https://cdn.test/products/p/i/800.jpg"))
	testx.AssertEqual(t, ready["width"], any(json.Number("800")), "the widest variant's size")
	testx.AssertEqual(t, len(ready["variants"].([]any)), 2)
	for _, id := range []string{"ready-without-variants", "processing", "pending"} {
		testx.AssertNil(t, byID[id]["url"], "%s has a url", id)
		testx.AssertNil(t, byID[id]["width"], "%s has a width", id)
		testx.AssertNil(t, byID[id]["height"], "%s has a height", id)
	}
	testx.AssertEqual(t, byID["pending"]["status"], any("pending_upload"))
	testx.AssertEqual(t, len(byID["processing"]["variants"].([]any)), 2, "variants are listed whatever the status")
}

func TestImages_AdminJSON_NoImagesIsEmptyList(t *testing.T) {
	for _, tt := range []struct {
		method, target, body string
		want                 int
	}{
		{http.MethodGet, "/v1/admin/products/" + productID, "", http.StatusOK},
		{http.MethodPost, "/v1/admin/products", "", http.StatusCreated},
		{http.MethodPut, "/v1/admin/products/" + productID, "", http.StatusOK},
	} {
		body := tt.body
		if tt.method != http.MethodGet {
			body = productBody(t)
		}
		rec := serveImages(&fakeService{admin: adminProduct()}, &fakeImages{}, tt.method, tt.target, body)
		testx.AssertEqual(t, rec.Code, tt.want, tt.method)
		testx.AssertContains(t, rec.Body.String(), `"images":[]`)
	}
}

func productBody(t *testing.T) string {
	t.Helper()
	return body(t, nil)
}
