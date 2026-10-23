package order

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// Change is one status change of an order.
type Change struct {
	OrderID string
	To      Status
	Now     time.Time
	// BuyerID scopes the change to that buyer's order (a buyer's own
	// cancel or receipt); empty for a seller, an admin or the system.
	BuyerID string
	// CancelReason is set when To is cancelled.
	CancelReason string
	// TrackingNumber is set when To is shipped.
	TrackingNumber string
}

// Transition applies c in one transaction with one conditional UPDATE
// (ADR 0006). A cancel also gives back the stock, locking the order's
// variants in id order first, and the voucher use. Every change records
// its event (order.paid, order.cancelled, ...) in the outbox in the same
// transaction. Errors: ErrNotFound, *TransitionError.
func (r *PostgresRepository) Transition(ctx context.Context, c Change) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		n, err := applyChange(ctx, q, c)
		if err != nil {
			return err
		}
		if n == 0 {
			return whyUnchanged(ctx, q, c)
		}
		if c.To == StatusCancelled {
			if err := giveBack(ctx, q, c.OrderID); err != nil {
				return err
			}
		}
		row, err := q.GetOrder(ctx, c.OrderID)
		if err != nil {
			return fmt.Errorf("read changed order: %w", err)
		}
		return recordEvent(ctx, q, fromOrderRow(orderRow(row)))
	})
}

// applyChange runs the status change's UPDATE and returns how many rows it
// changed (0 or 1).
func applyChange(ctx context.Context, q *sqlc.Queries, c Change) (int64, error) {
	from := From(c.To)
	buyer := optional(c.BuyerID)
	switch c.To {
	case StatusPaid:
		return q.MarkOrderPaid(ctx, sqlc.MarkOrderPaidParams{ID: c.OrderID, Now: c.Now, FromStatuses: from})
	case StatusProcessing:
		return q.StartProcessingOrder(ctx, sqlc.StartProcessingOrderParams{ID: c.OrderID, Now: c.Now, FromStatuses: from})
	case StatusShipped:
		return q.ShipOrder(ctx, sqlc.ShipOrderParams{
			ID: c.OrderID, Now: c.Now, TrackingNumber: c.TrackingNumber, FromStatuses: from,
		})
	case StatusCompleted:
		return q.CompleteOrder(ctx, sqlc.CompleteOrderParams{ID: c.OrderID, Now: c.Now, FromStatuses: from, BuyerID: buyer})
	case StatusCancelled:
		if c.CancelReason == CancelPaymentExpired {
			return q.ExpireOrder(ctx, sqlc.ExpireOrderParams{ID: c.OrderID, Now: c.Now})
		}
		if c.BuyerID != "" {
			from = buyerCancellable
		}
		return q.CancelOrder(ctx, sqlc.CancelOrderParams{
			ID: c.OrderID, Now: c.Now, CancelReason: c.CancelReason, FromStatuses: from, BuyerID: buyer,
		})
	default:
		return 0, fmt.Errorf("order status change to %q is not supported", c.To)
	}
}

// whyUnchanged turns "no row changed" into ErrNotFound or a
// *TransitionError with the order's current status.
func whyUnchanged(ctx context.Context, q *sqlc.Queries, c Change) error {
	current, err := q.GetOrderStatus(ctx, sqlc.GetOrderStatusParams{ID: c.OrderID, BuyerID: optional(c.BuyerID)})
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("query order status: %w", err)
	}
	return &TransitionError{Current: Status(current), To: c.To}
}

// giveBack returns a cancelled order's stock and voucher use, in the same
// transaction as the cancel. The variants are locked in id order first,
// the order checkout locks them in.
func giveBack(ctx context.Context, q *sqlc.Queries, orderID string) error {
	if _, err := q.LockOrderVariants(ctx, orderID); err != nil {
		return fmt.Errorf("lock order variants: %w", err)
	}
	if err := q.RestoreOrderStock(ctx, orderID); err != nil {
		return fmt.Errorf("restore stock: %w", err)
	}
	if err := q.ReleaseVoucher(ctx, orderID); err != nil {
		return fmt.Errorf("release voucher: %w", err)
	}
	return nil
}

// ExpiredOrderIDs lists up to limit unpaid orders past their deadline at
// now, the oldest deadline first.
func (r *PostgresRepository) ExpiredOrderIDs(ctx context.Context, now time.Time, limit int32) ([]string, error) {
	ids, err := r.q.ListExpiredOrderIDs(ctx, sqlc.ListExpiredOrderIDsParams{Now: now, BatchSize: limit})
	if err != nil {
		return nil, fmt.Errorf("query expired orders: %w", err)
	}
	return ids, nil
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
