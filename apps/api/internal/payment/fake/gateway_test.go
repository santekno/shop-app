package fake

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
)

var errStore = errors.New("store down")

// failingStore wraps a MemoryStore and fails Get or Put when told to.
type failingStore struct {
	*MemoryStore
	getErr, putErr error
}

func (s *failingStore) Put(ctx context.Context, t Transaction) error {
	if s.putErr != nil {
		return s.putErr
	}
	return s.MemoryStore.Put(ctx, t)
}

func (s *failingStore) Get(ctx context.Context, orderID string) (Transaction, bool, error) {
	if s.getErr != nil {
		return Transaction{}, false, s.getErr
	}
	return s.MemoryStore.Get(ctx, orderID)
}

func txRequest(orderID string) payment.TransactionRequest {
	return payment.TransactionRequest{OrderID: orderID, Amount: 117000, Start: time.Now(), Minutes: 60}
}

// created is a gateway on a memory store with one transaction for orderID.
func created(t *testing.T, orderID string) (*Gateway, *MemoryStore, payment.Transaction) {
	t.Helper()
	store := NewMemoryStore()
	g := New(store)
	tx, err := g.CreateTransaction(context.Background(), txRequest(orderID))
	testx.AssertNoError(t, err)
	return g, store, tx
}

func TestGateway_NameAndKeys(t *testing.T) {
	g := New(NewMemoryStore())
	testx.AssertEqual(t, g.Name(), "fake")
	testx.AssertEqual(t, g.ClientKey(), ClientKey)
	testx.AssertEqual(t, ClientKey, "goshop-fake-client-key")
	testx.AssertEqual(t, ServerKey, "goshop-fake-payment-key")
	var _ payment.Gateway = g
}

func TestCreateTransaction_StoresTheTransaction(t *testing.T) {
	g, store, tx := created(t, "GS-1-AAAAAA")
	testx.AssertTrue(t, strings.HasPrefix(tx.Token, "fake-"), "token %q", tx.Token)
	testx.AssertTrue(t, len(tx.Token) > len("fake-"), "token %q", tx.Token)
	testx.AssertEqual(t, tx.RedirectURL, "https://fake-payment.invalid/snap/"+tx.Token)

	stored, ok, err := store.Get(context.Background(), "GS-1-AAAAAA")
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, stored, Transaction{OrderID: "GS-1-AAAAAA", Amount: 117000, Token: tx.Token})

	// Every transaction has its own token.
	other, err := g.CreateTransaction(context.Background(), txRequest("GS-2-BBBBBB"))
	testx.AssertNoError(t, err)
	testx.AssertNotEqual(t, other.Token, tx.Token)
}

func TestStatus_NoTransactionUntilPaid(t *testing.T) {
	g, _, _ := created(t, "GS-1")
	_, err := g.Status(context.Background(), "GS-1")
	testx.AssertTrue(t, errors.Is(err, payment.ErrTransactionNotFound), "before Pay: %v", err)
	_, err = g.Status(context.Background(), "GS-UNKNOWN")
	testx.AssertTrue(t, errors.Is(err, payment.ErrTransactionNotFound), "unknown order: %v", err)
}

func TestPay_StatusCodes(t *testing.T) {
	tests := []struct{ status, code string }{
		{"settlement", "200"}, {"capture", "200"}, {"pending", "201"}, {"deny", "202"},
		{"cancel", "200"}, {"expire", "407"}, {"failure", "202"}, {"refund", "200"},
		{"partial_refund", "200"},
	}
	testx.AssertEqual(t, len(statusCodes), len(tests))
	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			g, _, _ := created(t, "GS-"+tt.status)
			n, err := g.Pay(context.Background(), "GS-"+tt.status, tt.status, "")
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, n.OrderID, "GS-"+tt.status)
			testx.AssertEqual(t, n.StatusCode, tt.code)
			testx.AssertEqual(t, n.GrossAmount, "117000.00")

			st, err := g.Status(context.Background(), "GS-"+tt.status)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, st.StatusCode, tt.code)
			testx.AssertEqual(t, st.TransactionStatus, tt.status)
		})
	}
}

func TestPay_NotificationIsSignedWithServerKey(t *testing.T) {
	g, _, _ := created(t, "GS-20261101-7KQ2M9-K3D9QX")
	n, err := g.Pay(context.Background(), "GS-20261101-7KQ2M9-K3D9QX", "settlement", "")
	testx.AssertNoError(t, err)

	testx.AssertEqual(t, n.SignatureKey, midtrans.Signature(ServerKey, n.OrderID, "200", "117000.00"))
	testx.AssertTrue(t, midtrans.CheckSignature(ServerKey, n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey))
	testx.AssertTrue(t, g.VerifySignature(n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey))
	// Another key does not verify it, and a changed field breaks it.
	testx.AssertFalse(t, midtrans.CheckSignature("SB-Mid-server-real", n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey))
	testx.AssertFalse(t, midtrans.New("SB-Mid-server-real", "c", time.Second).VerifySignature(n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey))
	testx.AssertFalse(t, g.VerifySignature(n.OrderID, n.StatusCode, "1.00", n.SignatureKey))
	testx.AssertFalse(t, g.VerifySignature(n.OrderID, "407", n.GrossAmount, n.SignatureKey))
	testx.AssertFalse(t, g.VerifySignature(n.OrderID, n.StatusCode, n.GrossAmount, ""))
}

func TestPay_StatusReflectsThePayment(t *testing.T) {
	g, _, _ := created(t, "GS-1")
	_, err := g.Pay(context.Background(), "GS-1", "capture", "challenge")
	testx.AssertNoError(t, err)

	st, err := g.Status(context.Background(), "GS-1")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, st.OrderID, "GS-1")
	testx.AssertEqual(t, st.StatusCode, "200")
	testx.AssertEqual(t, st.TransactionStatus, "capture")
	testx.AssertEqual(t, st.FraudStatus, "challenge")
	testx.AssertEqual(t, st.PaymentType, "bank_transfer")
	testx.AssertEqual(t, st.GrossAmount, "117000.00")
	testx.AssertTrue(t, st.TransactionID != "", "a transaction id")
	firstID := st.TransactionID

	// A later status keeps the transaction, like Midtrans does.
	_, err = g.Pay(context.Background(), "GS-1", "settlement", "accept")
	testx.AssertNoError(t, err)
	st, err = g.Status(context.Background(), "GS-1")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, st.TransactionID, firstID)
	testx.AssertEqual(t, st.TransactionStatus, "settlement")
	testx.AssertEqual(t, st.FraudStatus, "accept")
	testx.AssertEqual(t, st.PaymentType, "bank_transfer")
}

func TestPay_Errors(t *testing.T) {
	g, _, _ := created(t, "GS-1")

	_, err := g.Pay(context.Background(), "GS-1", "paid", "")
	testx.AssertTrue(t, errors.Is(err, ErrUnknownStatus), "err %v", err)
	_, err = g.Pay(context.Background(), "GS-1", "", "")
	testx.AssertTrue(t, errors.Is(err, ErrUnknownStatus), "err %v", err)
	// An unknown status changes nothing.
	_, err = g.Status(context.Background(), "GS-1")
	testx.AssertTrue(t, errors.Is(err, payment.ErrTransactionNotFound), "err %v", err)

	_, err = g.Pay(context.Background(), "GS-MISSING", "settlement", "")
	testx.AssertTrue(t, errors.Is(err, payment.ErrTransactionNotFound), "err %v", err)
}

func TestGateway_StoreErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("CreateTransaction", func(t *testing.T) {
		g := New(&failingStore{MemoryStore: NewMemoryStore(), putErr: errStore})
		tx, err := g.CreateTransaction(ctx, txRequest("GS-1"))
		testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
		testx.AssertTrue(t, errors.Is(err, errStore), "err %v", err)
		testx.AssertEqual(t, tx, payment.Transaction{})
	})
	t.Run("Status", func(t *testing.T) {
		g := New(&failingStore{MemoryStore: NewMemoryStore(), getErr: errStore})
		_, err := g.Status(ctx, "GS-1")
		testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
		testx.AssertFalse(t, errors.Is(err, payment.ErrTransactionNotFound), "err %v", err)
	})
	t.Run("Pay read", func(t *testing.T) {
		g := New(&failingStore{MemoryStore: NewMemoryStore(), getErr: errStore})
		_, err := g.Pay(ctx, "GS-1", "settlement", "")
		testx.AssertTrue(t, errors.Is(err, errStore), "err %v", err)
	})
	t.Run("Pay write", func(t *testing.T) {
		store := &failingStore{MemoryStore: NewMemoryStore()}
		g := New(store)
		_, err := g.CreateTransaction(ctx, txRequest("GS-1"))
		testx.AssertNoError(t, err)
		store.putErr = errStore
		n, err := g.Pay(ctx, "GS-1", "settlement", "")
		testx.AssertTrue(t, errors.Is(err, errStore), "err %v", err)
		testx.AssertEqual(t, n, payment.Notification{})
	})
}

func TestNotification_IsSigned(t *testing.T) {
	n := Notification("GS-9", "407", "50000.00")
	testx.AssertEqual(t, n.OrderID, "GS-9")
	testx.AssertEqual(t, n.StatusCode, "407")
	testx.AssertEqual(t, n.GrossAmount, "50000.00")
	testx.AssertEqual(t, n.SignatureKey, midtrans.Signature(ServerKey, "GS-9", "407", "50000.00"))
	testx.AssertTrue(t, New(NewMemoryStore()).VerifySignature("GS-9", "407", "50000.00", n.SignatureKey))
}

func TestGrossAmount(t *testing.T) {
	testx.AssertEqual(t, grossAmount(117000), "117000.00")
	testx.AssertEqual(t, grossAmount(0), "0.00")
	testx.AssertEqual(t, grossAmount(1), "1.00")
}

func TestMemoryStore(t *testing.T) {
	m := NewMemoryStore()
	ctx := context.Background()
	_, ok, err := m.Get(ctx, "GS-1")
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, ok)

	want := Transaction{OrderID: "GS-1", Amount: 5, Token: "fake-x", Status: "pending"}
	testx.AssertNoError(t, m.Put(ctx, want))
	got, ok, err := m.Get(ctx, "GS-1")
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, got, want)

	want.Status = "settlement"
	testx.AssertNoError(t, m.Put(ctx, want))
	got, _, _ = m.Get(ctx, "GS-1")
	testx.AssertEqual(t, got.Status, "settlement")
}
