package product

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

const (
	vpProductID = "0190c8a0-0000-7000-8000-000000000001"
	vpVariantA  = "0190c8a0-0000-7000-9000-00000000000a"
	vpVariantB  = "0190c8a0-0000-7000-9000-00000000000b"
)

var errBoom = errors.New("boom")

// versionInput saves two existing variants, loaded at versions 3 and 7.
func versionInput() Input {
	return Input{
		CategoryID: "0190c8a0-0000-7000-8000-0000000000c1", Slug: "kaos", Name: "Kaos", Status: StatusActive,
		Variants: []VariantInput{
			{ID: vpVariantA, Version: 3, SKU: "KPH-S", Name: "S", Price: 89000, Stock: 4, WeightGrams: 180},
			{ID: vpVariantB, Version: 7, SKU: "KPH-M", Name: "M", Price: 89000, Stock: 2, WeightGrams: 190},
		},
	}
}

func lockedProduct() *fakeSQL { return newFakeSQL().on("LockProduct", rows(vpProductID)) }

func TestPostgresRepository_UpdateChecksTheVersion(t *testing.T) {
	db := lockedProduct()
	err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
	testx.AssertNoError(t, err)
	assertLockedFirst(t, db, "LockProduct")
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,LockProduct,LockProductVariants,ArchiveVariantsNotIn,UpdateVariant,UpdateVariant,UpdateProduct,COMMIT")
	// Every variant of the product is locked, in id order (the SQL's ORDER
	// BY), before any is written in the form's order.
	// FOR UPDATE: a save may change a SKU (a unique key), so the strongest
	// lock is taken now, in id order, never upgraded later out of turn.
	assertSQL(t, db, "LockProductVariants", "WHERE product_id = $1 ORDER BY id FOR UPDATE")
	assertSQL(t, db, "UpdateVariant", "version = version + 1", "AND version = $9")
	lockAll, _ := db.call("LockProductVariants")
	assertArgs(t, lockAll.args, []driver.Value{vpProductID})
	updates := db.calledAll("UpdateVariant")
	assertArgs(t, updates[0].args, []driver.Value{"KPH-S", "S", int64(89000), int64(4), int64(180), int64(0), vpVariantA, vpProductID, int64(3)},
		"the version the form loaded is the UPDATE's condition")
	testx.AssertEqual(t, updates[1].args[8], driver.Value(int64(7)))
	testx.AssertFalse(t, db.ran("GetVariantVersion"), "no second query when the version matched")
}

func TestPostgresRepository_UpdateVersionConflict(t *testing.T) {
	t.Run("a stale version is a conflict naming the variant", func(t *testing.T) {
		db := lockedProduct().
			on("UpdateVariant", fakeAnswer{affected: 1}).
			on("UpdateVariant", fakeAnswer{affected: 0}).
			on("GetVariantVersion", rows(int64(8)))
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		var conflict *VersionConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("want *VersionConflictError, got %v", err)
		}
		testx.AssertEqual(t, conflict.VariantID, vpVariantB)
		testx.AssertTrue(t, errors.Is(err, ErrVersionConflict))
		testx.AssertFalse(t, errors.Is(err, ErrUnknownVariant))
		check, _ := db.call("GetVariantVersion")
		assertArgs(t, check.args, []driver.Value{vpVariantB, vpProductID})
		testx.AssertTrue(t, db.ran("ROLLBACK"), "the first variant's update is rolled back too")
		testx.AssertFalse(t, db.ran("COMMIT"))
		testx.AssertFalse(t, db.ran("UpdateProduct"))
	})
	t.Run("no row: not a sellable variant of this product", func(t *testing.T) {
		db := lockedProduct().on("UpdateVariant", fakeAnswer{affected: 0})
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		testx.AssertTrue(t, errors.Is(err, ErrUnknownVariant), "err = %v", err)
		testx.AssertFalse(t, errors.Is(err, ErrVersionConflict))
		testx.AssertEqual(t, len(db.calledAll("UpdateVariant")), 1, "the save stops at the first bad variant")
	})
	t.Run("the version query fails", func(t *testing.T) {
		db := lockedProduct().on("UpdateVariant", fakeAnswer{affected: 0}).on("GetVariantVersion", failWith(errBoom))
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "query variant version: boom")
	})
	t.Run("a new variant has no version to check", func(t *testing.T) {
		in := versionInput()
		in.Variants = append(in.Variants, VariantInput{SKU: "KPH-L", Name: "L", Price: 89000, Stock: 1, WeightGrams: 200})
		db := lockedProduct()
		err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, in)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(db.calledAll("InsertVariant")), 1)
		testx.AssertEqual(t, len(db.calledAll("UpdateVariant")), 2)
	})
}

func TestPostgresRepository_UpdateLockErrors(t *testing.T) {
	tests := []struct {
		db   *fakeSQL
		want string
	}{
		{db: newFakeSQL().on("LockProduct", failWith(errBoom)), want: "lock product: boom"},
		{db: lockedProduct().on("LockProductVariants", failWith(errBoom)), want: "lock variants: boom"},
	}
	for _, tt := range tests {
		err := NewPostgresRepository(tt.db.open(t)).Update(context.Background(), vpProductID, versionInput())
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), tt.want)
		testx.AssertFalse(t, tt.db.ran("UpdateVariant"), "nothing is written without the locks")
		testx.AssertTrue(t, tt.db.ran("ROLLBACK"))
	}
	db := newFakeSQL()
	err := NewPostgresRepository(db.open(t)).Update(context.Background(), vpProductID, versionInput())
	testx.AssertTrue(t, errors.Is(err, ErrNotFound), "an unknown product: %v", err)
	testx.AssertFalse(t, db.ran("LockProductVariants"))
}

func TestVersionConflictError(t *testing.T) {
	err := &VersionConflictError{VariantID: vpVariantA}
	testx.AssertEqual(t, err.Error(), "variant "+vpVariantA+": version conflict")
	testx.AssertTrue(t, errors.Is(err, ErrVersionConflict))
	testx.AssertEqual(t, err.Unwrap(), ErrVersionConflict)
}
