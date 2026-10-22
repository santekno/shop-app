//go:build integration

package integration_test

import (
	"bytes"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// TestProductsHTTP_Search checks ?q= over HTTP, alone and combined with
// category, sort and paging. Results follow the sort, not relevance.
func TestProductsHTTP_Search(t *testing.T) {
	s, c := catalogServer(t, nil)
	all := c.activeProducts(t)

	tests := []struct {
		name     string
		q        string
		category string
		sort     product.Sort
		want     []string
	}{
		{"word", "katun", "", product.SortNewest, []string{"kaos-polos-hitam", "kaos-polos-putih", "kemeja-flanel"}},
		{"stem", "pakai", "", product.SortNewest, []string{"kaos-polos-hitam"}},
		{"name or description", "renyah", "", product.SortNewest, []string{"keripik-singkong"}},
		{"phrase", `"kaos polos"`, "", product.SortPriceDesc, []string{"kaos-polos-hitam", "kaos-polos-putih"}},
		{"excluded word", "kaos -putih", "", product.SortNewest, []string{"kaos-polos-hitam"}},
		{"with category and sort", "katun", "kaos", product.SortPriceAsc, []string{"kaos-polos-hitam", "kaos-polos-putih"}},
		{"nothing matches", "sepeda", "", product.SortNewest, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := url.Values{"q": {tt.q}, "sort": {string(tt.sort)}, "limit": {"1"}}
			if tt.category != "" {
				q.Set("category", tt.category)
			}
			got, _ := s.pageAllHTTP(t, q)
			if want := expectedOrder(all, tt.sort, withSlugs(tt.want...)); !slices.Equal(got, want) {
				t.Errorf("q=%q: got %v, want %v", tt.q, got, want)
			}
		})
	}

	t.Run("only spaces is no search", func(t *testing.T) {
		spaces := s.get(t, "/v1/products?q="+url.QueryEscape("   "))
		if plain := s.get(t, "/v1/products"); spaces.Status != http.StatusOK || !bytes.Equal(spaces.Body, plain.Body) {
			t.Errorf("q of spaces = %d %s, want the unfiltered list", spaces.Status, spaces.Body)
		}
	})

	// websearch_to_tsquery never fails on syntax, and the text is a query
	// parameter, never SQL.
	for _, q := range []string{`kaos & (`, `"`, `-`, `or or`, `'; DROP TABLE products; --`, `kaos:*`, `!!!`} {
		t.Run("odd input "+q, func(t *testing.T) {
			assertProductList(t, s.get(t, "/v1/products?q="+url.QueryEscape(q)))
		})
	}
	if n := queryInt(t, s.db, `SELECT count(*) FROM products`); n == 0 {
		t.Error("the products table is empty after the odd searches")
	}

	// NUL and invalid UTF-8 cannot reach a PostgreSQL text parameter: a
	// 400 naming q, not a 500 from the database.
	for name, raw := range map[string]string{"NUL": "%00", "NUL inside": "kaos%00polos", "not UTF-8": "%ff%fe"} {
		t.Run("q "+name, func(t *testing.T) {
			details := assertErrorDetails(t, s.get(t, "/v1/products?q="+raw), http.StatusBadRequest, "VALIDATION_FAILED")
			if details["q"] != httpapi.InvalidTextMessage {
				t.Errorf("details = %v, want q: %q", details, httpapi.InvalidTextMessage)
			}
		})
	}
	assertNoErrorLog(t, s)

	t.Run("q over 100 characters", func(t *testing.T) {
		details := assertErrorDetails(t, s.get(t, "/v1/products?q="+strings.Repeat("a", 101)), http.StatusBadRequest, "VALIDATION_FAILED")
		if _, ok := details["q"]; !ok {
			t.Errorf("details = %v, want an entry for q", details)
		}
	})
}
