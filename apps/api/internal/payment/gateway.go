package payment

import (
	"context"
	"time"
)

// Gateway is a payment provider: Midtrans (internal/payment/midtrans) or
// the test double (internal/payment/fake). The service depends on this
// interface only.
type Gateway interface {
	// Name is the provider stored on every payment: "midtrans" or "fake".
	Name() string
	// ClientKey is the public key a client hands to Snap.js.
	ClientKey() string
	// CreateTransaction creates a hosted payment page for req. Errors wrap
	// ErrGatewayUnavailable.
	CreateTransaction(ctx context.Context, req TransactionRequest) (Transaction, error)
}

// TransactionRequest is what GoShop asks the gateway to charge.
type TransactionRequest struct {
	// OrderID is the gateway's order_id for this payment.
	OrderID string
	// Amount is in whole rupiah, from the order row.
	Amount int64
	// Start and Minutes are the transaction's expiry: the gateway takes
	// money from Start for Minutes minutes.
	Start   time.Time
	Minutes int
}

// Transaction is the gateway's answer: where the buyer pays.
type Transaction struct {
	Token       string
	RedirectURL string
}
