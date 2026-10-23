package order

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository stores orders in PostgreSQL with the queries sqlc
// generated from internal/db/queries.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// VoucherByCode returns the voucher with code (already normalized), or a
// *VoucherError with VoucherNotFound.
func (r *PostgresRepository) VoucherByCode(ctx context.Context, code string) (Voucher, error) {
	return voucherByCode(ctx, r.q, code)
}

func voucherByCode(ctx context.Context, q *sqlc.Queries, code string) (Voucher, error) {
	row, err := q.GetVoucherByCode(ctx, code)
	if errors.Is(err, sql.ErrNoRows) {
		return Voucher{}, &VoucherError{Code: code, Reason: VoucherNotFound}
	}
	if err != nil {
		return Voucher{}, fmt.Errorf("query voucher: %w", err)
	}
	return Voucher{
		ID: row.ID, Code: row.Code, Kind: row.Kind, Value: row.Value, MinSpend: row.MinSpend,
		MaxDiscount: row.MaxDiscount.Int64, StartsAt: row.StartsAt, EndsAt: row.EndsAt,
		UsageLimit: row.UsageLimit.Int32, UsedCount: row.UsedCount, PerUserLimit: row.PerUserLimit,
	}, nil
}
