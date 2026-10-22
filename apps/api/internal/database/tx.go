package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// WithTx runs fn in one transaction on db: the unit of work. fn gets the
// sqlc queries bound to that transaction and does all its reads and writes
// through them. When fn returns nil the transaction commits; when it
// returns an error, or panics, everything fn wrote is rolled back, so the
// database never keeps half of the work.
//
//	err := database.WithTx(ctx, db, func(q *sqlc.Queries) error {
//		if err := q.InsertProduct(ctx, product); err != nil {
//			return err // nothing is stored
//		}
//		return q.InsertVariant(ctx, variant)
//	})
//
// fn's error is returned as it is, so callers can still match it with
// errors.Is. fn must not keep q after it returns.
func WithTx(ctx context.Context, db *sql.DB, fn func(q *sqlc.Queries) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		// A panic in fn must not leave the connection inside an open
		// transaction: roll back, then let the panic continue to Recovery.
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()

	if err := fn(sqlc.New(tx)); err != nil {
		// ErrTxDone means database/sql already rolled back, because ctx
		// was cancelled; there is nothing to add to fn's error then.
		if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
			return errors.Join(err, fmt.Errorf("rollback: %w", rbErr))
		}
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
