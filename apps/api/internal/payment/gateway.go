package payment

import (
	"context"
	"errors"
	"time"
)

// ErrTransactionNotFound means the gateway has no transaction with that
// order_id.
var ErrTransactionNotFound = errors.New("payment gateway has no such transaction")

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
	// Status asks the gateway for a transaction's current status, the
	// only answer GoShop acts on. Errors: ErrTransactionNotFound when the
	// gateway has no such transaction (the buyer never chose how to pay),
	// otherwise wrapping ErrGatewayUnavailable.
	Status(ctx context.Context, orderID string) (TransactionStatus, error)
	// VerifySignature reports whether signature is the gateway's
	// signature of a notification's order_id, status_code and
	// gross_amount, compared in constant time.
	VerifySignature(orderID, statusCode, grossAmount, signature string) bool
}

// TransactionStatus is a transaction's status as the gateway reports it,
// in Midtrans' terms.
type TransactionStatus struct {
	OrderID           string
	StatusCode        string
	TransactionID     string
	TransactionStatus string // settlement, capture, pending, deny, cancel, expire, failure, refund, ...
	FraudStatus       string // accept, challenge, deny; empty for most methods
	PaymentType       string
	// GrossAmount is the amount as the gateway wrote it, e.g. "117000.00".
	GrossAmount string
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
