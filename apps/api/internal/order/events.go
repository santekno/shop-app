package order

import (
	"context"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
)

// Domain events (ADR 0006): every status change of an order records
// "order.<status>" (order.created for a new order) in the outbox, in the
// change's own transaction. Bab 6 sends the "order placed", "payment
// received" and "shipped" emails and notifications from them.

// eventPayload is what every order event carries: enough for a consumer to
// act (email the buyer, update a dashboard) without reading the order
// first.
type eventPayload struct {
	OrderID      string    `json:"order_id"`
	Code         string    `json:"code"`
	UserID       string    `json:"user_id"`
	Status       string    `json:"status"`
	CancelReason *string   `json:"cancel_reason,omitempty"`
	Total        int64     `json:"total"`
	Currency     string    `json:"currency"`
	OccurredAt   time.Time `json:"occurred_at"`
}

// eventType is the event that o's current status announces.
func eventType(o Order) string {
	if o.Status == StatusPendingPayment {
		return "order.created"
	}
	return "order." + string(o.Status)
}

// recordEvent writes o's event into the outbox through q, the change's
// transaction.
func recordEvent(ctx context.Context, q *sqlc.Queries, o Order) error {
	return outbox.Record(ctx, q, "order", o.ID, eventType(o), eventPayload{
		OrderID: o.ID, Code: o.Code, UserID: o.UserID, Status: string(o.Status), CancelReason: o.CancelReason,
		Total: o.Totals.Total, Currency: "IDR", OccurredAt: o.UpdatedAt.UTC(),
	})
}
