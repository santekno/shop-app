package product

// Bab 14 artikel-12: PostgresRepository.ListActiveByIDs, which the wishlist
// uses to turn a page of product ids into storefront products (on the fake
// SQL driver; the SQL itself runs against PostgreSQL in tests/integration).

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

func TestPostgresRepository_ListActiveByIDs(t *testing.T) {
	t.Run("groups the rows, attaches the ready images, asks once for each", func(t *testing.T) {
		db := newFakeSQL().
			on("ListActiveProductsByIDs", listRows()).
			on("ListProductImages", mixedImages())

		got, err := NewPostgresRepository(db.open(t)).ListActiveByIDs(context.Background(), []string{readProductA, readProductB})

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 2)
		testx.AssertEqual(t, got[0].ID, readProductA)
		testx.AssertEqual(t, len(got[0].Variants), 2)
		testx.AssertEqual(t, got[1].ID, readProductB)
		testx.AssertEqual(t, imageIDs(got[0].Images), "img-a0,img-a3", "ready images only")
		testx.AssertEqual(t, len(db.calledAll("ListActiveProductsByIDs")), 1)
		testx.AssertEqual(t, len(db.calledAll("ListProductImages")), 1)
		call, _ := db.call("ListActiveProductsByIDs")
		arg, _ := call.args[0].(string)
		testx.AssertContains(t, arg, readProductA)
		testx.AssertContains(t, arg, readProductB)
		assertSQL(t, db, "ListActiveProductsByIDs", "p.status = 'active'", "v.archived_at IS NULL")
	})
	t.Run("no ids asks nothing", func(t *testing.T) {
		db := newFakeSQL()

		got, err := NewPostgresRepository(db.open(t)).ListActiveByIDs(context.Background(), nil)

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 0)
		testx.AssertEqual(t, len(db.names()), 0, "no statement ran")
	})
	t.Run("ids of no active product give no products and no image query", func(t *testing.T) {
		db := newFakeSQL()

		got, err := NewPostgresRepository(db.open(t)).ListActiveByIDs(context.Background(), []string{readProductA})

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 0)
		testx.AssertFalse(t, db.ran("ListProductImages"))
	})
	t.Run("the products query fails", func(t *testing.T) {
		db := newFakeSQL().on("ListActiveProductsByIDs", failWith(errBoom))

		got, err := NewPostgresRepository(db.open(t)).ListActiveByIDs(context.Background(), []string{readProductA})

		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "query products by id: boom")
		testx.AssertTrue(t, got == nil)
		testx.AssertFalse(t, db.ran("ListProductImages"))
	})
	t.Run("the images query fails", func(t *testing.T) {
		db := newFakeSQL().on("ListActiveProductsByIDs", listRows()).on("ListProductImages", failWith(errBoom))

		got, err := NewPostgresRepository(db.open(t)).ListActiveByIDs(context.Background(), []string{readProductA})

		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query images"), "err = %v", err)
		testx.AssertTrue(t, got == nil)
	})
}
