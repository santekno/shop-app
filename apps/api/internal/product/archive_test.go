package product_test

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

func TestAdmin_ArchiveProduct(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
	}{
		{name: "archived", wantStatus: http.StatusNoContent},
		// The service treats an already archived product as archived, so
		// the handler answers 204 again: DELETE is idempotent.
		{name: "again", wantStatus: http.StatusNoContent},
		{name: "unknown", err: product.ErrNotFound, wantStatus: http.StatusNotFound},
		{name: "failure", err: errors.New("connection refused"), wantStatus: http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{archiveErr: tt.err}
			rec := serve(svc, http.MethodDelete, "/v1/admin/products/"+productID, "")
			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			testx.AssertEqual(t, strings.Join(svc.archived, ","), productID)
			if tt.wantStatus == http.StatusNoContent {
				testx.AssertEqual(t, rec.Body.Len(), 0, "204 has no body")
			}
		})
	}
}
