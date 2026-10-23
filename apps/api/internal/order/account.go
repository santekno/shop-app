package order

import (
	"context"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// AccountCloser returns what deleting an account (DELETE /v1/me) does to
// the buyer's shop data, inside the deletion's transaction, which has
// locked the users row already (ADR 0006): every unpaid order is cancelled
// (buyer_cancelled) with its stock and voucher use given back and an
// order.cancelled event in the outbox, and the cart and the checkout
// idempotency keys are deleted. Paid orders stay: they are financial
// records, and the seller handles them (a refund is Bab 6's). internal/app
// hands it to user.NewPostgresRepository, so the user package does not
// import this one.
func AccountCloser(now func() time.Time) func(ctx context.Context, q *sqlc.Queries, userID string) error {
	return func(ctx context.Context, q *sqlc.Queries, userID string) error {
		ids, err := q.LockPendingOrdersOfUser(ctx, userID)
		if err != nil {
			return fmt.Errorf("lock unpaid orders: %w", err)
		}
		if len(ids) > 0 {
			if err := cancelForDeletion(ctx, q, userID, ids, now()); err != nil {
				return err
			}
		}
		if err := q.DeleteUserCart(ctx, &userID); err != nil {
			return fmt.Errorf("delete cart: %w", err)
		}
		if err := q.DeleteUserIdempotencyKeys(ctx, userID); err != nil {
			return fmt.Errorf("delete idempotency keys: %w", err)
		}
		return nil
	}
}

// cancelForDeletion cancels the locked unpaid orders ids. Their variants
// and vouchers are locked in id order first (ADR 0006, "Lock order"), and
// the stock and voucher uses of all of them go back in one statement each,
// so no row is written twice: a second write of a variant in the same
// transaction would make PostgreSQL lock its product, and deadlock with an
// admin save. Each order then records its order.cancelled event.
func cancelForDeletion(ctx context.Context, q *sqlc.Queries, userID string, ids []string, now time.Time) error {
	if err := q.LockOrdersVariants(ctx, ids); err != nil {
		return fmt.Errorf("lock unpaid orders' variants: %w", err)
	}
	if err := q.LockOrdersVouchers(ctx, ids); err != nil {
		return fmt.Errorf("lock unpaid orders' vouchers: %w", err)
	}
	if err := q.RestoreOrdersStock(ctx, ids); err != nil {
		return fmt.Errorf("restore stock: %w", err)
	}
	if err := q.ReleaseOrdersVouchers(ctx, ids); err != nil {
		return fmt.Errorf("release vouchers: %w", err)
	}
	for _, id := range ids {
		n, err := q.CancelOrder(ctx, sqlc.CancelOrderParams{
			ID: id, Now: now, CancelReason: CancelBuyerCancelled, FromStatuses: buyerCancellable, BuyerID: &userID,
		})
		if err != nil {
			return fmt.Errorf("cancel order %s: %w", id, err)
		}
		if n == 0 {
			// The row is locked and was unpaid; the stock is already
			// back, so refuse rather than commit a half cancel.
			return fmt.Errorf("cancel order %s: no longer unpaid", id)
		}
		row, err := q.GetOrder(ctx, id)
		if err != nil {
			return fmt.Errorf("read cancelled order: %w", err)
		}
		if err := recordEvent(ctx, q, fromOrderRow(orderRow(row))); err != nil {
			return err
		}
	}
	return nil
}
