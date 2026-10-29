// Package order is checkout and the orders it creates (ADR 0006): the
// validation of a cart against the catalog, the totals, the order with its
// line snapshots, the status machine and the buyer's order history.
package order

import (
	"errors"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/cart"
)

// ErrCartEmpty means there is nothing to check out.
var ErrCartEmpty = errors.New("cart is empty")

// LineProblem is one cart line that checkout refuses, with what the buyer
// needs to fix it.
type LineProblem struct {
	VariantID string
	SKU       string
	Problem   cart.Problem
	// Quantity is what the line asks for; Available is the stock on hand
	// (0 for an unavailable variant).
	Quantity  int32
	Available int32
	// AddedPrice is the price the buyer saw, Price the price now.
	AddedPrice int64
	Price      int64
}

// ProblemsError is every line checkout refuses, in cart order. It is
// answered 409 CHECKOUT_PROBLEMS.
type ProblemsError struct {
	Lines []LineProblem
}

func (e *ProblemsError) Error() string { return "checkout problems" }

// validateLines checks every line the way checkout does: a variant that
// can still be sold, enough stock, and the price the buyer saw. It returns
// nil when every line can be bought. Checkout runs it on rows it has
// locked, preview on a plain read.
func validateLines(lines []cart.Line) error {
	var problems []LineProblem
	for _, l := range lines {
		p := l.Problem()
		if p == cart.ProblemNone {
			continue
		}
		available := l.Stock
		if p == cart.ProblemUnavailable {
			available = 0
		}
		problems = append(problems, LineProblem{
			VariantID: l.VariantID, SKU: l.SKU, Problem: p, Quantity: l.Quantity,
			Available: available, AddedPrice: l.AddedPrice, Price: l.Price,
		})
	}
	if len(problems) > 0 {
		return &ProblemsError{Lines: problems}
	}
	return nil
}

// Status is where an order is in its life cycle (docs/erd.md); the
// orders_status_check constraint's values.
type Status string

// The statuses, in the order an order normally goes through them.
const (
	StatusPendingPayment Status = "pending_payment"
	StatusPaid           Status = "paid"
	StatusProcessing     Status = "processing"
	StatusShipped        Status = "shipped"
	StatusCompleted      Status = "completed"
	StatusCancelled      Status = "cancelled"
)

// Why an order was cancelled; the orders_cancel_reason_check values.
const (
	CancelPaymentExpired  = "payment_expired"
	CancelBuyerCancelled  = "buyer_cancelled"
	CancelSellerCancelled = "seller_cancelled"
)

// Limits of checkout (ADR 0006).
const (
	// MaxPendingOrders is how many unpaid orders one buyer may have at
	// once, so one account cannot hold a product's stock by never paying
	// (OWASP API6).
	MaxPendingOrders = 5
	// DefaultPaymentTTL is how long a buyer has to pay
	// (APP_PAYMENT_TTL); it matches Midtrans' default expiry (Bab 6).
	DefaultPaymentTTL = 24 * time.Hour
)

// ShippingAddress is the copy of an address an order keeps.
type ShippingAddress struct {
	Recipient  string
	Phone      string
	Street     string
	City       string
	Province   string
	PostalCode string
}

// Item is one order line: a snapshot of what was bought, at what price.
type Item struct {
	ID          string
	VariantID   string
	ProductName string
	VariantName string
	SKU         string
	UnitPrice   int64
	Quantity    int32
	LineTotal   int64
}

// LatestPayment is the newest payment of an order, as the buyer's order
// page shows it: what happened to the last attempt to pay (Bab 11). Only
// its status and times: tokens, gateway IDs and amounts stay in the
// payment package.
type LatestPayment struct {
	// Status is a payments_status_check value: pending, challenge, paid,
	// denied, cancelled, failed, expired, refunded or partially_refunded.
	Status    string
	ExpiresAt time.Time
	UpdatedAt time.Time
}

// Order is a placed order with its lines.
type Order struct {
	ID     string
	Code   string
	UserID string
	Status Status
	// CancelReason is set only when Status is cancelled.
	CancelReason   *string
	Totals         Totals
	VoucherCode    *string
	Courier        string
	CourierService string
	TrackingNumber *string
	Address        ShippingAddress
	Items          []Item
	// LatestPayment is the order's newest payment, nil when it has none.
	// Read just after the order, so it may be newer than the order's
	// status, never older: the order's status decides, and this only
	// explains a pending_payment order.
	LatestPayment *LatestPayment

	PaymentExpiresAt time.Time
	PaidAt           *time.Time
	ShippedAt        *time.Time
	CompletedAt      *time.Time
	CancelledAt      *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// More errors the service returns.
var (
	// ErrNotFound: the caller has no order with that ID (another user's
	// order included).
	ErrNotFound = errors.New("order not found")
	// ErrEmailUnverified: checkout needs a verified email (SECURITY.md).
	ErrEmailUnverified = errors.New("email not verified")
	// ErrAccountGone: the buyer's account was deleted.
	ErrAccountGone = errors.New("account deleted")
	// ErrTooManyPendingOrders: the buyer already has MaxPendingOrders
	// unpaid orders.
	ErrTooManyPendingOrders = errors.New("too many pending orders")
	// ErrCartChanged: the cart changed between the shipping quote and the
	// transaction (another checkout took its lines, it was edited on
	// another device, or a variant's weight was edited); review it and try
	// again.
	ErrCartChanged = errors.New("cart changed during checkout")
)
