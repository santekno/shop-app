package payment

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository stores payments in PostgreSQL.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// OpenPayment returns the order's open payment, and false when it has none.
func (r *PostgresRepository) OpenPayment(ctx context.Context, orderID string) (Payment, bool, error) {
	row, err := r.q.GetOpenPayment(ctx, orderID)
	if errors.Is(err, sql.ErrNoRows) {
		return Payment{}, false, nil
	}
	if err != nil {
		return Payment{}, false, fmt.Errorf("query open payment: %w", err)
	}
	return fromRow(row), true, nil
}

// Insert stores p, and reports false when it was not stored: the order
// has an open payment already, or no longer waits for payment of p.Amount.
func (r *PostgresRepository) Insert(ctx context.Context, p Payment) (bool, error) {
	n, err := r.q.InsertPayment(ctx, sqlc.InsertPaymentParams{
		ID: p.ID, Provider: p.Provider, ProviderOrderID: p.ProviderOrderID, SnapToken: p.Token,
		RedirectUrl: p.RedirectURL, ExpiresAt: p.ExpiresAt, Now: p.CreatedAt, OrderID: p.OrderID, Amount: p.Amount,
	})
	if err != nil {
		return false, fmt.Errorf("insert payment: %w", err)
	}
	return n == 1, nil
}

// paymentRow is the columns every payment read returns.
type paymentRow = sqlc.GetOpenPaymentRow

func fromRow(row paymentRow) Payment {
	return Payment{
		ID: row.ID, OrderID: row.OrderID, Provider: row.Provider, ProviderOrderID: row.ProviderOrderID,
		Amount: row.Amount, Status: Status(row.Status), Token: row.SnapToken, RedirectURL: row.RedirectUrl,
		ExpiresAt: row.ExpiresAt, PaidAt: nullTime(row.PaidAt), RefundRequiredAt: nullTime(row.RefundRequiredAt),
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func nullTime(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}
