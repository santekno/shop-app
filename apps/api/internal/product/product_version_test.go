package product

// Bab 12 artikel-05: the product's own optimistic-lock version and the
// VARIANT_ARCHIVED answer, on the fake SQL driver.

import (
	"context"
	"database/sql/driver"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// A save whose product version is stale is refused before anything is
// locked or written, so a variant another admin added is never archived.
func TestPostgresRepository_UpdateStaleProduct(t *testing.T) {
	for _, current := range []int64{5, 3, 0} {
		t.Run("current version "+strconv.FormatInt(current, 10), func(t *testing.T) {
			db := newFakeSQL().on("LockProduct", rows(current))
			err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput()) // loaded at 4

			var stale *StaleProductError
			if !errors.As(err, &stale) {
				t.Fatalf("want *StaleProductError, got %v", err)
			}
			testx.AssertEqual(t, stale.ProductID, vpProductID)
			testx.AssertTrue(t, errors.Is(err, ErrVersionConflict))
			var variantConflict *VersionConflictError
			testx.AssertFalse(t, errors.As(err, &variantConflict), "not a variant's conflict")
			testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockProduct,ROLLBACK")
			lock, _ := db.call("LockProduct")
			assertArgs(t, lock.args, []driver.Value{vpProductID})
		})
	}
}

// The save that goes through bumps the product's version in its last
// statement.
func TestPostgresRepository_UpdateBumpsTheProductVersion(t *testing.T) {
	db := lockedProduct()
	testx.AssertNoError(t, NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput()))
	assertSQL(t, db, "LockProduct", "SELECT version", "FOR UPDATE")
	assertSQL(t, db, "UpdateProduct", ", version = version + 1, updated_at = now()")
}

func TestPostgresRepository_Archive(t *testing.T) {
	t.Run("archived, version bumped", func(t *testing.T) {
		db := newFakeSQL()
		testx.AssertNoError(t, NewPostgresRepository(db.open(t)).Archive(context.Background(), vpProductID))
		assertSQL(t, db, "ArchiveProduct", "status = 'archived'", "version = version + 1")
		call, _ := db.call("ArchiveProduct")
		assertArgs(t, call.args, []driver.Value{vpProductID})
	})
	t.Run("no such product", func(t *testing.T) {
		db := newFakeSQL().on("ArchiveProduct", fakeAnswer{affected: 0})
		err := NewPostgresRepository(db.open(t)).Archive(context.Background(), vpProductID)
		testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
	})
	t.Run("the database fails", func(t *testing.T) {
		db := newFakeSQL().on("ArchiveProduct", failWith(errBoom))
		err := NewPostgresRepository(db.open(t)).Archive(context.Background(), vpProductID)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "archive product: boom")
	})
}

// A variant id the save cannot write: archived since the form loaded it
// (409 VARIANT_ARCHIVED) or none of the product's (400).
func TestPostgresRepository_UpdateNotSellableVariant(t *testing.T) {
	// The first variant's UPDATE matches no row, and neither does its
	// version query: the variant is not sellable.
	notSellableDB := func() *fakeSQL {
		return lockedProduct().on("UpdateVariant", fakeAnswer{affected: 0})
	}
	t.Run("archived", func(t *testing.T) {
		db := notSellableDB().on("IsVariantArchived", rows(true))
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		var archived *VariantArchivedError
		if !errors.As(err, &archived) {
			t.Fatalf("want *VariantArchivedError, got %v", err)
		}
		testx.AssertEqual(t, archived.VariantID, vpVariantA)
		testx.AssertTrue(t, errors.Is(err, ErrVariantArchived))
		testx.AssertFalse(t, errors.Is(err, ErrUnknownVariant))
		check, _ := db.call("IsVariantArchived")
		assertArgs(t, check.args, []driver.Value{vpVariantA, vpProductID})
		assertSQL(t, db, "IsVariantArchived", "archived_at IS NOT NULL")
		testx.AssertTrue(t, db.ran("ROLLBACK"))
		testx.AssertFalse(t, db.ran("UpdateProduct"))
	})
	t.Run("not archived: none of the product's", func(t *testing.T) {
		db := notSellableDB().on("IsVariantArchived", rows(false))
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		testx.AssertTrue(t, errors.Is(err, ErrUnknownVariant), "err = %v", err)
		testx.AssertFalse(t, errors.Is(err, ErrVariantArchived))
	})
	t.Run("no row", func(t *testing.T) {
		db := notSellableDB()
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		testx.AssertTrue(t, errors.Is(err, ErrUnknownVariant), "err = %v", err)
		testx.AssertTrue(t, db.ran("IsVariantArchived"))
	})
	t.Run("the query fails", func(t *testing.T) {
		db := notSellableDB().on("IsVariantArchived", failWith(errBoom))
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "query archived variant: boom")
		testx.AssertFalse(t, errors.Is(err, ErrUnknownVariant))
	})
	t.Run("a variant with a stale version is still a version conflict", func(t *testing.T) {
		db := notSellableDB().on("GetVariantVersion", rows(int64(8)))
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		var conflict *VersionConflictError
		testx.AssertTrue(t, errors.As(err, &conflict), "err = %v", err)
		testx.AssertFalse(t, db.ran("IsVariantArchived"), "only asked when no sellable variant matched")
	})
}

func TestProductErrors(t *testing.T) {
	stale := &StaleProductError{ProductID: vpProductID}
	testx.AssertEqual(t, stale.Error(), "product "+vpProductID+": version conflict")
	testx.AssertEqual(t, stale.Unwrap(), ErrVersionConflict)

	archived := &VariantArchivedError{VariantID: vpVariantA}
	testx.AssertEqual(t, archived.Error(), "variant "+vpVariantA+": archived")
	testx.AssertEqual(t, archived.Unwrap(), ErrVariantArchived)
}
