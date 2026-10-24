package payment

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/order"
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

// ByProviderOrderID returns the payment the gateway knows as
// providerOrderID, or ErrPaymentNotFound.
func (r *PostgresRepository) ByProviderOrderID(ctx context.Context, providerOrderID string) (Payment, error) {
	row, err := r.q.GetPaymentByProviderOrderID(ctx, providerOrderID)
	if errors.Is(err, sql.ErrNoRows) {
		return Payment{}, ErrPaymentNotFound
	}
	if err != nil {
		return Payment{}, fmt.Errorf("query payment: %w", err)
	}
	return fromRow(paymentRow(row)), nil
}

// Apply applies in in one transaction, in the lock order of ADR 0007: the
// order, then the payment row (its guarded UPDATE), then the order's
// change and its outbox event, then the payment event.
func (r *PostgresRepository) Apply(ctx context.Context, in ApplyInput) (Outcome, error) {
	var outcome Outcome
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		var err error
		outcome, err = applyIn(ctx, q, in)
		if err != nil {
			return err
		}
		recorded, err := insertEvent(ctx, q, in, outcome)
		if err != nil {
			return err
		}
		if !recorded && outcome == OutcomeRecorded {
			// Nothing moved, and this status was recorded before.
			outcome = OutcomeDuplicate
		}
		return nil
	})
	return outcome, err
}

// applyIn changes the payment and the order for in, and says what it did.
func applyIn(ctx context.Context, q *sqlc.Queries, in ApplyInput) (Outcome, error) {
	if !in.AmountMatches {
		return OutcomeAmountMismatch, nil
	}
	if !in.Known {
		return OutcomeRecorded, nil
	}
	// The order first, then the payment row (ADR 0007, "Lock order"): an
	// order that closes cancels its open payment in that order too.
	if _, err := q.LockPaymentOrder(ctx, in.Payment.OrderID); err != nil {
		return "", fmt.Errorf("lock payment's order: %w", err)
	}
	moved, err := movePayment(ctx, q, in)
	if err != nil || !moved {
		return OutcomeRecorded, err
	}
	switch in.To {
	case StatusPaid:
		paid, err := order.MarkPaidIn(ctx, q, in.Payment.OrderID, in.Now)
		if err != nil {
			return "", err
		}
		if paid {
			return OutcomePaid, nil
		}
		// Money arrived for an order that is no longer waiting for it: it
		// expired, was cancelled, or another payment paid it first. The
		// order is never revived; the payment is flagged for a refund.
		if err := q.FlagPaymentForRefund(ctx, sqlc.FlagPaymentForRefundParams{ID: in.Payment.ID, Now: in.Now}); err != nil {
			return "", fmt.Errorf("flag payment for refund: %w", err)
		}
		return OutcomeRefundRequired, nil
	case StatusExpired:
		cancelled, err := order.ExpireUnpaidIn(ctx, q, in.Payment.OrderID, in.Now)
		if err != nil {
			return "", err
		}
		if cancelled {
			return OutcomeOrderCancelled, nil
		}
	}
	return OutcomeRecorded, nil
}

// movePayment runs the payment's guarded status change and reports
// whether it moved.
func movePayment(ctx context.Context, q *sqlc.Queries, in ApplyInput) (bool, error) {
	var paidAt sql.NullTime
	if in.To == StatusPaid {
		paidAt = sql.NullTime{Time: in.Now, Valid: true}
	}
	n, err := q.UpdatePaymentStatus(ctx, sqlc.UpdatePaymentStatusParams{
		ID: in.Payment.ID, Status: string(in.To), FromStatuses: From(in.To), Now: in.Now,
		ProviderStatus:        sql.NullString{String: in.Gateway.TransactionStatus, Valid: true},
		ProviderTransactionID: nullString(in.Gateway.TransactionID),
		PaymentType:           nullString(in.Gateway.PaymentType),
		PaidAt:                paidAt,
	})
	if err != nil {
		return false, fmt.Errorf("update payment status: %w", err)
	}
	return n == 1, nil
}

// insertEvent records in with outcome, and reports false when the same
// status was recorded before.
func insertEvent(ctx context.Context, q *sqlc.Queries, in ApplyInput, outcome Outcome) (bool, error) {
	var amount sql.NullInt64
	if in.AmountOK {
		amount = sql.NullInt64{Int64: in.Amount, Valid: true}
	}
	n, err := q.InsertPaymentEvent(ctx, sqlc.InsertPaymentEventParams{
		ID: uuidx.NewV7(), PaymentID: in.Payment.ID, DedupeKey: in.DedupeKey, Source: in.Source,
		TransactionStatus: in.Gateway.TransactionStatus, FraudStatus: nullString(in.Gateway.FraudStatus),
		StatusCode: in.Gateway.StatusCode, TransactionID: nullString(in.Gateway.TransactionID),
		PaymentType: nullString(in.Gateway.PaymentType), GrossAmount: amount,
		Outcome: string(outcome), ReceivedAt: in.Now,
	})
	if err != nil {
		return false, fmt.Errorf("insert payment event: %w", err)
	}
	return n == 1, nil
}

func nullString(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }
