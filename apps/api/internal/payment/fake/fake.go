// Package fake is a stand-in for Midtrans (ADR 0007) for tests and local
// development: the same payment.Gateway, transactions kept in a Store
// (Redis, so the API and the worker see the same ones), and notifications
// signed exactly like Midtrans signs them, with this package's own key.
// The configuration refuses it in production (APP_PAYMENT_PROVIDER=fake).
package fake

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
)

// ServerKey signs the fake's notifications and status answers. It is not
// a secret: it only works against a server running the fake, which
// production refuses to do.
const ServerKey = "goshop-fake-payment-key"

// ClientKey is what the fake hands clients for Snap.js; no real Snap.js
// accepts it.
const ClientKey = "goshop-fake-client-key"

// Transaction is one fake transaction.
type Transaction struct {
	OrderID       string `json:"order_id"`
	Amount        int64  `json:"amount"`
	Token         string `json:"token"`
	TransactionID string `json:"transaction_id"`
	// Status is Midtrans' transaction_status; empty until the buyer
	// "chooses how to pay" (Pay), like Midtrans, which has no
	// transaction before that.
	Status      string `json:"status"`
	FraudStatus string `json:"fraud_status"`
	PaymentType string `json:"payment_type"`
}

// Store keeps fake transactions.
type Store interface {
	Put(ctx context.Context, t Transaction) error
	// Get returns the transaction, and false when there is none.
	Get(ctx context.Context, orderID string) (Transaction, bool, error)
}

// Gateway is the fake payment.Gateway.
type Gateway struct {
	store Store
}

var _ payment.Gateway = (*Gateway)(nil)

// New returns a fake gateway on store.
func New(store Store) *Gateway { return &Gateway{store: store} }

// Name implements payment.Gateway.
func (g *Gateway) Name() string { return "fake" }

// ClientKey implements payment.Gateway.
func (g *Gateway) ClientKey() string { return ClientKey }

// CreateTransaction implements payment.Gateway.
func (g *Gateway) CreateTransaction(ctx context.Context, req payment.TransactionRequest) (payment.Transaction, error) {
	t := Transaction{OrderID: req.OrderID, Amount: req.Amount, Token: "fake-" + uuidx.NewV7()}
	if err := g.store.Put(ctx, t); err != nil {
		return payment.Transaction{}, fmt.Errorf("%w: fake: %w", payment.ErrGatewayUnavailable, err)
	}
	return payment.Transaction{Token: t.Token, RedirectURL: "https://fake-payment.invalid/snap/" + t.Token}, nil
}

// statusCodes are the status_code Midtrans sends with each status.
var statusCodes = map[string]string{
	"settlement": "200", "capture": "200", "pending": "201", "deny": "202", "cancel": "200",
	"expire": "407", "failure": "202", "refund": "200", "partial_refund": "200",
}

// Status implements payment.Gateway.
func (g *Gateway) Status(ctx context.Context, orderID string) (payment.TransactionStatus, error) {
	t, ok, err := g.store.Get(ctx, orderID)
	if err != nil {
		return payment.TransactionStatus{}, fmt.Errorf("%w: fake: %w", payment.ErrGatewayUnavailable, err)
	}
	if !ok || t.Status == "" {
		return payment.TransactionStatus{}, payment.ErrTransactionNotFound
	}
	return payment.TransactionStatus{
		OrderID: t.OrderID, StatusCode: statusCodes[t.Status], TransactionID: t.TransactionID,
		TransactionStatus: t.Status, FraudStatus: t.FraudStatus, PaymentType: t.PaymentType,
		GrossAmount: grossAmount(t.Amount),
	}, nil
}

// VerifySignature implements payment.Gateway, with Midtrans' formula and
// ServerKey.
func (g *Gateway) VerifySignature(orderID, statusCode, grossAmount, signature string) bool {
	return midtrans.CheckSignature(ServerKey, orderID, statusCode, grossAmount, signature)
}

// ErrUnknownStatus means Pay was given a status Midtrans does not send.
var ErrUnknownStatus = errors.New("fake: unknown transaction status")

// Pay is what Midtrans does when the buyer pays (or the bank refuses, or
// the transaction expires): the transaction of orderID takes status, and
// Pay returns the notification Midtrans would send, signed. fraudStatus
// matters for "capture" only (accept, challenge, deny).
func (g *Gateway) Pay(ctx context.Context, orderID, status, fraudStatus string) (payment.Notification, error) {
	code, ok := statusCodes[status]
	if !ok {
		return payment.Notification{}, ErrUnknownStatus
	}
	t, found, err := g.store.Get(ctx, orderID)
	if err != nil {
		return payment.Notification{}, err
	}
	if !found {
		return payment.Notification{}, payment.ErrTransactionNotFound
	}
	if t.TransactionID == "" {
		t.TransactionID, t.PaymentType = uuidx.NewV7(), "bank_transfer"
	}
	t.Status, t.FraudStatus = status, fraudStatus
	if err := g.store.Put(ctx, t); err != nil {
		return payment.Notification{}, err
	}
	return Notification(t.OrderID, code, grossAmount(t.Amount)), nil
}

// Notification is a notification signed with ServerKey.
func Notification(orderID, statusCode, grossAmount string) payment.Notification {
	return payment.Notification{
		OrderID: orderID, StatusCode: statusCode, GrossAmount: grossAmount,
		SignatureKey: midtrans.Signature(ServerKey, orderID, statusCode, grossAmount),
	}
}

// Send posts n to webhookURL like Midtrans does, and returns the answer's
// status and body.
func Send(ctx context.Context, webhookURL string, n payment.Notification) (int, string, error) {
	body, err := json.Marshal(n)
	if err != nil {
		return 0, "", fmt.Errorf("fake: encode notification: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return 0, "", fmt.Errorf("fake: build notification: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return 0, "", fmt.Errorf("fake: send notification: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out bytes.Buffer
	_, _ = out.ReadFrom(io.LimitReader(resp.Body, 64<<10))
	return resp.StatusCode, out.String(), nil
}

// grossAmount is amount the way Midtrans writes it: "117000.00".
func grossAmount(amount int64) string { return strconv.FormatInt(amount, 10) + ".00" }

// MemoryStore keeps transactions in memory, for tests in one process.
type MemoryStore struct {
	mu sync.Mutex
	tx map[string]Transaction
}

// NewMemoryStore returns an empty MemoryStore.
func NewMemoryStore() *MemoryStore { return &MemoryStore{tx: map[string]Transaction{}} }

// Put implements Store.
func (m *MemoryStore) Put(_ context.Context, t Transaction) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tx[t.OrderID] = t
	return nil
}

// Get implements Store.
func (m *MemoryStore) Get(_ context.Context, orderID string) (Transaction, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tx[orderID]
	return t, ok, nil
}

// RedisStore keeps transactions in Redis for a week, so the API, the
// worker and `api fake-pay` share them.
type RedisStore struct{ c redis.UniversalClient }

// NewRedisStore returns a store on c.
func NewRedisStore(c redis.UniversalClient) *RedisStore { return &RedisStore{c: c} }

const redisTTL = 7 * 24 * time.Hour

func redisKey(orderID string) string { return "goshop:fake-payment:" + orderID }

// Put implements Store.
func (r *RedisStore) Put(ctx context.Context, t Transaction) error {
	body, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("fake: encode transaction: %w", err)
	}
	if err := r.c.Set(ctx, redisKey(t.OrderID), body, redisTTL).Err(); err != nil {
		return fmt.Errorf("fake: store transaction: %w", err)
	}
	return nil
}

// Get implements Store.
func (r *RedisStore) Get(ctx context.Context, orderID string) (Transaction, bool, error) {
	body, err := r.c.Get(ctx, redisKey(orderID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return Transaction{}, false, nil
	}
	if err != nil {
		return Transaction{}, false, fmt.Errorf("fake: read transaction: %w", err)
	}
	var t Transaction
	if err := json.Unmarshal(body, &t); err != nil {
		return Transaction{}, false, fmt.Errorf("fake: decode transaction: %w", err)
	}
	return t, true, nil
}
