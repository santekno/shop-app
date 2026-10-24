// Package payment takes payments for orders through a payment gateway
// (ADR 0007): Midtrans Snap in the course, sandbox only, or a fake for
// tests and local development. It creates the gateway's transaction for an
// order, and, from Bab 6 artikel 03, turns the gateway's notifications into
// order status changes.
package payment

import (
	"errors"
	"slices"
	"time"
)

// Status is where a payment is; the payments_status_check values.
type Status string

// The payment statuses. Pending and challenge are "open": the buyer may
// still pay, and an order has at most one open payment.
const (
	StatusPending           Status = "pending"
	StatusChallenge         Status = "challenge"
	StatusPaid              Status = "paid"
	StatusDenied            Status = "denied"
	StatusCancelled         Status = "cancelled"
	StatusExpired           Status = "expired"
	StatusFailed            Status = "failed"
	StatusPartiallyRefunded Status = "partially_refunded"
	StatusRefunded          Status = "refunded"
)

// transitions is the payment life cycle: for each status, the statuses a
// payment may move to from it. A notification can never move a payment
// backwards (paid → pending), whatever order notifications arrive in.
var transitions = map[Status][]Status{
	StatusPending:           {StatusChallenge, StatusPaid, StatusDenied, StatusCancelled, StatusExpired, StatusFailed},
	StatusChallenge:         {StatusPaid, StatusDenied, StatusCancelled, StatusExpired, StatusFailed},
	StatusPaid:              {StatusPartiallyRefunded, StatusRefunded},
	StatusPartiallyRefunded: {StatusPartiallyRefunded, StatusRefunded},
}

// allStatuses is every status in life-cycle order, for From.
var allStatuses = []Status{
	StatusPending, StatusChallenge, StatusPaid, StatusDenied, StatusCancelled, StatusExpired, StatusFailed,
	StatusPartiallyRefunded, StatusRefunded,
}

// CanTransition reports whether a payment in status from may move to to.
func CanTransition(from, to Status) bool { return slices.Contains(transitions[from], to) }

// From lists the statuses a payment may move to to from: the
// @from_statuses of the guarded UPDATE.
func From(to Status) []string {
	var from []string
	for _, s := range allStatuses {
		if CanTransition(s, to) {
			from = append(from, string(s))
		}
	}
	return from
}

// Open reports whether a payment in status s can still take money.
func (s Status) Open() bool { return s == StatusPending || s == StatusChallenge }

// Payment is one gateway transaction for an order.
type Payment struct {
	ID      string
	OrderID string
	// Provider is the gateway's name: "midtrans" or "fake".
	Provider string
	// ProviderOrderID is the order_id the gateway knows the transaction by.
	ProviderOrderID string
	// Amount is what the buyer pays, in whole rupiah: the order's total.
	Amount      int64
	Status      Status
	Token       string
	RedirectURL string
	// ExpiresAt is when the gateway stops taking money for it.
	ExpiresAt        time.Time
	PaidAt           *time.Time
	RefundRequiredAt *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Errors the service returns; the handler maps each to its HTTP answer.
var (
	// ErrDisabled: no gateway is configured (MIDTRANS_SERVER_KEY is empty).
	ErrDisabled = errors.New("payments are disabled")
	// ErrOrderNotFound: the caller has no order with that ID.
	ErrOrderNotFound = errors.New("order not found")
	// ErrWindowClosed: the order's payment deadline is too close for the
	// gateway to take money before GoShop cancels the order.
	ErrWindowClosed = errors.New("payment window closed")
	// ErrGatewayUnavailable: the gateway did not answer, or refused the
	// request; try again shortly.
	ErrGatewayUnavailable = errors.New("payment gateway unavailable")
)

// NotPayableError means the order is not waiting for payment.
type NotPayableError struct {
	// Status is the order's current status.
	Status string
}

func (e *NotPayableError) Error() string { return "order is " + e.Status + " and cannot be paid" }
