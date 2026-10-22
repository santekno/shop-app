//go:build integration

package integration_test

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

// pageAllHTTP follows page.next_cursor over HTTP from the first page to the
// last and returns every slug in order and the size of each page.
func (s *server) pageAllHTTP(t *testing.T, query url.Values) (slugs []string, sizes []int) {
	t.Helper()
	query = cloneValues(query)
	for range 1000 {
		products, cursor := assertProductList(t, s.get(t, "/v1/products?"+query.Encode()))
		sizes = append(sizes, len(products))
		slugs = append(slugs, productSlugs(products)...)
		if cursor == "" {
			return slugs, sizes
		}
		query.Set("cursor", cursor)
	}
	t.Fatal("no last page after 1000 pages")
	return nil, nil
}

// cloneValues copies query so the caller's values are not changed.
func cloneValues(query url.Values) url.Values {
	out := url.Values{}
	for k, v := range query {
		out[k] = slices.Clone(v)
	}
	return out
}

// TestProductsHTTP_Pagination follows next_cursor through every sort over
// HTTP, with the cursor in the URL as a client sends it.
func TestProductsHTTP_Pagination(t *testing.T) {
	s, c := catalogServer(t, nil)
	all := c.activeProducts(t)

	for _, sort := range allSorts {
		for _, limit := range []int{1, 4} {
			t.Run(fmt.Sprintf("%s/limit=%d", sort, limit), func(t *testing.T) {
				got, sizes := s.pageAllHTTP(t, url.Values{"sort": {string(sort)}, "limit": {strconv.Itoa(limit)}})
				assertNoDuplicates(t, got)
				if want := expectedOrder(all, sort, nil); !slices.Equal(got, want) {
					t.Errorf("pages:\n got %v\nwant %v", got, want)
				}
				assertFullPages(t, sizes, limit)
			})
		}
	}
}

// TestProductsHTTP_DefaultLimit checks the default page size of 20 and the
// limit bounds 1 and 100.
func TestProductsHTTP_DefaultLimit(t *testing.T) {
	s, c := catalogServer(t, nil)
	for i := range 12 { // 11 + 12 = 23 listed products
		c.create(t, "camilan", fmt.Sprintf("camilan-%02d", i), fmt.Sprintf("Camilan %02d", i), "",
			variant(fmt.Sprintf("CM-%02d", i), "1", int64(1000+i), 1))
	}
	all := c.activeProducts(t)

	plain := s.get(t, "/v1/products")
	products, cursor := assertProductList(t, plain)
	if cursor == "" || len(products) != 20 {
		t.Errorf("default page: %d products, cursor %q; want 20 and a cursor", len(products), cursor)
	}
	if explicit := s.get(t, "/v1/products?limit=20"); !bytes.Equal(explicit.Body, plain.Body) {
		t.Error("GET /v1/products differs from ?limit=20")
	}

	got, _ := s.pageAllHTTP(t, url.Values{"limit": {"100"}})
	if want := expectedOrder(all, product.SortNewest, nil); !slices.Equal(got, want) {
		t.Errorf("limit=100: got %d products, want all %d in one page", len(got), len(want))
	}
	if products, _ := assertProductList(t, s.get(t, "/v1/products?limit=1")); len(products) > 1 {
		t.Errorf("limit=1 returned %d products", len(products))
	}
}

// TestProductsHTTP_BadPaging checks the 400s for cursors and limits.
func TestProductsHTTP_BadPaging(t *testing.T) {
	s, _ := catalogServer(t, nil)
	_, newest := assertProductList(t, s.get(t, "/v1/products?limit=2"))
	_, kaos := assertProductList(t, s.get(t, "/v1/products?limit=1&category=pakaian"))
	if newest == "" || kaos == "" {
		t.Fatal("fixture: the first pages have no next cursor")
	}
	esc := url.QueryEscape

	tests := []struct {
		name, query, field string
	}{
		{"cursor from another sort", "sort=price_asc&cursor=" + esc(newest), "cursor"},
		{"cursor from another category", "category=kaos&limit=1&cursor=" + esc(kaos), "cursor"},
		{"cursor without its category", "limit=1&cursor=" + esc(kaos), "cursor"},
		{"cursor from no search used with one", "q=kaos&limit=2&cursor=" + esc(newest), "cursor"},
		{"cursor that is not base64url", "cursor=" + esc("not a cursor!"), "cursor"},
		{"cursor that is base64url of something else", "cursor=" + esc("eyJmb28iOiJiYXIifQ"), "cursor"},
		{"edited cursor", "limit=2&cursor=" + esc(newest[:len(newest)-2]+"AA"), "cursor"},
		{"cursor over 512 characters", "cursor=" + strings.Repeat("a", 513), "cursor"},
		{"limit 0", "limit=0", "limit"},
		{"limit 101", "limit=101", "limit"},
		{"limit -1", "limit=-1", "limit"},
		{"limit not a number", "limit=dua", "limit"},
		{"cursor with NUL", "cursor=%00", "cursor"},
		{"cursor with NUL inside", "cursor=" + esc(newest[:10]) + "%00", "cursor"},
		{"cursor not UTF-8", "cursor=%ff%fe", "cursor"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			details := assertErrorDetails(t, s.get(t, "/v1/products?"+tt.query), http.StatusBadRequest, "VALIDATION_FAILED")
			if _, ok := details[tt.field]; !ok {
				t.Errorf("details = %v, want an entry for %q", details, tt.field)
			}
		})
	}
	assertNoErrorLog(t, s)
}
