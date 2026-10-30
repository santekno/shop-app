//go:build integration

package integration_test

import (
	"cmp"
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The admin's product table (Bab 12 artikel 02), GET /v1/admin/products,
// against real PostgreSQL: every filter, every sort, the offset pages and
// the low-stock rule, checked against the contract.

// tableRowOut is AdminProductRow.
type tableRowOut struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	Category     struct{ ID, Name string }
	PriceFrom    *moneyOut `json:"price_from"`
	Stock        int64     `json:"stock"`
	VariantCount int32     `json:"variant_count"`
	LowStock     bool      `json:"low_stock"`
	ThumbnailURL *string   `json:"thumbnail_url"`
}

// tablePageOut is OffsetPageInfo.
type tablePageOut struct {
	Page       int   `json:"page"`
	PerPage    int   `json:"per_page"`
	Total      int64 `json:"total"`
	TotalPages int64 `json:"total_pages"`
}

// tableOut is AdminProductTable.
type tableOut struct {
	Data              []tableRowOut `json:"data"`
	Page              tablePageOut  `json:"page"`
	LowStockThreshold int           `json:"low_stock_threshold"`
}

// assertTable checks a 200 AdminProductTable against the contract and
// decodes it.
func assertTable(t *testing.T, resp response, what string) tableOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "AdminProductTable", what)
	object(t, top["page"], "OffsetPageInfo", what+".page")
	for i, raw := range array(t, top["data"], what+".data") {
		rw := what + ".data[" + strconv.Itoa(i) + "]"
		row := object(t, raw, "AdminProductRow", rw)
		if string(row["price_from"]) != "null" {
			assertMoney(t, row["price_from"], rw+".price_from")
		}
		assertTimestamp(t, row["created_at"], rw+".created_at")
		assertTimestamp(t, row["updated_at"], rw+".updated_at")
	}
	var out tableOut
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	return out
}

// tableNames lists the names of a table page, in order.
func tableNames(tbl tableOut) []string {
	out := make([]string, 0, len(tbl.Data))
	for _, r := range tbl.Data {
		out = append(out, r.Name)
	}
	return out
}

// tableFixture is one product of the table test and what the table must
// say about it.
type tableFixture struct {
	name, slug, status, cat string
	variants                []product.VariantInput
	// archived SKUs are archived after the product is created.
	archived []string
	// priceFrom 0 means the product has no price (no sellable variant).
	priceFrom    int64
	stock        int64
	variantCount int32
	lowStock     bool
	id           string
}

// TestAdminTable_FiltersSortsAndPages fills a fresh database with six
// products, then asks the table every question the dashboard asks.
func TestAdminTable_FiltersSortsAndPages(t *testing.T) {
	sh := newShop(t, nil)
	fixtures := []*tableFixture{
		{
			name: "Alpha Kaos", slug: "tabel-alpha", status: "active", cat: "kaos",
			variants:  []product.VariantInput{variant("TA-A1", "S", 30000, 10), variant("TA-A2", "M", 50000, 10)},
			priceFrom: 30000, stock: 20, variantCount: 2,
		},
		{
			// One variant low, the sum far above the threshold: the
			// low-stock filter asks for "some sellable variant", not for
			// a low total (the EXISTS fix of 7311064e).
			name: "Bravo Kemeja", slug: "tabel-bravo", status: "draft", cat: "kemeja",
			variants:  []product.VariantInput{variant("TB-B1", "S", 90000, 3), variant("TB-B2", "M", 95000, 40)},
			priceFrom: 90000, stock: 43, variantCount: 2, lowStock: true,
		},
		{
			// Its only low variant is archived: not low on stock, and the
			// archived SKU still finds the product.
			name: "Charlie Ponsel", slug: "tabel-charlie", status: "active", cat: "ponsel",
			variants: []product.VariantInput{variant("TC-C1", "Hitam", 1500000, 100), variant("TC-OLD", "Lama", 1400000, 1)},
			archived: []string{"TC-OLD"}, priceFrom: 1500000, stock: 100, variantCount: 1,
		},
		{
			// Exactly the threshold is low.
			name: "Delta Kaos", slug: "tabel-delta", status: "archived", cat: "kaos",
			variants:  []product.VariantInput{variant("TD-D1", "M", 10000, product.LowStockThreshold)},
			priceFrom: 10000, stock: product.LowStockThreshold, variantCount: 1, lowStock: true,
		},
		{
			// % and _ in a search match themselves.
			name: "Diskon 50% Kaos", slug: "tabel-diskon", status: "active", cat: "kaos",
			variants:  []product.VariantInput{variant("TE-E1", "M", 45000, 6)},
			priceFrom: 45000, stock: 6, variantCount: 1,
		},
		{
			// A draft whose variants are all archived: no price, no stock.
			name: "Echo Celana", slug: "tabel-echo", status: "draft", cat: "celana",
			variants: []product.VariantInput{variant("TF-F1", "M", 70000, 2)},
			archived: []string{"TF-F1"}, stock: 0, variantCount: 0,
		},
	}
	for _, f := range fixtures {
		f.id = sh.cat.createWithStatus(t, f.status, f.cat, f.slug, f.name, "Uji tabel "+f.name, f.variants...)
		for _, sku := range f.archived {
			mustExec(t, sh.db, `UPDATE product_variants SET archived_at = now() WHERE sku = $1`, sku)
		}
		// What a save that archived them would leave: price_from from the
		// sellable variants (NULL without one).
		mustExec(t, sh.db, `UPDATE products SET price_from = (SELECT min(price) FROM product_variants
			WHERE product_id = $1 AND archived_at IS NULL) WHERE id = $1`, f.id)
	}
	byName := map[string]*tableFixture{}
	for _, f := range fixtures {
		byName[f.name] = f
	}
	names := func(keep func(*tableFixture) bool, less func(a, b *tableFixture) int) []string {
		var out []*tableFixture
		for _, f := range fixtures {
			if keep == nil || keep(f) {
				out = append(out, f)
			}
		}
		if less != nil {
			slices.SortStableFunc(out, less)
		}
		r := make([]string, 0, len(out))
		for _, f := range out {
			r = append(r, f.name)
		}
		return r
	}
	get := func(t *testing.T, query string) tableOut {
		t.Helper()
		return assertTable(t, sh.staffCall(t, http.MethodGet, "/v1/admin/products?"+query, nil), "GET ?"+query)
	}

	t.Run("rows", func(t *testing.T) {
		tbl := get(t, "sort=name&order=asc")
		if tbl.LowStockThreshold != product.LowStockThreshold {
			t.Errorf("low_stock_threshold = %d, want %d", tbl.LowStockThreshold, product.LowStockThreshold)
		}
		if tbl.Page != (tablePageOut{Page: 1, PerPage: 20, Total: 6, TotalPages: 1}) {
			t.Errorf("page = %+v, want 1 of 1, 20 per page, 6 in all", tbl.Page)
		}
		for _, row := range tbl.Data {
			f := byName[row.Name]
			if f == nil {
				t.Fatalf("unexpected row %+v", row)
			}
			if row.ID != f.id || row.Slug != f.slug || row.Status != f.status || row.Category.ID != sh.cat.cats[f.cat] ||
				row.Stock != f.stock || row.VariantCount != f.variantCount || row.LowStock != f.lowStock || row.ThumbnailURL != nil {
				t.Errorf("row %s = %+v, want %+v", row.Name, row, *f)
			}
			switch {
			case f.priceFrom == 0 && row.PriceFrom != nil:
				t.Errorf("%s: price_from %+v, want null", row.Name, row.PriceFrom)
			case f.priceFrom != 0 && (row.PriceFrom == nil || *row.PriceFrom != moneyOf(f.priceFrom)):
				t.Errorf("%s: price_from %+v, want %d", row.Name, row.PriceFrom, f.priceFrom)
			}
		}
	})

	t.Run("sorts", func(t *testing.T) {
		byNameAsc := func(a, b *tableFixture) int { return strings.Compare(a.name, b.name) }
		// Products without a price come last in both directions.
		priceThenNull := func(desc bool) func(a, b *tableFixture) int {
			return func(a, b *tableFixture) int {
				switch {
				case a.priceFrom == 0 || b.priceFrom == 0:
					return nullsLast(a, b)
				case desc:
					return cmp.Compare(b.priceFrom, a.priceFrom)
				default:
					return cmp.Compare(a.priceFrom, b.priceFrom)
				}
			}
		}
		tests := []struct {
			query string
			want  []string
		}{
			{"sort=name&order=asc", names(nil, byNameAsc)},
			{"sort=name&order=desc", names(nil, func(a, b *tableFixture) int { return -byNameAsc(a, b) })},
			{"sort=price_from&order=asc", names(nil, priceThenNull(false))},
			{"sort=price_from&order=desc", names(nil, priceThenNull(true))},
			{"sort=stock&order=desc", names(nil, func(a, b *tableFixture) int { return cmp.Compare(b.stock, a.stock) })},
			{"sort=stock&order=asc", names(nil, func(a, b *tableFixture) int { return cmp.Compare(a.stock, b.stock) })},
			// Created one after another: created_at is the fixture order.
			{"sort=created_at&order=asc", names(nil, nil)},
			{"sort=created_at&order=desc", reversed(names(nil, nil))},
		}
		for _, tc := range tests {
			if got := tableNames(get(t, tc.query)); !slices.Equal(got, tc.want) {
				t.Errorf("?%s:\n got %v\nwant %v", tc.query, got, tc.want)
			}
		}
		// The default is updated_at, newest first, ties broken by id in
		// the same direction: exactly what the database says.
		want := queryStrings(t, sh.db, `SELECT name FROM products ORDER BY updated_at DESC, id DESC`)
		if got := tableNames(get(t, "")); !slices.Equal(got, want) {
			t.Errorf("default order:\n got %v\nwant %v", got, want)
		}
	})

	t.Run("pages", func(t *testing.T) {
		all := names(nil, func(a, b *tableFixture) int { return strings.Compare(a.name, b.name) })
		for page := 1; page <= 4; page++ {
			tbl := get(t, "sort=name&order=asc&per_page=2&page="+strconv.Itoa(page))
			var want []string
			if page <= 3 {
				want = all[(page-1)*2 : page*2]
			}
			if got := tableNames(tbl); !slices.Equal(got, want) {
				t.Errorf("page %d = %v, want %v", page, got, want)
			}
			// Past the last page: empty data, the real total.
			if tbl.Page != (tablePageOut{Page: page, PerPage: 2, Total: 6, TotalPages: 3}) {
				t.Errorf("page %d info = %+v", page, tbl.Page)
			}
		}
		if tbl := get(t, "page=10000&per_page=100"); len(tbl.Data) != 0 || tbl.Page.Total != 6 {
			t.Errorf("the last allowed page = %+v", tbl)
		}
	})

	t.Run("filters", func(t *testing.T) {
		is := func(names ...string) func(*tableFixture) bool {
			return func(f *tableFixture) bool { return slices.Contains(names, f.name) }
		}
		sorted := func(keep func(*tableFixture) bool) []string {
			return names(keep, func(a, b *tableFixture) int { return strings.Compare(a.name, b.name) })
		}
		tests := []struct {
			query string
			want  []string
		}{
			{"status=draft", sorted(func(f *tableFixture) bool { return f.status == "draft" })},
			{"status=archived", []string{"Delta Kaos"}},
			{"status=active", sorted(func(f *tableFixture) bool { return f.status == "active" })},
			// A parent category takes its children.
			{"category_id=" + sh.cat.cats["pakaian"], sorted(func(f *tableFixture) bool { return f.cat != "ponsel" })},
			{"category_id=" + sh.cat.cats["kaos"], sorted(is("Alpha Kaos", "Delta Kaos", "Diskon 50% Kaos"))},
			{"category_id=" + uuidx.NewV7(), nil},
			{"low_stock=true", sorted(func(f *tableFixture) bool { return f.lowStock })},
			{"low_stock=false", sorted(nil)},
			// Name, any case, anywhere.
			{"q=KAOS", sorted(is("Alpha Kaos", "Delta Kaos", "Diskon 50% Kaos"))},
			// A SKU, of an archived variant too.
			{"q=tc-old", []string{"Charlie Ponsel"}},
			{"q=" + url.QueryEscape("tb-b2"), []string{"Bravo Kemeja"}},
			{"q=" + url.QueryEscape("50%"), []string{"Diskon 50% Kaos"}},
			{"q=_", nil},
			{"q=" + url.QueryEscape("   "), sorted(nil)},
			{"q=" + url.QueryEscape("  alpha "), []string{"Alpha Kaos"}},
			// Filters combine.
			{"q=kaos&low_stock=true", []string{"Delta Kaos"}},
			{"category_id=" + sh.cat.cats["pakaian"] + "&status=draft&low_stock=true", []string{"Bravo Kemeja"}},
		}
		for _, tc := range tests {
			tbl := get(t, "sort=name&order=asc&"+tc.query)
			if got := tableNames(tbl); !slices.Equal(got, tc.want) {
				t.Errorf("?%s:\n got %v\nwant %v", tc.query, got, tc.want)
			}
			if tbl.Page.Total != int64(len(tc.want)) {
				t.Errorf("?%s: total %d, want %d", tc.query, tbl.Page.Total, len(tc.want))
			}
		}
	})

	t.Run("bad queries", func(t *testing.T) {
		for _, q := range []string{
			"page=0", "page=10001", "page=x", "per_page=0", "per_page=101", "sort=harga", "order=naik",
			"status=dihapus", "category_id=bukan-uuid", "low_stock=mungkin",
			"q=" + strings.Repeat("a", 101), "q=a%00b",
		} {
			assertError(t, sh.staffCall(t, http.MethodGet, "/v1/admin/products?"+q, nil), http.StatusBadRequest, "VALIDATION_FAILED")
		}
		// 100 characters is still a search.
		get(t, "q="+strings.Repeat("a", 100))
	})

	t.Run("access", func(t *testing.T) {
		assertError(t, sh.call(t, http.MethodGet, "/v1/admin/products", nil, ""), http.StatusUnauthorized, "UNAUTHORIZED")
		_, buyer := sh.newAccount(t, "tabel-pembeli")
		assertError(t, sh.call(t, http.MethodGet, "/v1/admin/products", nil, buyer.AccessToken), http.StatusForbidden, "FORBIDDEN")
		seller := sh.accountWithRole(t, user.RoleSeller).AccessToken
		if tbl := assertTable(t, sh.call(t, http.MethodGet, "/v1/admin/products", nil, seller), "seller"); tbl.Page.Total != 6 {
			t.Errorf("the seller sees %d products, want 6", tbl.Page.Total)
		}
	})
	assertNoErrorLog(t, sh.server)
}

// nullsLast is the price sort's rule for products without a price: after
// every product with one, whatever the direction.
func nullsLast(a, b *tableFixture) int {
	switch {
	case a.priceFrom == 0 && b.priceFrom == 0:
		return 0
	case a.priceFrom == 0:
		return 1
	default:
		return -1
	}
}

// reversed is a reversed copy of s.
func reversed(s []string) []string {
	out := slices.Clone(s)
	slices.Reverse(out)
	return out
}
