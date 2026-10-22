//go:build integration

package integration_test

import (
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"
)

// TestProductsHTTP_CategoryAndSort checks ?category= and ?sort= over HTTP:
// a category covers its children, every product listed belongs to it, and
// each sort follows the contract.
func TestProductsHTTP_CategoryAndSort(t *testing.T) {
	s, c := catalogServer(t, nil)
	all := c.activeProducts(t)

	tests := []struct {
		category string
		covers   []string
	}{
		{"", nil},
		{"kaos", []string{"kaos"}},
		{"pakaian", []string{"pakaian", "kaos", "kemeja", "celana"}},
		{"kopi-teh", []string{"kopi-teh"}},
		{"barang-langka", []string{"barang-langka"}},
		{"dekorasi-rumah", []string{"dekorasi-rumah"}},
	}
	for _, tt := range tests {
		for _, sort := range allSorts {
			t.Run(tt.category+"/"+string(sort), func(t *testing.T) {
				q := url.Values{"sort": {string(sort)}, "limit": {"3"}}
				keep := func(listedProduct) bool { return true }
				if tt.category != "" {
					q.Set("category", tt.category)
					keep = c.inCategories(tt.covers...)
				}
				got, _ := s.pageAllHTTP(t, q)
				if want := expectedOrder(all, sort, keep); !slices.Equal(got, want) {
					t.Errorf("got %v, want %v", got, want)
				}
			})
		}
	}

	t.Run("listed products carry their category", func(t *testing.T) {
		products, _ := assertProductList(t, s.get(t, "/v1/products?category=pakaian&limit=100"))
		for _, p := range products {
			if p.Category.ID != c.cats["pakaian"] && (p.Category.ParentID == nil || *p.Category.ParentID != c.cats["pakaian"]) {
				t.Errorf("%s is in %s, not in pakaian or one of its children", p.Slug, p.Category.Slug)
			}
		}
	})
}

// TestProductsHTTP_BadFilters checks the 400s for ?category= and ?sort=.
func TestProductsHTTP_BadFilters(t *testing.T) {
	s, _ := catalogServer(t, nil)

	t.Run("unknown category", func(t *testing.T) {
		details := assertErrorDetails(t, s.get(t, "/v1/products?category=sepatu"), http.StatusBadRequest, "UNKNOWN_CATEGORY")
		if details["category"] != "sepatu" {
			t.Errorf("details = %v, want category: sepatu", details)
		}
	})

	tests := []struct{ name, query, field string }{
		{"category that is not a slug", "category=" + url.QueryEscape("Kaos!"), "category"},
		{"category in upper case", "category=Kaos", "category"},
		{"category over 100 characters", "category=" + strings.Repeat("a", 101), "category"},
		{"unknown sort", "sort=cheapest", "sort"},
		{"sort in upper case", "sort=NEWEST", "sort"},
		{"category with NUL", "category=kaos%00", "category"},
		{"category not UTF-8", "category=%ff%fe", "category"},
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
