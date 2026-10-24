package payment

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/order"
)

// Orders reads the buyer's order; order.Service is one. Another user's
// order is order.ErrNotFound.
type Orders interface {
	Get(ctx context.Context, userID, id string) (order.Order, error)
}

// Repository is where payments are stored.
type Repository interface {
	OpenPayment(ctx context.Context, orderID string) (Payment, bool, error)
	Insert(ctx context.Context, p Payment) (bool, error)
}

// Deps is what the service needs.
type Deps struct {
	Repo   Repository
	Orders Orders
	// Gateway takes the money; nil turns payments off (ErrDisabled).
	Gateway Gateway
	// Clock is the current time; time.Now when nil.
	Clock func() time.Time
}

// Service is payments.
type Service struct {
	repo    Repository
	orders  Orders
	gateway Gateway
	now     func() time.Time
}

// NewService returns a Service built from deps.
func NewService(deps Deps) *Service {
	s := &Service{repo: deps.Repo, orders: deps.Orders, gateway: deps.Gateway, now: deps.Clock}
	if s.now == nil {
		s.now = time.Now
	}
	return s
}

// Enabled reports whether a gateway is configured.
func (s *Service) Enabled() bool { return s.gateway != nil }

// ClientKey is the gateway's public key for Snap.js; empty when payments
// are off.
func (s *Service) ClientKey() string {
	if s.gateway == nil {
		return ""
	}
	return s.gateway.ClientKey()
}

// expiryMargin is how long before the order's payment deadline the
// gateway stops taking money, so a buyer cannot pay an order that GoShop
// is about to cancel (ADR 0007).
const expiryMargin = time.Minute

// snapMinutes is how many whole minutes the gateway may take money for,
// from now, so that it stops at least expiryMargin before deadline.
func snapMinutes(now, deadline time.Time) int {
	return int(deadline.Add(-expiryMargin).Sub(now) / time.Minute)
}

// Pay returns the payment the buyer pays order orderID with, and whether
// it was created now. An open payment is returned again (paying twice
// never creates two); otherwise a new gateway transaction is created for
// the order's total. Errors: ErrDisabled, ErrOrderNotFound,
// *NotPayableError, ErrWindowClosed, ErrGatewayUnavailable.
func (s *Service) Pay(ctx context.Context, buyerID, orderID string) (Payment, bool, error) {
	if s.gateway == nil {
		return Payment{}, false, ErrDisabled
	}
	o, err := s.orders.Get(ctx, buyerID, orderID)
	if errors.Is(err, order.ErrNotFound) {
		return Payment{}, false, ErrOrderNotFound
	}
	if err != nil {
		return Payment{}, false, fmt.Errorf("pay order %s: %w", orderID, err)
	}
	if o.Status != order.StatusPendingPayment {
		return Payment{}, false, &NotPayableError{Status: string(o.Status)}
	}
	now := s.now()
	if open, ok, err := s.repo.OpenPayment(ctx, o.ID); err != nil {
		return Payment{}, false, fmt.Errorf("pay order %s: %w", orderID, err)
	} else if ok && open.ExpiresAt.After(now) {
		return open, false, nil
	}
	minutes := snapMinutes(now, o.PaymentExpiresAt)
	if minutes < 1 {
		return Payment{}, false, ErrWindowClosed
	}
	p, err := s.create(ctx, o, now, minutes)
	if err != nil {
		return Payment{}, false, err
	}
	stored, err := s.repo.Insert(ctx, p)
	if err != nil {
		return Payment{}, false, fmt.Errorf("pay order %s: %w", orderID, err)
	}
	if stored {
		return p, true, nil
	}
	return s.afterLostInsert(ctx, buyerID, orderID)
}

// create asks the gateway for a transaction of o's total. The call runs
// outside any transaction, so a slow gateway holds no row lock.
func (s *Service) create(ctx context.Context, o order.Order, now time.Time, minutes int) (Payment, error) {
	providerOrderID, err := newProviderOrderID(o.Code)
	if err != nil {
		return Payment{}, err
	}
	tx, err := s.gateway.CreateTransaction(ctx, TransactionRequest{
		OrderID: providerOrderID, Amount: o.Totals.Total, Start: now, Minutes: minutes,
	})
	if err != nil {
		return Payment{}, fmt.Errorf("pay order %s: %w", o.ID, err)
	}
	return Payment{
		ID: uuidx.NewV7(), OrderID: o.ID, Provider: s.gateway.Name(), ProviderOrderID: providerOrderID,
		Amount: o.Totals.Total, Status: StatusPending, Token: tx.Token, RedirectURL: tx.RedirectURL,
		ExpiresAt: now.Add(time.Duration(minutes) * time.Minute), CreatedAt: now, UpdatedAt: now,
	}, nil
}

// afterLostInsert answers a pay whose payment was not stored: another
// request stored one first (return it), or the order stopped waiting for
// payment meanwhile. The transaction just created at the gateway is never
// shown to anyone and expires unused.
func (s *Service) afterLostInsert(ctx context.Context, buyerID, orderID string) (Payment, bool, error) {
	if open, ok, err := s.repo.OpenPayment(ctx, orderID); err != nil {
		return Payment{}, false, fmt.Errorf("pay order %s: %w", orderID, err)
	} else if ok {
		return open, false, nil
	}
	o, err := s.orders.Get(ctx, buyerID, orderID)
	if err != nil {
		return Payment{}, false, fmt.Errorf("pay order %s: %w", orderID, err)
	}
	return Payment{}, false, &NotPayableError{Status: string(o.Status)}
}

// providerAlphabet is Crockford's base32, like order codes.
const providerAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// newProviderOrderID is the gateway's order_id for a new payment of the
// order with code: the code and 6 random characters, so it stays readable
// in the Midtrans dashboard and is new for every payment.
func newProviderOrderID(code string) (string, error) {
	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("random payment id: %w", err)
	}
	suffix := make([]byte, len(random))
	for i, b := range random {
		suffix[i] = providerAlphabet[int(b)%len(providerAlphabet)] // 256 is a multiple of 32: no bias
	}
	return code + "-" + string(suffix), nil
}
