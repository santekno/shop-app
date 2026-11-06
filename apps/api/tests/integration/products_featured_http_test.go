//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

// Bab 14: GET /v1/products?featured=true|false. Products are featured by SQL
// (the seed does the same; there is no admin screen yet).

// featureProducts sets is_featured on the products with slugs.
func featureProducts(t *testing.T, c *catalog, slugs ...string) {
	t.Helper()
	for _, slug := range slugs {
		mustExec(t, c.db, `UPDATE products SET is_featured = true WHERE slug = $1`, slug)
	}
}

// featuredFixture features four listed products, plus a draft and an
// archived one, which must never be listed whatever their flag.
var featuredListed = []string{"kaos-polos-hitam", "kemeja-flanel", "ponsel-murah", "kopi-arabika"}

func featuredServer(t *testing.T) (*server, *catalog) {
	t.Helper()
	s, c := catalogServer(t, nil)
	featureProducts(t, c, append(slices.Clone(featuredListed), "kaos-draft", "kaos-arsip")...)
	return s, c
}

// TestProductsFeatured_Filter: featured=true keeps only the active featured
// products, in every sort; featured=false and no parameter list everything
// and the three answers agree; an unflagged product is never in the row.
func TestProductsFeatured_Filter(t *testing.T) {
	s, c := featuredServer(t)
	all := c.activeProducts(t)

	for _, sort := range allSorts {
		t.Run(string(sort), func(t *testing.T) {
			q := url.Values{"featured": {"true"}, "sort": {string(sort)}}
			products, cursor := assertProductList(t, s.get(t, "/v1/products?"+q.Encode()))
			if cursor != "" {
				t.Errorf("next_cursor = %q for four products", cursor)
			}
			want := expectedOrder(all, sort, withSlugs(featuredListed...))
			if !slices.Equal(productSlugs(products), want) || len(want) != len(featuredListed) {
				t.Errorf("featured=true sort=%s:\n got %v\nwant %v", sort, productSlugs(products), want)
			}
		})
	}

	everything := expectedOrder(all, product.SortNewest, nil)
	for _, query := range []string{"", "featured=false", "featured=true&category=kaos", "featured=true&category=pakaian"} {
		t.Run("query="+query, func(t *testing.T) {
			products, _ := assertProductList(t, s.get(t, "/v1/products?limit=100&"+query))
			got := productSlugs(products)
			switch query {
			case "", "featured=false":
				if !slices.Equal(got, everything) {
					t.Errorf("got %v, want all %d listed products", got, len(everything))
				}
			case "featured=true&category=kaos":
				if want := []string{"kaos-polos-hitam"}; !slices.Equal(got, want) {
					t.Errorf("got %v, want %v (the draft and archived kaos stay out)", got, want)
				}
			default:
				if want := []string{"kemeja-flanel", "kaos-polos-hitam"}; !slices.Equal(got, want) {
					t.Errorf("got %v, want %v", got, want)
				}
			}
		})
	}

	t.Run("featured and search", func(t *testing.T) {
		products, _ := assertProductList(t, s.get(t, "/v1/products?featured=true&q=kopi"))
		if want := []string{"kopi-arabika"}; !slices.Equal(productSlugs(products), want) {
			t.Errorf("got %v, want %v", productSlugs(products), want)
		}
		// teh-hijau matches "teh" but is not featured.
		products, _ = assertProductList(t, s.get(t, "/v1/products?featured=true&q=teh"))
		if len(products) != 0 {
			t.Errorf("got %v, want none", productSlugs(products))
		}
	})

	t.Run("nothing featured is an empty page", func(t *testing.T) {
		mustExec(t, c.db, `UPDATE products SET is_featured = false`)
		products, cursor := assertProductList(t, s.get(t, "/v1/products?featured=true"))
		if len(products) != 0 || cursor != "" {
			t.Errorf("got %v, cursor %q; want an empty last page", productSlugs(products), cursor)
		}
	})
	assertNoErrorLog(t, s)
}

// TestProductsFeatured_Paging follows next_cursor with featured=true through
// every sort and a few page sizes, and checks a cursor made without the
// filter is refused with it (and the other way round).
func TestProductsFeatured_Paging(t *testing.T) {
	s, c := featuredServer(t)
	all := c.activeProducts(t)

	for _, sort := range allSorts {
		for _, limit := range []int{1, 3} {
			t.Run(fmt.Sprintf("%s/limit=%d", sort, limit), func(t *testing.T) {
				got, sizes := s.pageAllHTTP(t, url.Values{"featured": {"true"}, "sort": {string(sort)}, "limit": {strconv.Itoa(limit)}})
				assertNoDuplicates(t, got)
				if want := expectedOrder(all, sort, withSlugs(featuredListed...)); !slices.Equal(got, want) {
					t.Errorf("pages:\n got %v\nwant %v", got, want)
				}
				assertFullPages(t, sizes, limit)
			})
		}
	}

	t.Run("cursors do not cross the filter", func(t *testing.T) {
		_, plain := assertProductList(t, s.get(t, "/v1/products?limit=2"))
		_, featured := assertProductList(t, s.get(t, "/v1/products?limit=2&featured=true"))
		if plain == "" || featured == "" {
			t.Fatal("fixture: a first page has no next cursor")
		}
		// A cursor from the featured row is refused on the plain query, and
		// a plain cursor on the featured one; featured=false is the plain query.
		for name, q := range map[string]string{
			"featured cursor, no filter":    "limit=2&cursor=" + url.QueryEscape(featured),
			"featured cursor, false":        "limit=2&featured=false&cursor=" + url.QueryEscape(featured),
			"plain cursor, featured filter": "limit=2&featured=true&cursor=" + url.QueryEscape(plain),
		} {
			details := assertErrorDetails(t, s.get(t, "/v1/products?"+q), http.StatusBadRequest, "VALIDATION_FAILED")
			if _, ok := details["cursor"]; !ok {
				t.Errorf("%s: details = %v, want an entry for cursor", name, details)
			}
		}
		// A plain cursor still works with featured=false spelled out, and the
		// featured cursor with the same filter.
		assertProductList(t, s.get(t, "/v1/products?limit=2&featured=false&cursor="+url.QueryEscape(plain)))
		assertProductList(t, s.get(t, "/v1/products?limit=2&featured=true&cursor="+url.QueryEscape(featured)))
	})
	assertNoErrorLog(t, s)
}

// TestProductsFeatured_BadValue: anything but true or false is 400
// VALIDATION_FAILED naming featured, and nothing reaches the database.
func TestProductsFeatured_BadValue(t *testing.T) {
	s, _ := featuredServer(t)
	for _, v := range []string{"1", "0", "t", "yes", "TRUE", "True", "ya", "null", "%20", "tru", "true%00", "%ff"} {
		t.Run(v, func(t *testing.T) {
			details := assertErrorDetails(t, s.get(t, "/v1/products?featured="+v), http.StatusBadRequest, "VALIDATION_FAILED")
			if _, ok := details["featured"]; !ok {
				t.Errorf("details = %v, want an entry for featured", details)
			}
		})
	}
	// An empty value is the same as leaving it out.
	if products, _ := assertProductList(t, s.get(t, "/v1/products?featured=")); len(products) != listedActive {
		t.Errorf("featured= listed %d products, want all %d", len(products), listedActive)
	}
	assertNoErrorLog(t, s)
}
