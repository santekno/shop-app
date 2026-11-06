package product_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

func TestHandler_List_Featured(t *testing.T) {
	tests := []struct {
		name         string
		query        string
		wantFeatured bool
	}{
		{name: "absent means every product", query: "", wantFeatured: false},
		{name: "true", query: "featured=true", wantFeatured: true},
		{name: "false", query: "featured=false", wantFeatured: false},
		{name: "empty value means every product", query: "featured=", wantFeatured: false},
	}
	for _, sort := range []product.Sort{product.SortNewest, product.SortPriceAsc, product.SortPriceDesc} {
		for _, tt := range tests {
			t.Run(string(sort)+"/"+tt.name, func(t *testing.T) {
				svc := &fakeService{}
				target := "/v1/products?sort=" + string(sort)
				if tt.query != "" {
					target += "&" + tt.query
				}

				rec := serve(svc, http.MethodGet, target, "")

				testx.AssertEqual(t, rec.Code, http.StatusOK)
				testx.AssertEqual(t, len(svc.listCalls), 1)
				testx.AssertEqual(t, svc.listCalls[0], product.ListParams{Sort: sort, Limit: 20, Featured: tt.wantFeatured})
			})
		}
	}

	t.Run("combines with the other filters", func(t *testing.T) {
		svc := &fakeService{}

		rec := serve(svc, http.MethodGet, "/v1/products?featured=true&category=kaos&q=hitam&limit=4&cursor=abc", "")

		testx.AssertEqual(t, rec.Code, http.StatusOK)
		testx.AssertEqual(t, svc.listCalls[0], product.ListParams{
			Category: "kaos", Query: "hitam", Sort: product.SortNewest, Cursor: "abc", Limit: 4, Featured: true,
		})
	})
}

func TestHandler_List_FeaturedInvalid(t *testing.T) {
	for _, value := range []string{"1", "0", "t", "T", "yes", "TRUE", "True", "maybe"} {
		t.Run(value, func(t *testing.T) {
			svc := &fakeService{}

			rec := serve(svc, http.MethodGet, "/v1/products?featured="+value, "")

			testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, httpapi.CodeValidationFailed)
			testx.AssertEqual(t, body.Error.Details["featured"], any("must be one of: true, false"))
			testx.AssertEqual(t, len(svc.listCalls), 0, "the service is not called")
		})
	}
}

func TestHandler_List_FeaturedCursorOfAnotherFilter(t *testing.T) {
	svc := &fakeService{listErr: product.ErrInvalidCursor}

	rec := serve(svc, http.MethodGet, "/v1/products?cursor=abc", "")

	testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
	testx.AssertEqual(t, decodeError(t, rec).Error.Code, httpapi.CodeValidationFailed)
}
