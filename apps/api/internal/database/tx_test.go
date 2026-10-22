package database

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

func TestWithTx_CommitsWhenFnSucceeds(t *testing.T) {
	fake := &fakeDB{}
	db := fake.open(t)
	ctx := context.Background()

	err := WithTx(ctx, db, func(q *sqlc.Queries) error {
		n, err := q.ArchiveProduct(ctx, "0190c8a0-0000-7000-8000-000000000001")
		if n != 1 {
			t.Errorf("ArchiveProduct affected %d rows, want the fake's 1", n)
		}
		return err
	})

	testx.AssertNoError(t, err)
	begins, commits, rollbacks := fake.counts()
	testx.AssertEqual(t, begins, 1)
	testx.AssertEqual(t, commits, 1)
	testx.AssertEqual(t, rollbacks, 0)
	execs := fake.recorded()
	testx.AssertEqual(t, len(execs), 1)
	if len(execs) == 1 {
		testx.AssertTrue(t, execs[0].inTx, "the queries fn gets run inside the transaction")
		testx.AssertContains(t, execs[0].query, "ArchiveProduct")
	}
}

func TestWithTx_RollsBackWhenFnFails(t *testing.T) {
	errSKUTaken := errors.New("sku already taken")
	tests := []struct {
		name        string
		rollbackErr error
		wantRBInErr bool // the rollback error is joined to fn's error
	}{
		{name: "rollback succeeds: fn's error as it is", rollbackErr: nil},
		{name: "rollback fails: both errors", rollbackErr: errors.New("conn reset"), wantRBInErr: true},
		{name: "already rolled back (ErrTxDone): fn's error only", rollbackErr: sql.ErrTxDone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeDB{rollbackErr: tt.rollbackErr}
			db := fake.open(t)

			err := WithTx(context.Background(), db, func(*sqlc.Queries) error { return errSKUTaken })

			testx.AssertTrue(t, errors.Is(err, errSKUTaken), "callers can still match fn's error: %v", err)
			begins, commits, rollbacks := fake.counts()
			testx.AssertEqual(t, begins, 1)
			testx.AssertEqual(t, commits, 0, "nothing is committed")
			testx.AssertEqual(t, rollbacks, 1)
			if tt.wantRBInErr {
				testx.AssertTrue(t, errors.Is(err, tt.rollbackErr), "rollback error is kept: %v", err)
				testx.AssertContains(t, err.Error(), "rollback: conn reset")
				return
			}
			testx.AssertEqual(t, err, errSKUTaken, "fn's error is returned unwrapped")
		})
	}
}

// When ctx is cancelled during fn, database/sql rolls the transaction back
// by itself; WithTx's own Rollback then gets ErrTxDone, which adds nothing
// to fn's error.
func TestWithTx_ContextCancelledInFn(t *testing.T) {
	fake := &fakeDB{}
	db := fake.open(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err := WithTx(ctx, db, func(*sqlc.Queries) error {
		cancel()
		// Wait for database/sql's own rollback, so WithTx's is the second.
		deadline := time.Now().Add(2 * time.Second)
		for {
			if _, _, rollbacks := fake.counts(); rollbacks == 1 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("database/sql did not roll back after cancel")
			}
			time.Sleep(time.Millisecond)
		}
		return ctx.Err()
	})

	testx.AssertEqual(t, err, context.Canceled)
	testx.AssertFalse(t, strings.Contains(err.Error(), "rollback"), "ErrTxDone is not reported: %v", err)
	_, commits, rollbacks := fake.counts()
	testx.AssertEqual(t, commits, 0)
	testx.AssertEqual(t, rollbacks, 1, "the driver rolled back exactly once")
}

func TestWithTx_RollsBackAndRepanics(t *testing.T) {
	fake := &fakeDB{}
	db := fake.open(t)

	var recovered any
	func() {
		defer func() { recovered = recover() }()
		_ = WithTx(context.Background(), db, func(*sqlc.Queries) error { panic("nil map write") })
	}()

	testx.AssertEqual(t, recovered, any("nil map write"), "the panic continues with its value")
	_, commits, rollbacks := fake.counts()
	testx.AssertEqual(t, commits, 0)
	testx.AssertEqual(t, rollbacks, 1, "the transaction is not left open")

	// The connection went back to the pool usable: the next transaction
	// commits.
	testx.AssertNoError(t, WithTx(context.Background(), db, func(*sqlc.Queries) error { return nil }))
	_, commits, _ = fake.counts()
	testx.AssertEqual(t, commits, 1)
}

func TestWithTx_BeginFails(t *testing.T) {
	refused := errors.New("connection refused")
	fake := &fakeDB{beginErr: refused}
	db := fake.open(t)
	called := false

	err := WithTx(context.Background(), db, func(*sqlc.Queries) error { called = true; return nil })

	testx.AssertFalse(t, called, "fn does not run without a transaction")
	testx.AssertTrue(t, errors.Is(err, refused), "err = %v", err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "begin transaction: "), "err = %v", err)
}

func TestWithTx_CommitFails(t *testing.T) {
	serialization := errors.New("could not serialize access")
	fake := &fakeDB{commitErr: serialization}
	db := fake.open(t)

	err := WithTx(context.Background(), db, func(*sqlc.Queries) error { return nil })

	testx.AssertTrue(t, errors.Is(err, serialization), "err = %v", err)
	testx.AssertEqual(t, err.Error(), "commit: could not serialize access")
	_, commits, rollbacks := fake.counts()
	testx.AssertEqual(t, commits, 1)
	testx.AssertEqual(t, rollbacks, 0)
}
