package product

// Bab 12 artikel-05: stock adjustments, StockService and
// PostgresRepository.ChangeStock (fake SQL driver). The handler is tested
// in stock_handler_test.go.

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// fakeStockRepo records each change and answers from its fields.
type fakeStockRepo struct {
	changes []StockChange
	ids     []string
	variant AdminVariant
	err     error
}

func (f *fakeStockRepo) ChangeStock(_ context.Context, productID, variantID string, c StockChange) (AdminVariant, error) {
	f.changes = append(f.changes, c)
	f.ids = append(f.ids, productID+"/"+variantID)
	return f.variant, f.err
}

func TestMaxVariantStock(t *testing.T) {
	testx.AssertEqual(t, MaxVariantStock, 1_000_000)
}

func TestStockService_Change(t *testing.T) {
	tests := []struct {
		name   string
		change StockChange
	}{
		{name: "received", change: StockChange{Delta: 20}},
		{name: "damaged", change: StockChange{Delta: -2}},
		{name: "the largest delta", change: StockChange{Delta: MaxVariantStock}},
		{name: "the largest negative delta", change: StockChange{Delta: -MaxVariantStock}},
		{name: "a count", change: StockChange{IsSet: true, Set: 15, Expected: 12}},
		{name: "a count of 0", change: StockChange{IsSet: true, Set: 0, Expected: 3}},
		{name: "a count of the max", change: StockChange{IsSet: true, Set: MaxVariantStock}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeStockRepo{variant: AdminVariant{ID: vpVariantA, Stock: 35}}
			v, err := NewStockService(repo).Change(context.Background(), vpProductID, vpVariantA, tt.change)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, v.Stock, int32(35))
			testx.AssertEqual(t, len(repo.changes), 1)
			testx.AssertEqual(t, repo.changes[0], tt.change)
			testx.AssertEqual(t, repo.ids[0], vpProductID+"/"+vpVariantA)
		})
	}
}

// Out-of-range changes never reach the repository.
func TestStockService_ChangeRefuses(t *testing.T) {
	tests := []struct {
		name    string
		change  StockChange
		wantErr string
	}{
		{name: "no change at all", change: StockChange{}, wantErr: "change stock: delta 0 out of range"},
		{name: "delta over the max", change: StockChange{Delta: MaxVariantStock + 1}, wantErr: "change stock: delta 1000001 out of range"},
		{name: "delta under the min", change: StockChange{Delta: -MaxVariantStock - 1}, wantErr: "change stock: delta -1000001 out of range"},
		{name: "negative count", change: StockChange{IsSet: true, Set: -1}, wantErr: "change stock: set -1 out of range"},
		{name: "count over the max", change: StockChange{IsSet: true, Set: MaxVariantStock + 1}, wantErr: "change stock: set 1000001 out of range"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeStockRepo{}
			v, err := NewStockService(repo).Change(context.Background(), vpProductID, vpVariantA, tt.change)
			testx.AssertError(t, err)
			testx.AssertEqual(t, err.Error(), tt.wantErr)
			testx.AssertEqual(t, len(repo.changes), 0, "the repository is not asked")
			testx.AssertEqual(t, v.ID, "")
		})
	}
}

func TestStockService_ChangeRepositoryError(t *testing.T) {
	cause := &StockError{Err: ErrStockOutOfRange, VariantID: vpVariantA, Stock: 3}
	repo := &fakeStockRepo{err: cause, variant: AdminVariant{ID: "partial"}}
	v, err := NewStockService(repo).Change(context.Background(), vpProductID, vpVariantA, StockChange{Delta: -5})
	testx.AssertTrue(t, errors.Is(err, ErrStockOutOfRange), "err = %v", err)
	var stockErr *StockError
	testx.AssertTrue(t, errors.As(err, &stockErr), "the *StockError survives the wrap")
	testx.AssertEqual(t, stockErr.Stock, int32(3))
	testx.AssertEqual(t, err.Error(), "change stock of variant "+vpVariantA+": variant "+vpVariantA+" (stock 3): stock out of range")
	testx.AssertEqual(t, v.ID, "", "no variant on error")
}

func TestStockError(t *testing.T) {
	err := &StockError{Err: ErrStockChanged, VariantID: vpVariantA, Stock: 7}
	testx.AssertEqual(t, err.Error(), "variant "+vpVariantA+" (stock 7): stock changed")
	testx.AssertEqual(t, err.Unwrap(), ErrStockChanged)
	testx.AssertTrue(t, errors.Is(err, ErrStockChanged))
	testx.AssertFalse(t, errors.Is(err, ErrStockOutOfRange))
}

// variantRow is a RETURNING row of AdjustVariantStock or SetVariantStock.
func variantRow(stock, version int64) fakeAnswer {
	return rows(vpVariantA, "KPH-S", "S", int64(89000), stock, int64(180), version)
}

func TestPostgresRepository_ChangeStockDelta(t *testing.T) {
	db := newFakeSQL().on("AdjustVariantStock", variantRow(24, 6))
	v, err := NewPostgresRepository(db.open(t)).ChangeStock(context.Background(), vpProductID, vpVariantA, StockChange{Delta: 20})

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, v, AdminVariant{ID: vpVariantA, SKU: "KPH-S", Name: "S", Price: 89000, Stock: 24, WeightGrams: 180, Version: 6})
	testx.AssertEqual(t, strings.Join(db.names(), ","), "AdjustVariantStock", "one statement, no transaction")
	call, _ := db.call("AdjustVariantStock")
	assertArgs(t, call.args, []driver.Value{int64(20), vpVariantA, vpProductID, int64(MaxVariantStock)})
	assertSQL(t, db, "AdjustVariantStock", "stock = stock + $1::integer", "version = version + 1",
		"archived_at IS NULL", "BETWEEN 0 AND $4::integer")
}

func TestPostgresRepository_ChangeStockSet(t *testing.T) {
	db := newFakeSQL().on("SetVariantStock", variantRow(15, 7))
	v, err := NewPostgresRepository(db.open(t)).ChangeStock(context.Background(), vpProductID, vpVariantA,
		StockChange{IsSet: true, Set: 15, Expected: 12})

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, v.Stock, int32(15))
	testx.AssertEqual(t, v.Version, int32(7))
	testx.AssertEqual(t, v.SKU, "KPH-S")
	testx.AssertEqual(t, strings.Join(db.names(), ","), "SetVariantStock")
	call, _ := db.call("SetVariantStock")
	assertArgs(t, call.args, []driver.Value{int64(15), vpVariantA, vpProductID, int64(12)})
	assertSQL(t, db, "SetVariantStock", "stock = $1::integer", "version = version + 1", "AND stock = $4::integer")
}

// When the UPDATE changes nothing, GetVariantStock says why.
func TestPostgresRepository_ChangeStockRefused(t *testing.T) {
	deltaChange := StockChange{Delta: -5}
	setChange := StockChange{IsSet: true, Set: 15, Expected: 12}
	tests := []struct {
		name   string
		change StockChange
		now    fakeAnswer // GetVariantStock's answer; zero: no row
		check  func(t *testing.T, err error)
	}{
		{name: "delta: not a variant of the product", change: deltaChange, check: func(t *testing.T, err error) {
			testx.AssertTrue(t, errors.Is(err, ErrVariantNotFound), "err = %v", err)
		}},
		{name: "set: not a variant of the product", change: setChange, check: func(t *testing.T, err error) {
			testx.AssertTrue(t, errors.Is(err, ErrVariantNotFound), "err = %v", err)
		}},
		{name: "delta: archived", change: deltaChange, now: rows(int64(3), true), check: func(t *testing.T, err error) {
			var archived *VariantArchivedError
			testx.AssertTrue(t, errors.As(err, &archived), "err = %v", err)
			testx.AssertEqual(t, archived.VariantID, vpVariantA)
		}},
		{name: "set: archived", change: setChange, now: rows(int64(12), true), check: func(t *testing.T, err error) {
			testx.AssertTrue(t, errors.Is(err, ErrVariantArchived), "err = %v", err)
		}},
		{name: "delta: out of range", change: deltaChange, now: rows(int64(3), false), check: func(t *testing.T, err error) {
			var stockErr *StockError
			testx.AssertTrue(t, errors.As(err, &stockErr), "err = %v", err)
			testx.AssertTrue(t, errors.Is(err, ErrStockOutOfRange))
			testx.AssertEqual(t, stockErr.VariantID, vpVariantA)
			testx.AssertEqual(t, stockErr.Stock, int32(3), "the stock read right after")
		}},
		{name: "set: the stock changed", change: setChange, now: rows(int64(10), false), check: func(t *testing.T, err error) {
			var stockErr *StockError
			testx.AssertTrue(t, errors.As(err, &stockErr), "err = %v", err)
			testx.AssertTrue(t, errors.Is(err, ErrStockChanged))
			testx.AssertFalse(t, errors.Is(err, ErrStockOutOfRange))
			testx.AssertEqual(t, stockErr.Stock, int32(10))
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL() // no answer: the UPDATE returns no row
			if tt.now.rows != nil {
				db.on("GetVariantStock", tt.now)
			}
			v, err := NewPostgresRepository(db.open(t)).ChangeStock(context.Background(), vpProductID, vpVariantA, tt.change)
			testx.AssertError(t, err)
			tt.check(t, err)
			testx.AssertEqual(t, v.ID, "")
			check, ok := db.call("GetVariantStock")
			testx.AssertTrue(t, ok, "GetVariantStock ran")
			assertArgs(t, check.args, []driver.Value{vpVariantA, vpProductID})
		})
	}
}

func TestPostgresRepository_ChangeStockErrors(t *testing.T) {
	tests := []struct {
		name    string
		db      *fakeSQL
		change  StockChange
		wantErr string
	}{
		{name: "delta update", db: newFakeSQL().on("AdjustVariantStock", failWith(errBoom)), change: StockChange{Delta: 1}, wantErr: "update stock: boom"},
		{name: "set update", db: newFakeSQL().on("SetVariantStock", failWith(errBoom)), change: StockChange{IsSet: true, Set: 1}, wantErr: "update stock: boom"},
		{name: "the read after", db: newFakeSQL().on("GetVariantStock", failWith(errBoom)), change: StockChange{Delta: 1}, wantErr: "query variant stock: boom"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewPostgresRepository(tt.db.open(t)).ChangeStock(context.Background(), vpProductID, vpVariantA, tt.change)
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertEqual(t, err.Error(), tt.wantErr)
		})
	}
}
