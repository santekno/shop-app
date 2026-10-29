package product_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// fakeService is both product.Catalog and product.Admin. It records the
// calls and answers from its fields, so the handlers are tested without the
// service's rules or a database.
type fakeService struct {
	listCalls []product.ListParams
	page      product.Page
	listErr   error

	getCalls []string
	product  product.Product
	getErr   error

	adminCalls []string
	admin      product.AdminProduct
	adminErr   error

	created   []product.Input
	createErr error

	updatedIDs []string
	updated    []product.Input
	updateErr  error

	archived   []string
	archiveErr error
}

func (f *fakeService) List(_ context.Context, p product.ListParams) (product.Page, error) {
	f.listCalls = append(f.listCalls, p)
	return f.page, f.listErr
}

func (f *fakeService) Get(_ context.Context, slug string) (product.Product, error) {
	f.getCalls = append(f.getCalls, slug)
	return f.product, f.getErr
}

func (f *fakeService) GetAdmin(_ context.Context, id string) (product.AdminProduct, error) {
	f.adminCalls = append(f.adminCalls, id)
	return f.admin, f.adminErr
}

func (f *fakeService) Create(_ context.Context, in product.Input) (product.AdminProduct, error) {
	f.created = append(f.created, in)
	return f.admin, f.createErr
}

func (f *fakeService) Update(_ context.Context, id string, in product.Input) (product.AdminProduct, error) {
	f.updatedIDs = append(f.updatedIDs, id)
	f.updated = append(f.updated, in)
	return f.admin, f.updateErr
}

func (f *fakeService) Archive(_ context.Context, id string) error {
	f.archived = append(f.archived, id)
	return f.archiveErr
}

// serve sends one request through the storefront and admin routes, mounted
// as internal/app mounts them.
func serve(svc *fakeService, method, target, body string) *httptest.ResponseRecorder {
	h := product.NewHandler(svc, svc, httpapi.NewValidator())
	r := chi.NewRouter()
	r.Route("/v1", func(r chi.Router) {
		h.Routes(r)
		r.Route("/admin", h.AdminRoutes)
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), method, target, strings.NewReader(body)))
	return rec
}

type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) errorBody {
	t.Helper()
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
	}
	return body
}

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	dec := json.NewDecoder(bytes.NewReader(rec.Body.Bytes()))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return m
}

const (
	productID = "0190c8a0-0000-7000-8000-000000000001"
	variantID = "0190c8a0-0000-7000-8000-000000000002"
	catID     = "0190c8a0-0000-7000-8000-0000000000c1"
)

func storefrontProduct() product.Product {
	parent := "0190c8a0-0000-7000-8000-0000000000c0"
	return product.Product{
		ID: productID, Slug: "kaos-polos-hitam", Name: "Kaos Polos Hitam", Description: "Katun",
		Category:  category.Category{ID: catID, Slug: "kaos", Name: "Kaos", ParentID: &parent},
		PriceFrom: 89000,
		Variants: []product.Variant{
			{ID: variantID, SKU: "KPH-S", Name: "S", Price: 89000, Stock: 0},
			{ID: "0190c8a0-0000-7000-8000-000000000003", SKU: "KPH-M", Name: "M", Price: 99000, Stock: 4},
		},
		CreatedAt: time.Date(2026, 10, 1, 19, 0, 0, 0, time.FixedZone("WIB", 7*3600)),
		UpdatedAt: time.Date(2026, 10, 3, 9, 30, 0, 0, time.FixedZone("WIB", 7*3600)),
	}
}

func TestHandler_List_Defaults(t *testing.T) {
	svc := &fakeService{page: product.Page{Products: []product.Product{storefrontProduct()}, NextCursor: "abc"}}

	rec := serve(svc, http.MethodGet, "/v1/products", "")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	if len(svc.listCalls) != 1 {
		t.Fatalf("service called %d times, want 1", len(svc.listCalls))
	}
	testx.AssertEqual(t, svc.listCalls[0], product.ListParams{Sort: product.SortNewest, Limit: 20})

	var resp struct {
		Data []struct {
			ID       string `json:"id"`
			Slug     string `json:"slug"`
			Category struct {
				Slug     string  `json:"slug"`
				ParentID *string `json:"parent_id"`
			} `json:"category"`
			PriceFrom struct {
				Amount   int64  `json:"amount"`
				Currency string `json:"currency"`
			} `json:"price_from"`
			InStock  bool `json:"in_stock"`
			Variants []struct {
				SKU   string `json:"sku"`
				Stock int32  `json:"stock"`
				Price struct {
					Amount int64 `json:"amount"`
				} `json:"price"`
			} `json:"variants"`
			CreatedAt string `json:"created_at"`
			UpdatedAt string `json:"updated_at"`
		} `json:"data"`
		Page struct {
			NextCursor *string `json:"next_cursor"`
		} `json:"page"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	testx.AssertEqual(t, len(resp.Data), 1)
	p := resp.Data[0]
	testx.AssertEqual(t, p.Slug, "kaos-polos-hitam")
	testx.AssertEqual(t, p.Category.Slug, "kaos")
	testx.AssertTrue(t, p.Category.ParentID != nil)
	testx.AssertEqual(t, p.PriceFrom.Amount, int64(89000))
	testx.AssertEqual(t, p.PriceFrom.Currency, "IDR")
	testx.AssertTrue(t, p.InStock, "one variant has stock")
	testx.AssertEqual(t, len(p.Variants), 2)
	testx.AssertEqual(t, p.Variants[1].Price.Amount, int64(99000))
	testx.AssertEqual(t, p.CreatedAt, "2026-10-01T12:00:00Z", "times are sent in UTC")
	// Bab 11: the last admin save, the storefront's sitemap lastmod.
	testx.AssertEqual(t, p.UpdatedAt, "2026-10-03T02:30:00Z", "updated_at is its own column, in UTC")
	testx.AssertTrue(t, resp.Page.NextCursor != nil && *resp.Page.NextCursor == "abc", "next_cursor = %v", resp.Page.NextCursor)
}

func TestHandler_List_LastPageAndEmpty(t *testing.T) {
	svc := &fakeService{}

	rec := serve(svc, http.MethodGet, "/v1/products?category=kaos&q=hitam&sort=price_desc&limit=5&cursor=xyz", "")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, rec.Body.String(), `{"data":[],"page":{"next_cursor":null}}`+"\n")
	testx.AssertEqual(t, svc.listCalls[0], product.ListParams{
		Category: "kaos", Query: "hitam", Sort: product.SortPriceDesc, Cursor: "xyz", Limit: 5,
	})
}

func TestHandler_List_Invalid(t *testing.T) {
	tests := []struct {
		name        string
		query       string
		listErr     error
		wantStatus  int
		wantCode    string
		wantDetails map[string]any
		wantCalled  bool
	}{
		{
			name: "limit out of range", query: "limit=0", wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"limit": "must be between 1 and 100"},
		},
		{
			name: "unknown sort", query: "sort=popular", wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"sort": "must be one of: newest, price_asc, price_desc"},
		},
		{
			name: "malformed category", query: "category=Kaos%20Polos", wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"category": "must be a category slug such as kaos"},
		},
		{
			name: "category with a trailing hyphen", query: "category=kaos-", wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"category": "must be a category slug such as kaos"},
		},
		{
			name: "NUL in the search", query: "q=kaos%00", wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"q": "must be valid UTF-8 text without NUL characters"},
		},
		{
			name: "invalid UTF-8 in the search", query: "q=%FF%FE", wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"q": "must be valid UTF-8 text without NUL characters"},
		},
		{
			name: "invalid text in category and cursor", query: "category=%C3&cursor=%00", wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{
				"category": "must be valid UTF-8 text without NUL characters",
				"cursor":   "must be valid UTF-8 text without NUL characters",
			},
		},
		{
			name: "unknown category", query: "category=kemeja", listErr: product.ErrUnknownCategory,
			wantStatus: 400, wantCode: product.CodeUnknownCategory,
			wantDetails: map[string]any{"category": "kemeja"}, wantCalled: true,
		},
		{
			name: "invalid cursor", query: "cursor=abc", listErr: errors.Join(errors.New("x"), product.ErrInvalidCursor),
			wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"cursor": "is not a cursor from page.next_cursor for these filters; start again without it"},
			wantCalled:  true,
		},
		{
			name: "service failure is a 500", query: "", listErr: errors.New("connection refused"),
			wantStatus: 500, wantCode: httpapi.CodeInternal, wantCalled: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{listErr: tt.listErr}

			rec := serve(svc, http.MethodGet, "/v1/products?"+tt.query, "")

			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			if tt.wantDetails != nil {
				testx.AssertEqual(t, len(body.Error.Details), len(tt.wantDetails), "details %v", body.Error.Details)
				for k, v := range tt.wantDetails {
					testx.AssertEqual(t, body.Error.Details[k], v, "details.%s", k)
				}
			}
			testx.AssertEqual(t, len(svc.listCalls) == 1, tt.wantCalled, "service called %d times", len(svc.listCalls))
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "internal error leaked")
		})
	}
}

func TestHandler_Get(t *testing.T) {
	svc := &fakeService{product: storefrontProduct()}

	rec := serve(svc, http.MethodGet, "/v1/products/kaos-polos-hitam", "")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, len(svc.getCalls), 1)
	testx.AssertEqual(t, svc.getCalls[0], "kaos-polos-hitam")
	data := decodeJSON(t, rec)["data"].(map[string]any)
	testx.AssertEqual(t, data["id"], any(productID))
	testx.AssertEqual(t, data["in_stock"], any(true))
}

func TestHandler_Get_NotFound(t *testing.T) {
	tests := []struct {
		name       string
		slug       string
		getErr     error
		wantCalled bool
	}{
		{name: "unknown", slug: "tidak-ada", getErr: product.ErrNotFound, wantCalled: true},
		{name: "upper case", slug: "Kaos", wantCalled: false},
		{name: "double hyphen", slug: "kaos--polos", wantCalled: false},
		{name: "underscore", slug: "kaos_polos", wantCalled: false},
		{name: "longer than 200", slug: strings.Repeat("a", 201), wantCalled: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeService{getErr: tt.getErr}
			rec := serve(svc, http.MethodGet, "/v1/products/"+tt.slug, "")

			testx.AssertEqual(t, rec.Code, http.StatusNotFound)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, httpapi.CodeNotFound)
			testx.AssertEqual(t, body.Error.Message, "product not found")
			testx.AssertEqual(t, len(svc.getCalls) == 1, tt.wantCalled, "service called %d times", len(svc.getCalls))
		})
	}

	// 200 characters is still a slug.
	svc := &fakeService{product: storefrontProduct()}
	rec := serve(svc, http.MethodGet, "/v1/products/"+strings.Repeat("a", 200), "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
}

func TestHandler_Get_ServiceFailure(t *testing.T) {
	svc := &fakeService{getErr: errors.New("connection refused")}
	rec := serve(svc, http.MethodGet, "/v1/products/kaos", "")
	testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
	testx.AssertEqual(t, decodeError(t, rec).Error.Code, httpapi.CodeInternal)
}
