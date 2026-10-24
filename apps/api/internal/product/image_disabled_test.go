package product_test

// Without S3 every image endpoint answers 503 STORAGE_DISABLED
// (api/openapi.yaml components/responses/StorageUnavailable), not 500:
// httpapi.ToAppError passes every 503 AppError through with its code.

import (
	"errors"
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

func TestImageHandlers_StorageDisabledIs503(t *testing.T) {
	image := "/v1/admin/products/" + productID + "/images/" + imageID
	tests := []struct {
		name   string
		images product.Images // nil: WithImages never called
		method string
		target string
		body   string
	}{
		{name: "upload, no image service", method: http.MethodPost, target: uploadsURL(productID), body: `{"content_type":"image/png","size_bytes":1}`},
		{name: "confirm, no image service", method: http.MethodPost, target: image + "/confirm", body: `{}`},
		{name: "delete, no image service", method: http.MethodDelete, target: image},
		{
			name: "upload, service without a store", images: &fakeImages{startErr: errors.Join(errors.New("start upload"), product.ErrStorageDisabled)},
			method: http.MethodPost, target: uploadsURL(productID), body: `{"content_type":"image/png","size_bytes":1}`,
		},
		{name: "confirm, service without a store", images: &fakeImages{confirmErr: product.ErrStorageDisabled}, method: http.MethodPost, target: image + "/confirm", body: `{}`},
		{name: "delete, service without a store", images: &fakeImages{deleteErr: product.ErrStorageDisabled}, method: http.MethodDelete, target: image},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serveImages(&fakeService{}, tt.images, tt.method, tt.target, tt.body)
			testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable)
			testx.AssertEqual(t, decodeError(t, rec).Error.Code, product.CodeStorageDisabled)
		})
	}
}
