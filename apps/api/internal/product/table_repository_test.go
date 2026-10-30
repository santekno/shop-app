package product

// Bab 12 artikel-02: PostgresRepository.ListTable on the fake SQL driver
// (fakesql_test.go). The SQL itself runs against PostgreSQL in
// tests/integration.

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

var tableSaved = time.Date(2026, 10, 30, 1, 2, 3, 0, time.UTC)

// adminRow is one ListAdminProducts row, in the query's column order.
// priceFrom nil is a product without a sellable variant.
func adminRow(id, name string, priceFrom driver.Value, stock, variants int64, low bool) []driver.Value {
	return []driver.Value{
		id, "slug-" + id, name, StatusActive, priceFrom, tableSaved, tableSaved.Add(time.Hour),
		catIDForTable, "Kaos", stock, variants, low,
	}
}

const (
	tableA = "0190c8a0-0000-7000-8000-0000000000a1"
	tableB = "0190c8a0-0000-7000-8000-0000000000a2"
	tableC = "0190c8a0-0000-7000-8000-0000000000a3"
)

func TestPostgresRepository_ListTable(t *testing.T) {
	db := newFakeSQL().
		on("CountAdminProducts", rows(int64(23))).
		on("ListAdminProducts", fakeAnswer{rows: [][]driver.Value{
			adminRow(tableA, "Kaos A", int64(89000), 12, 3, false),
			adminRow(tableB, "Kaos B", nil, 0, 0, false),
			adminRow(tableC, "Kaos C", int64(1000), 2, 1, true),
		}}).
		on("ListProductImages", fakeAnswer{rows: [][]driver.Value{
			// A: a photo still processing comes first, then a ready one;
			// the ready one's narrowest copy is the thumbnail.
			imageRow(imgID, tableA, ImageProcessing, 0, `[{"width":400,"height":300,"key":"processing400"}]`),
			imageRow(imgID2, tableA, ImageReady, 1, twoVariants),
			// B: ready but without copies yet: no thumbnail, and no panic.
			imageRow(imgID3, tableB, ImageReady, 0, "[]"),
		}})
	q := TableQuery{
		Search: "%kaos%", Status: StatusActive, CategoryID: catIDForTable, LowStock: true,
		Sort: TableSortPriceFrom, Descending: true, Offset: 20, Limit: 20,
	}
	got, total, err := NewPostgresRepository(db.open(t)).ListTable(context.Background(), q)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, total, int64(23))
	testx.AssertEqual(t, len(got), 3)
	assertSame(t, db.names(), []string{"CountAdminProducts", "ListAdminProducts", "ListProductImages"})

	count, _ := db.call("CountAdminProducts")
	assertSame(t, count.args, []driver.Value{int64(LowStockThreshold), "active", catIDForTable, "%kaos%", true})
	list, _ := db.call("ListAdminProducts")
	assertSame(t, list.args, []driver.Value{
		int64(LowStockThreshold), "active", catIDForTable, "%kaos%", true, "price_from", true, int64(20), int64(20),
	})

	a := got[0]
	testx.AssertEqual(t, a.ID, tableA)
	testx.AssertEqual(t, a.Slug, "slug-"+tableA)
	testx.AssertEqual(t, a.Name, "Kaos A")
	testx.AssertEqual(t, a.Status, StatusActive)
	testx.AssertEqual(t, a.CategoryID, catIDForTable)
	testx.AssertEqual(t, a.CategoryName, "Kaos")
	testx.AssertEqual(t, *a.PriceFrom, int64(89000))
	testx.AssertEqual(t, a.Stock, int64(12))
	testx.AssertEqual(t, a.VariantCount, int32(3))
	testx.AssertFalse(t, a.LowStock)
	testx.AssertEqual(t, a.CreatedAt, tableSaved)
	testx.AssertEqual(t, a.UpdatedAt, tableSaved.Add(time.Hour))
	if a.Thumbnail == nil {
		t.Fatal("A: want the ready photo's thumbnail")
	}
	testx.AssertEqual(t, *a.Thumbnail, ImageVariant{Width: 400, Height: 300, Key: "k400"})

	b := got[1]
	testx.AssertTrue(t, b.PriceFrom == nil, "no sellable variant: no price")
	testx.AssertTrue(t, b.Thumbnail == nil, "a ready photo without copies has no thumbnail")

	c := got[2]
	testx.AssertTrue(t, c.LowStock)
	testx.AssertTrue(t, c.Thumbnail == nil, "no photo")

	images, _ := db.call("ListProductImages")
	testx.AssertEqual(t, len(images.args), 1, "one images query for the whole page")
	testx.AssertEqual(t, images.args[0], driver.Value(`{"`+tableA+`","`+tableB+`","`+tableC+`"}`), "the page's ids, in order")
}

// No filter is NULL, not an empty string: the SQL's "IS NULL" means "any".
func TestPostgresRepository_ListTableWithoutFilters(t *testing.T) {
	db := newFakeSQL().
		on("CountAdminProducts", rows(int64(1))).
		on("ListAdminProducts", rows(adminRow(tableA, "Kaos A", int64(1), 1, 1, true)...))
	got, total, err := NewPostgresRepository(db.open(t)).ListTable(context.Background(),
		TableQuery{Sort: TableSortUpdatedAt, Limit: 20})

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, total, int64(1))
	testx.AssertEqual(t, len(got), 1)
	count, _ := db.call("CountAdminProducts")
	assertSame(t, count.args, []driver.Value{int64(LowStockThreshold), nil, nil, nil, false})
	list, _ := db.call("ListAdminProducts")
	assertSame(t, list.args, []driver.Value{
		int64(LowStockThreshold), nil, nil, nil, false, "updated_at", false, int64(0), int64(20),
	})
}

// No match, or a page past the end, needs no second query; the rows are
// [] and the total stays real, so the client can jump back.
func TestPostgresRepository_ListTableNothingToRead(t *testing.T) {
	tests := []struct {
		name   string
		total  int64
		offset int
	}{
		{name: "no match", total: 0, offset: 0},
		{name: "offset at the total", total: 40, offset: 40},
		{name: "offset past the total", total: 40, offset: 60},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on("CountAdminProducts", rows(tt.total))
			got, total, err := NewPostgresRepository(db.open(t)).ListTable(context.Background(),
				TableQuery{Sort: TableSortName, Offset: tt.offset, Limit: 20})
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, total, tt.total)
			testx.AssertTrue(t, got != nil, "[] rather than nil")
			testx.AssertEqual(t, len(got), 0)
			assertSame(t, db.names(), []string{"CountAdminProducts"})
		})
	}
	t.Run("the last row of the last page is read", func(t *testing.T) {
		db := newFakeSQL().
			on("CountAdminProducts", rows(int64(41))).
			on("ListAdminProducts", rows(adminRow(tableA, "Kaos A", int64(1), 1, 1, false)...))
		got, _, err := NewPostgresRepository(db.open(t)).ListTable(context.Background(),
			TableQuery{Sort: TableSortName, Offset: 40, Limit: 20})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 1)
	})
}

func TestPostgresRepository_ListTableErrors(t *testing.T) {
	boom := errors.New("connection refused")
	tests := []struct {
		name    string
		db      *fakeSQL
		wantErr string
	}{
		{name: "count", db: newFakeSQL().on("CountAdminProducts", failWith(boom)), wantErr: "count products: connection refused"},
		{name: "rows", db: newFakeSQL().
			on("CountAdminProducts", rows(int64(3))).
			on("ListAdminProducts", failWith(boom)), wantErr: "query products: connection refused"},
		{name: "images", db: newFakeSQL().
			on("CountAdminProducts", rows(int64(3))).
			on("ListAdminProducts", rows(adminRow(tableA, "Kaos A", int64(1), 1, 1, false)...)).
			on("ListProductImages", failWith(boom)), wantErr: "query images: connection refused"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, total, err := NewPostgresRepository(tt.db.open(t)).ListTable(context.Background(),
				TableQuery{Sort: TableSortName, Limit: 20})
			testx.AssertTrue(t, errors.Is(err, boom), "wrapped: %v", err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertTrue(t, got == nil, "no rows on error")
			testx.AssertEqual(t, total, int64(0))
		})
	}
}

// assertSame compares two slices by their printed form, which is also
// what a failure shows.
func assertSame[T any](t *testing.T, got, want []T) {
	t.Helper()
	testx.AssertEqual(t, fmt.Sprintf("%#v", got), fmt.Sprintf("%#v", want))
}
