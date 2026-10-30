package product_test

// Bab 12 artikel-02: GET /v1/admin/products, the admin's product table.

import (
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

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// fakeTable is a product.Table that records its params.
type fakeTable struct {
	calls []product.TableParams
	page  product.TablePage
	err   error
}

func (f *fakeTable) List(_ context.Context, p product.TableParams) (product.TablePage, error) {
	f.calls = append(f.calls, p)
	return f.page, f.err
}

// serveTable sends GET target through the admin routes of a handler with
// table, and image URLs on a CDN base.
func serveTable(table product.Table, target string) *httptest.ResponseRecorder {
	svc := &fakeService{}
	h := product.NewHandler(svc, svc, httpapi.NewValidator()).
		WithImages(nil, func(key string) string { return "https://img.example.com/" + key })
	if table != nil {
		h = h.WithTable(table)
	}
	r := chi.NewRouter()
	r.Route("/v1/admin", h.AdminRoutes)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, nil))
	return rec
}

func TestHandler_ListTable_Defaults(t *testing.T) {
	table := &fakeTable{}
	rec := serveTable(table, "/v1/admin/products")

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, len(table.calls), 1)
	testx.AssertEqual(t, table.calls[0], product.TableParams{
		Sort: product.TableSortUpdatedAt, Descending: true, Page: 1, PerPage: 20,
	})
	// An empty page is [] with total_pages 0, never null.
	testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()),
		`{"data":[],"page":{"page":0,"per_page":0,"total":0,"total_pages":0}}`)
}

func TestHandler_ListTable_Params(t *testing.T) {
	const cat = "0190c8a0-0000-7000-8000-0000000000c1"
	tests := []struct {
		query string
		want  product.TableParams
	}{
		{
			query: "q=kaos&status=draft&category_id=" + cat + "&low_stock=true&sort=name&order=asc&page=3&per_page=50",
			want: product.TableParams{Query: "kaos", Status: "draft", CategoryID: cat, LowStock: true,
				Sort: product.TableSortName, Descending: false, Page: 3, PerPage: 50},
		},
		{query: "status=active&sort=price_from", want: product.TableParams{Status: "active", Sort: product.TableSortPriceFrom, Descending: true, Page: 1, PerPage: 20}},
		{query: "status=archived&sort=stock&order=desc", want: product.TableParams{Status: "archived", Sort: product.TableSortStock, Descending: true, Page: 1, PerPage: 20}},
		{query: "sort=created_at&low_stock=false", want: product.TableParams{Sort: product.TableSortCreatedAt, Descending: true, Page: 1, PerPage: 20}},
		// The bounds themselves pass.
		{query: "page=10000&per_page=100", want: product.TableParams{Sort: product.TableSortUpdatedAt, Descending: true, Page: 10000, PerPage: 100}},
		{query: "per_page=1", want: product.TableParams{Sort: product.TableSortUpdatedAt, Descending: true, Page: 1, PerPage: 1}},
		// 100 characters is the longest search; the service trims it.
		{query: "q=" + strings.Repeat("a", 100), want: product.TableParams{Query: strings.Repeat("a", 100), Sort: product.TableSortUpdatedAt, Descending: true, Page: 1, PerPage: 20}},
		{query: "q=%20%2050%25%20", want: product.TableParams{Query: "  50% ", Sort: product.TableSortUpdatedAt, Descending: true, Page: 1, PerPage: 20}},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			table := &fakeTable{}
			rec := serveTable(table, "/v1/admin/products?"+tt.query)
			testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
			testx.AssertEqual(t, len(table.calls), 1)
			testx.AssertEqual(t, table.calls[0], tt.want)
		})
	}
}

// A bad query is 400 VALIDATION_FAILED naming the parameter, and the table
// is never asked.
func TestHandler_ListTable_Invalid(t *testing.T) {
	const sorts = "must be one of: name, price_from, stock, updated_at, created_at"
	tests := []struct{ name, query, field, message string }{
		{name: "search too long", query: "q=" + strings.Repeat("a", 101), field: "q", message: "must be at most 100 characters"},
		{name: "NUL in the search", query: "q=kaos%00", field: "q", message: httpapi.InvalidTextMessage},
		{name: "invalid UTF-8 in the search", query: "q=%FF", field: "q", message: httpapi.InvalidTextMessage},
		{name: "unknown status", query: "status=deleted", field: "status", message: "must be one of: draft, active, archived"},
		{name: "status in another case", query: "status=Active", field: "status", message: "must be one of: draft, active, archived"},
		{name: "category not a uuid", query: "category_id=kaos", field: "category_id", message: "is invalid"},
		{name: "unknown sort", query: "sort=sku", field: "sort", message: sorts},
		{name: "empty sort", query: "sort=", field: "sort", message: sorts},
		{name: "unknown order", query: "order=up", field: "order", message: "must be one of: asc, desc"},
		{name: "page 0", query: "page=0", field: "page", message: "must be between 1 and 10000"},
		{name: "page past the cap", query: "page=10001", field: "page", message: "must be between 1 and 10000"},
		{name: "page not a number", query: "page=two", field: "page", message: "must be an integer"},
		{name: "per_page 0", query: "per_page=0", field: "per_page", message: "must be between 1 and 100"},
		{name: "per_page over 100", query: "per_page=101", field: "per_page", message: "must be between 1 and 100"},
		{name: "low_stock not a bool", query: "low_stock=maybe", field: "low_stock", message: "must be true or false"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			table := &fakeTable{}
			rec := serveTable(table, "/v1/admin/products?"+tt.query)

			testx.AssertEqual(t, rec.Code, http.StatusBadRequest, "body %s", rec.Body.String())
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, httpapi.CodeValidationFailed)
			testx.AssertEqual(t, len(body.Error.Details), 1, "details %v", body.Error.Details)
			testx.AssertEqual(t, body.Error.Details[tt.field], any(tt.message))
			testx.AssertEqual(t, len(table.calls), 0, "the table is not asked")
		})
	}
}

func TestHandler_ListTable_Rows(t *testing.T) {
	price := int64(89000)
	wib := time.FixedZone("WIB", 7*3600)
	table := &fakeTable{page: product.TablePage{
		Page: 2, PerPage: 2, Total: 5,
		Rows: []product.TableRow{
			{
				ID: productID, Slug: "kaos-polos-hitam", Name: "Kaos Polos Hitam", Status: "active",
				CategoryID: catID, CategoryName: "Kaos", PriceFrom: &price, Stock: 12, VariantCount: 3, LowStock: true,
				Thumbnail: &product.ImageVariant{Width: 400, Height: 300, Key: "products/p/i/400.webp"},
				CreatedAt: time.Date(2026, 10, 1, 19, 0, 0, 0, wib), UpdatedAt: time.Date(2026, 10, 2, 19, 0, 0, 0, wib),
			},
			{ID: variantID, Slug: "draft", Name: "Draft", Status: "draft", CategoryID: catID, CategoryName: "Kaos",
				CreatedAt: time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)},
		},
	}}
	rec := serveTable(table, "/v1/admin/products?page=2&per_page=2")

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	var got struct {
		Data []map[string]any `json:"data"`
		Page map[string]any   `json:"page"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	testx.AssertEqual(t, len(got.Data), 2)
	first, second := got.Data[0], got.Data[1]

	testx.AssertEqual(t, first["id"], any(productID))
	testx.AssertEqual(t, first["slug"], any("kaos-polos-hitam"))
	testx.AssertEqual(t, first["name"], any("Kaos Polos Hitam"))
	testx.AssertEqual(t, first["status"], any("active"))
	cat := first["category"].(map[string]any)
	testx.AssertEqual(t, cat["id"], any(catID))
	testx.AssertEqual(t, cat["name"], any("Kaos"))
	priceJSON := first["price_from"].(map[string]any)
	testx.AssertEqual(t, priceJSON["amount"], any(float64(89000)))
	testx.AssertEqual(t, priceJSON["currency"], any("IDR"))
	testx.AssertEqual(t, first["stock"], any(float64(12)))
	testx.AssertEqual(t, first["variant_count"], any(float64(3)))
	testx.AssertEqual(t, first["low_stock"], any(true))
	testx.AssertEqual(t, first["thumbnail_url"], any("https://img.example.com/products/p/i/400.webp"))
	testx.AssertEqual(t, first["created_at"], any("2026-10-01T12:00:00Z"), "UTC")
	testx.AssertEqual(t, first["updated_at"], any("2026-10-02T12:00:00Z"), "UTC")

	// Without a sellable variant or a ready photo: explicit nulls.
	_, hasPrice := second["price_from"]
	testx.AssertTrue(t, hasPrice && second["price_from"] == nil, "price_from: null")
	_, hasThumb := second["thumbnail_url"]
	testx.AssertTrue(t, hasThumb && second["thumbnail_url"] == nil, "thumbnail_url: null")
	testx.AssertEqual(t, second["stock"], any(float64(0)))
	testx.AssertEqual(t, second["low_stock"], any(false))

	testx.AssertEqual(t, got.Page["page"], any(float64(2)))
	testx.AssertEqual(t, got.Page["per_page"], any(float64(2)))
	testx.AssertEqual(t, got.Page["total"], any(float64(5)))
	testx.AssertEqual(t, got.Page["total_pages"], any(float64(3)))
}

// Without WithImages the thumbnail is the bare key (imageURL's fallback).
func TestHandler_ListTable_ThumbnailWithoutStorage(t *testing.T) {
	table := &fakeTable{page: product.TablePage{Page: 1, PerPage: 20, Total: 1, Rows: []product.TableRow{
		{ID: productID, Thumbnail: &product.ImageVariant{Key: "k400"}},
	}}}
	svc := &fakeService{}
	h := product.NewHandler(svc, svc, httpapi.NewValidator()).WithTable(table)
	r := chi.NewRouter()
	r.Route("/v1/admin", h.AdminRoutes)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/admin/products", nil))
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertContains(t, rec.Body.String(), `"thumbnail_url":"k400"`)
}

func TestHandler_ListTable_Failure(t *testing.T) {
	table := &fakeTable{err: errors.New("list product table: connection refused")}
	rec := serveTable(table, "/v1/admin/products")
	testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
	testx.AssertEqual(t, decodeError(t, rec).Error.Code, httpapi.CodeInternal)
	testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "the cause does not leak")
}

// Without WithTable the GET is not registered; POST /products still is, so
// chi answers 405 for the path.
func TestHandler_ListTable_NotRegisteredWithoutTable(t *testing.T) {
	rec := serveTable(nil, "/v1/admin/products")
	testx.AssertEqual(t, rec.Code, http.StatusMethodNotAllowed)

	r := chi.NewRouter()
	svc := &fakeService{}
	product.NewHandler(svc, svc, httpapi.NewValidator()).WithTable(&fakeTable{}).AdminRoutes(r)
	testx.AssertTrue(t, r.Match(chi.NewRouteContext(), http.MethodGet, "/products"), "GET /products with a table")
	testx.AssertTrue(t, r.Match(chi.NewRouteContext(), http.MethodPost, "/products"), "POST /products still there")
}
