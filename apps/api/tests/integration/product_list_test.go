//go:build integration

package integration_test

import (
	"errors"
	"fmt"
	"slices"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

// pageThrough follows NextCursor from the first page to the last and
// returns every slug in order and the size of each page.
func pageThrough(t *testing.T, svc *product.Service, params product.ListParams) (slugs []string, sizes []int) {
	t.Helper()
	for range 1000 {
		page, err := svc.List(t.Context(), params)
		if err != nil {
			t.Fatalf("List(%+v): %v", params, err)
		}
		if len(page.Products) > params.Limit {
			t.Fatalf("page has %d products, more than limit %d", len(page.Products), params.Limit)
		}
		sizes = append(sizes, len(page.Products))
		for _, p := range page.Products {
			slugs = append(slugs, p.Slug)
		}
		if page.NextCursor == "" {
			return slugs, sizes
		}
		params.Cursor = page.NextCursor
	}
	t.Fatalf("no last page after 1000 pages: the cursor does not advance")
	return nil, nil
}

// assertFullPages fails unless every page but the last holds exactly limit
// products and the last holds at least one: a next_cursor always leads to
// more products.
func assertFullPages(t *testing.T, sizes []int, limit int) {
	t.Helper()
	for i, n := range sizes {
		last := i == len(sizes)-1
		if (!last && n != limit) || (last && (n < 1 || n > limit)) {
			t.Errorf("page sizes %v with limit %d: every page but the last must be full, and the last not empty", sizes, limit)
			return
		}
	}
}

func assertNoDuplicates(t *testing.T, slugs []string) {
	t.Helper()
	seen := map[string]bool{}
	for _, s := range slugs {
		if seen[s] {
			t.Errorf("%s listed twice", s)
		}
		seen[s] = true
	}
}

// TestProductList_SortsAndCursor pages through every sort with several page
// sizes: the pages together are exactly the active, sellable products in
// the contract's order, with none missing and none repeated, even across
// equal created_at values and equal prices.
func TestProductList_SortsAndCursor(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	c.addListingProducts(t)
	all := c.activeProducts(t)

	for _, sort := range allSorts {
		want := expectedOrder(all, sort, nil)
		if len(want) != listedActive {
			t.Fatalf("fixture: %d sellable active products, want %d", len(want), listedActive)
		}
		for _, limit := range []int{1, 2, 3, 5, product.MaxLimit} {
			t.Run(fmt.Sprintf("%s/limit=%d", sort, limit), func(t *testing.T) {
				got, sizes := pageThrough(t, c.svc, product.ListParams{Sort: sort, Limit: limit})
				assertNoDuplicates(t, got)
				if !slices.Equal(got, want) {
					t.Errorf("order:\n got %v\nwant %v", got, want)
				}
				if limit == product.MaxLimit && len(sizes) != 1 {
					t.Errorf("everything fits one page of %d, got %d pages", limit, len(sizes))
				}
				assertFullPages(t, sizes, limit)
			})
		}
	}
}

// TestProductList_CategoryFilter checks that a category covers its children
// and nothing else, in every sort.
func TestProductList_CategoryFilter(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	c.addListingProducts(t)
	all := c.activeProducts(t)

	tests := []struct {
		category string
		covers   []string // the category slugs whose products are expected
	}{
		{"kaos", []string{"kaos"}},                                   // a child
		{"pakaian", []string{"pakaian", "kaos", "kemeja", "celana"}}, // a parent and its children
		{"elektronik", []string{"elektronik", "ponsel", "aksesoris-ponsel"}},
		{"barang-langka", []string{"barang-langka"}}, // a rare top-level category
		{"dekorasi-rumah", []string{"dekorasi-rumah"}},
	}
	for _, tt := range tests {
		for _, sort := range allSorts {
			t.Run(tt.category+"/"+string(sort), func(t *testing.T) {
				want := expectedOrder(all, sort, c.inCategories(tt.covers...))
				got, _ := pageThrough(t, c.svc, product.ListParams{Category: tt.category, Sort: sort, Limit: 2})
				if !slices.Equal(got, want) {
					t.Errorf("got %v, want %v", got, want)
				}
			})
		}
	}

	t.Run("an empty category has one empty last page", func(t *testing.T) {
		page, err := c.svc.List(t.Context(), product.ListParams{Category: "dekorasi-rumah", Sort: product.SortNewest, Limit: 20})
		if err != nil || len(page.Products) != 0 || page.NextCursor != "" {
			t.Errorf("List = %d products, cursor %q, %v; want none, no cursor, no error", len(page.Products), page.NextCursor, err)
		}
	})

	t.Run("an unknown category is an error, not an empty list", func(t *testing.T) {
		_, err := c.svc.List(t.Context(), product.ListParams{Category: "sepatu", Sort: product.SortNewest, Limit: 20})
		if !errors.Is(err, product.ErrUnknownCategory) {
			t.Errorf("List(category=sepatu) error = %v, want ErrUnknownCategory", err)
		}
	})
}

// TestProductList_Search checks full-text search on the generated search
// column: Indonesian stemming, websearch syntax, and that it combines with
// category, sort and cursor while results keep the requested sort.
func TestProductList_Search(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	c.addListingProducts(t)
	all := c.activeProducts(t)

	tests := []struct {
		name, q, category string
		sort              product.Sort
		want              []string // slugs, in any order; the oracle sorts them
	}{
		{"word in name and description", "katun", "", product.SortNewest,
			[]string{"kaos-polos-hitam", "kaos-polos-putih", "kemeja-flanel"}},
		{"stemming finds dipakai for pakai", "pakai", "", product.SortNewest, []string{"kaos-polos-hitam"}},
		{"case does not matter", "KOPI", "", product.SortNewest, []string{"kopi-arabika"}},
		{"phrase", `"kaos polos"`, "", product.SortPriceAsc, []string{"kaos-polos-hitam", "kaos-polos-putih"}},
		{"excluded word", "kaos -hitam", "", product.SortNewest, []string{"kaos-polos-putih"}},
		{"or", "ponsel or kopi", "", product.SortPriceDesc, []string{"ponsel-murah", "casing-ponsel", "kopi-arabika"}},
		{"with a category", "katun", "kaos", product.SortPriceAsc, []string{"kaos-polos-hitam", "kaos-polos-putih"}},
		{"with a parent category and price sort", "katun", "pakaian", product.SortPriceDesc,
			[]string{"kaos-polos-hitam", "kaos-polos-putih", "kemeja-flanel"}},
		{"no match", "sepeda", "", product.SortNewest, nil},
		{"only spaces is no search", "   ", "", product.SortNewest, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			want := expectedOrder(all, tt.sort, withSlugs(tt.want...))
			if tt.q == "   " {
				want = expectedOrder(all, tt.sort, nil)
			}
			if tt.want != nil && len(want) != len(tt.want) {
				t.Fatalf("fixture: %v are not all listed products", tt.want)
			}
			// limit=1 so the cursor carries the search from page to page.
			got, _ := pageThrough(t, c.svc, product.ListParams{Query: tt.q, Category: tt.category, Sort: tt.sort, Limit: 1})
			if !slices.Equal(got, want) {
				t.Errorf("q=%q category=%q sort=%s:\n got %v\nwant %v", tt.q, tt.category, tt.sort, got, want)
			}
		})
	}

	t.Run("a cursor is tied to its search", func(t *testing.T) {
		page, err := c.svc.List(t.Context(), product.ListParams{Query: "katun", Sort: product.SortNewest, Limit: 1})
		if err != nil || page.NextCursor == "" {
			t.Fatalf("first page: %v, cursor %q", err, page.NextCursor)
		}
		_, err = c.svc.List(t.Context(), product.ListParams{Query: "kaos", Sort: product.SortNewest, Limit: 1, Cursor: page.NextCursor})
		if !errors.Is(err, product.ErrInvalidCursor) {
			t.Errorf("cursor of q=katun used with q=kaos: error = %v, want ErrInvalidCursor", err)
		}
	})
}
