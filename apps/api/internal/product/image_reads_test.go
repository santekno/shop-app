package product

// Bab 6 artikel-05: the product reads carry their images, one query per
// page; the storefront keeps the ready ones, the admin sees all.

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

const (
	readProductA = "0190c8a0-0000-7000-8000-0000000000d1"
	readProductB = "0190c8a0-0000-7000-8000-0000000000d2"
)

// storefrontRow is one row of the storefront reads (productRow's columns;
// created_at and updated_at both imgCreated).
func storefrontRow(productID, variantID string, price int64) []driver.Value {
	return []driver.Value{
		productID, "slug-" + productID, "Name", "Desc", price, imgCreated, imgCreated,
		"cat-1", "kaos", "Kaos", nil,
		variantID, "SKU-" + variantID, "V", price, int64(3),
	}
}

func listRows() fakeAnswer {
	return fakeAnswer{rows: [][]driver.Value{
		storefrontRow(readProductA, "va1", 1000),
		storefrontRow(readProductA, "va2", 2000),
		storefrontRow(readProductB, "vb1", 3000),
	}}
}

// mixedImages are images of both products in every status.
func mixedImages() fakeAnswer {
	return fakeAnswer{rows: [][]driver.Value{
		imageRow("img-a0", readProductA, ImageReady, 0, twoVariants),
		imageRow("img-a1", readProductA, ImageProcessing, 1, "[]"),
		imageRow("img-a2", readProductA, ImagePendingUpload, 2, "[]"),
		imageRow("img-a3", readProductA, ImageReady, 3, twoVariants),
		imageRow("img-b0", readProductB, ImageFailed, 0, "[]"),
	}}
}

func imageIDs(images []Image) string {
	ids := make([]string, 0, len(images))
	for _, img := range images {
		ids = append(ids, img.ID)
	}
	return strings.Join(ids, ",")
}

func TestPostgresRepository_List_AttachesReadyImages(t *testing.T) {
	for _, sort := range []Sort{SortNewest, SortPriceAsc, SortPriceDesc} {
		t.Run(string(sort), func(t *testing.T) {
			db := newFakeSQL().
				on("ListProductsNewest", listRows()).
				on("ListProductsPriceAsc", listRows()).
				on("ListProductsPriceDesc", listRows()).
				on("ListProductImages", mixedImages())

			got, err := NewPostgresRepository(db.open(t)).List(context.Background(), ListQuery{Sort: sort, Limit: 21})

			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(got), 2)
			testx.AssertEqual(t, len(got[0].Variants), 2)
			testx.AssertEqual(t, imageIDs(got[0].Images), "img-a0,img-a3", "ready images only, in order")
			testx.AssertEqual(t, len(got[1].Images), 0, "a failed image is not shown")
			testx.AssertEqual(t, len(db.calledAll("ListProductImages")), 1, "one query for the whole page")
			call, _ := db.call("ListProductImages")
			arg, _ := call.args[0].(string)
			testx.AssertContains(t, arg, readProductA)
			testx.AssertContains(t, arg, readProductB)
		})
	}
}

func TestPostgresRepository_List_Errors(t *testing.T) {
	for _, tt := range []struct {
		sort  Sort
		query string
	}{{SortNewest, "ListProductsNewest"}, {SortPriceAsc, "ListProductsPriceAsc"}, {SortPriceDesc, "ListProductsPriceDesc"}} {
		db := newFakeSQL().on(tt.query, failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).List(context.Background(), ListQuery{Sort: tt.sort, Limit: 21})
		testx.AssertTrue(t, errors.Is(err, errBoom), "%s: %v", tt.sort, err)
		testx.AssertEqual(t, err.Error(), "query products: boom")
		testx.AssertFalse(t, db.ran("ListProductImages"))
	}

	t.Run("an empty page asks for no images", func(t *testing.T) {
		db := newFakeSQL()
		got, err := NewPostgresRepository(db.open(t)).List(context.Background(), ListQuery{Sort: SortNewest, Limit: 21})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 0)
		testx.AssertFalse(t, db.ran("ListProductImages"))
	})
	t.Run("the images query fails", func(t *testing.T) {
		db := newFakeSQL().on("ListProductsNewest", listRows()).on("ListProductImages", failWith(errBoom))
		got, err := NewPostgresRepository(db.open(t)).List(context.Background(), ListQuery{Sort: SortNewest, Limit: 21})
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "query images: boom")
		testx.AssertTrue(t, got == nil)
	})
}

func TestPostgresRepository_GetBySlug_AttachesReadyImages(t *testing.T) {
	db := newFakeSQL().
		on("GetActiveProductBySlug", fakeAnswer{rows: [][]driver.Value{storefrontRow(readProductA, "va1", 1000)}}).
		on("ListProductImages", mixedImages())

	got, err := NewPostgresRepository(db.open(t)).GetBySlug(context.Background(), "slug-a")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.ID, readProductA)
	testx.AssertEqual(t, imageIDs(got.Images), "img-a0,img-a3")
	call, _ := db.call("GetActiveProductBySlug")
	assertArgs(t, call.args, []driver.Value{"slug-a"})
}

func TestPostgresRepository_GetBySlug_Errors(t *testing.T) {
	t.Run("no active product", func(t *testing.T) {
		db := newFakeSQL()
		_, err := NewPostgresRepository(db.open(t)).GetBySlug(context.Background(), "nope")
		testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
		testx.AssertFalse(t, db.ran("ListProductImages"))
	})
	t.Run("query fails", func(t *testing.T) {
		db := newFakeSQL().on("GetActiveProductBySlug", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).GetBySlug(context.Background(), "x")
		testx.AssertEqual(t, err.Error(), "query product: boom")
	})
	t.Run("the images query fails", func(t *testing.T) {
		db := newFakeSQL().
			on("GetActiveProductBySlug", fakeAnswer{rows: [][]driver.Value{storefrontRow(readProductA, "va1", 1000)}}).
			on("ListProductImages", failWith(errBoom))
		got, err := NewPostgresRepository(db.open(t)).GetBySlug(context.Background(), "x")
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, got.ID, "")
	})
}

func adminProductRow(price driver.Value) fakeAnswer {
	updated := imgCreated.Add(time.Hour)
	return rows(readProductA, "cat-1", "kaos", "Kaos", "Desc", StatusDraft, price, imgCreated, updated)
}

func TestPostgresRepository_GetAdmin_AttachesEveryImage(t *testing.T) {
	db := newFakeSQL().
		on("GetProduct", adminProductRow(int64(89000))).
		on("ListSellableVariants", fakeAnswer{rows: [][]driver.Value{
			{"v1", "KPH-S", "S", int64(89000), int64(4), int64(180), int64(3)},
		}}).
		on("ListProductImages", mixedImages())

	got, err := NewPostgresRepository(db.open(t)).GetAdmin(context.Background(), readProductA)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.ID, readProductA)
	testx.AssertEqual(t, got.Status, StatusDraft)
	testx.AssertTrue(t, got.PriceFrom != nil && *got.PriceFrom == 89000)
	testx.AssertEqual(t, len(got.Variants), 1)
	testx.AssertEqual(t, got.Variants[0], AdminVariant{ID: "v1", SKU: "KPH-S", Name: "S", Price: 89000, Stock: 4, WeightGrams: 180, Version: 3})
	testx.AssertEqual(t, imageIDs(got.Images), "img-a0,img-a1,img-a2,img-a3", "the admin sees pending and processing images too")
	call, _ := db.call("ListProductImages")
	arg, _ := call.args[0].(string)
	testx.AssertContains(t, arg, readProductA)
	testx.AssertTrue(t, got.UpdatedAt.Equal(imgCreated.Add(time.Hour)))
}

func TestPostgresRepository_GetAdmin_Errors(t *testing.T) {
	t.Run("no sellable variant: no price", func(t *testing.T) {
		db := newFakeSQL().on("GetProduct", adminProductRow(nil))
		got, err := NewPostgresRepository(db.open(t)).GetAdmin(context.Background(), readProductA)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, got.PriceFrom == nil)
		testx.AssertEqual(t, len(got.Variants), 0)
		testx.AssertEqual(t, len(got.Images), 0)
	})
	t.Run("unknown product", func(t *testing.T) {
		db := newFakeSQL()
		_, err := NewPostgresRepository(db.open(t)).GetAdmin(context.Background(), readProductA)
		testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
		testx.AssertFalse(t, db.ran("ListSellableVariants"))
	})
	tests := []struct {
		db   *fakeSQL
		want string
	}{
		{db: newFakeSQL().on("GetProduct", failWith(errBoom)), want: "query product: boom"},
		{db: newFakeSQL().on("GetProduct", adminProductRow(nil)).on("ListSellableVariants", failWith(errBoom)), want: "query variants: boom"},
		{db: newFakeSQL().on("GetProduct", adminProductRow(nil)).on("ListProductImages", failWith(errBoom)), want: "query images: boom"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got, err := NewPostgresRepository(tt.db.open(t)).GetAdmin(context.Background(), readProductA)
			testx.AssertTrue(t, errors.Is(err, errBoom))
			testx.AssertEqual(t, err.Error(), tt.want)
			testx.AssertEqual(t, got.ID, "")
		})
	}
}
