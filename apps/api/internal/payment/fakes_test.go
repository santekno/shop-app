package payment

import (
	"context"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/order"
)

// Shared fixtures and fakes of the payment tests (first needed by Bab 6
// artikel 02: the pay endpoint).

var testNow = time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)

const (
	buyerID   = "0192f0a0-0000-7000-8000-000000000001"
	orderID   = "0192f0a0-0000-7000-8000-0000000000a1"
	paymentID = "0192f0a0-0000-7000-8000-0000000000b1"
	orderCode = "GS-20261023-ABC123"
	// providerOrderID is the gateway's order_id of testPayment.
	providerOrderID = orderCode + "-K3D9QX"
)

// pendingOrder is the buyer's order waiting for payment of 117000, due in
// an hour.
func pendingOrder() order.Order {
	return order.Order{
		ID: orderID, Code: orderCode, UserID: buyerID, Status: order.StatusPendingPayment,
		Totals:           order.Totals{Subtotal: 120000, Discount: 12000, ShippingFee: 9000, Total: 117000},
		PaymentExpiresAt: testNow.Add(time.Hour),
	}
}

// testPayment is the open payment of pendingOrder.
func testPayment() Payment {
	return Payment{
		ID: paymentID, OrderID: orderID, Provider: "midtrans", ProviderOrderID: providerOrderID,
		Amount: 117000, Status: StatusPending, Token: "snap-token-1", RedirectURL: "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-1",
		ExpiresAt: testNow.Add(59 * time.Minute), CreatedAt: testNow.Add(-time.Minute), UpdatedAt: testNow.Add(-time.Minute),
	}
}

// settlement is the gateway's status of a paid testPayment.
func settlement() TransactionStatus {
	return TransactionStatus{
		OrderID: providerOrderID, StatusCode: "200", TransactionID: "tx-1", TransactionStatus: "settlement",
		PaymentType: "bank_transfer", GrossAmount: "117000.00",
	}
}

// fakeGateway is a Gateway that answers from its fields and records calls.
type fakeGateway struct {
	name      string
	clientKey string
	// serverKey is never handed to anything; the log tests check it never
	// shows up.
	serverKey string

	tx         Transaction
	createErr  error
	createReqs []TransactionRequest

	status      TransactionStatus
	statusErr   error
	statuses    map[string]TransactionStatus // by order_id, before status
	statusErrs  map[string]error             // by order_id, before statusErr
	statusCalls []string

	valid       bool
	verifyCalls [][4]string
}

func newFakeGateway() *fakeGateway {
	return &fakeGateway{
		name: "midtrans", clientKey: "SB-Mid-client-abc", serverKey: "SB-Mid-server-SECRET",
		tx:     Transaction{Token: "snap-token-new", RedirectURL: "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-new"},
		status: settlement(), valid: true,
	}
}

func (g *fakeGateway) Name() string      { return g.name }
func (g *fakeGateway) ClientKey() string { return g.clientKey }

func (g *fakeGateway) CreateTransaction(_ context.Context, req TransactionRequest) (Transaction, error) {
	g.createReqs = append(g.createReqs, req)
	if g.createErr != nil {
		return Transaction{}, g.createErr
	}
	return g.tx, nil
}

func (g *fakeGateway) Status(_ context.Context, id string) (TransactionStatus, error) {
	g.statusCalls = append(g.statusCalls, id)
	if err, ok := g.statusErrs[id]; ok {
		return TransactionStatus{}, err
	}
	if st, ok := g.statuses[id]; ok {
		return st, nil
	}
	return g.status, g.statusErr
}

func (g *fakeGateway) VerifySignature(orderID, statusCode, grossAmount, signature string) bool {
	g.verifyCalls = append(g.verifyCalls, [4]string{orderID, statusCode, grossAmount, signature})
	return g.valid
}

// openAnswer is one answer of fakeRepo.OpenPayment.
type openAnswer struct {
	p   Payment
	ok  bool
	err error
}

// fakeRepo is a Repository that answers from its fields and records calls.
type fakeRepo struct {
	calls []string

	open []openAnswer // used in order; the last one repeats

	insertOK  bool
	insertErr error
	inserted  []Payment

	byProvider    Payment
	byProviderErr error

	outcome   Outcome
	outcomes  map[string]Outcome // by payment ID, before outcome
	applyErr  error
	applyErrs map[string]error // by payment ID, before applyErr
	applied   []ApplyInput

	toReconcile       []Payment
	toReconcileErr    error
	toReconcileBefore time.Time
	toReconcileLimit  int32

	markErr   error
	markErrs  map[string]error
	checked   []string
	checkedAt []time.Time
	// checkedFinal is MarkChecked's final argument, call by call.
	checkedFinal []bool
}

func (r *fakeRepo) OpenPayment(_ context.Context, id string) (Payment, bool, error) {
	r.calls = append(r.calls, "OpenPayment "+id)
	if len(r.open) == 0 {
		return Payment{}, false, nil
	}
	a := r.open[0]
	if len(r.open) > 1 {
		r.open = r.open[1:]
	}
	return a.p, a.ok, a.err
}

func (r *fakeRepo) Insert(_ context.Context, p Payment) (bool, error) {
	r.calls = append(r.calls, "Insert")
	r.inserted = append(r.inserted, p)
	return r.insertOK, r.insertErr
}

func (r *fakeRepo) ByProviderOrderID(_ context.Context, id string) (Payment, error) {
	r.calls = append(r.calls, "ByProviderOrderID "+id)
	return r.byProvider, r.byProviderErr
}

func (r *fakeRepo) Apply(_ context.Context, in ApplyInput) (Outcome, error) {
	r.calls = append(r.calls, "Apply "+in.Payment.ID)
	r.applied = append(r.applied, in)
	if err, ok := r.applyErrs[in.Payment.ID]; ok {
		return "", err
	}
	if o, ok := r.outcomes[in.Payment.ID]; ok {
		return o, nil
	}
	return r.outcome, r.applyErr
}

func (r *fakeRepo) ToReconcile(_ context.Context, createdBefore time.Time, limit int32) ([]Payment, error) {
	r.calls = append(r.calls, "ToReconcile")
	r.toReconcileBefore, r.toReconcileLimit = createdBefore, limit
	return r.toReconcile, r.toReconcileErr
}

func (r *fakeRepo) MarkChecked(_ context.Context, id string, now time.Time, final bool) error {
	r.calls = append(r.calls, "MarkChecked "+id)
	r.checked = append(r.checked, id)
	r.checkedAt = append(r.checkedAt, now)
	r.checkedFinal = append(r.checkedFinal, final)
	if err, ok := r.markErrs[id]; ok {
		return err
	}
	return r.markErr
}

// orderAnswer is one answer of fakeOrders.Get.
type orderAnswer struct {
	o   order.Order
	err error
}

// fakeOrders is Orders answering from a queue; the last answer repeats.
type fakeOrders struct {
	answers []orderAnswer
	calls   []string
}

func (f *fakeOrders) Get(_ context.Context, userID, id string) (order.Order, error) {
	f.calls = append(f.calls, userID+" "+id)
	if len(f.answers) == 0 {
		return order.Order{}, order.ErrNotFound
	}
	a := f.answers[0]
	if len(f.answers) > 1 {
		f.answers = f.answers[1:]
	}
	return a.o, a.err
}

// newTestService is a Service on repo, orders and gw at testNow.
func newTestService(repo *fakeRepo, orders *fakeOrders, gw *fakeGateway) *Service {
	deps := Deps{Repo: repo, Orders: orders, Clock: func() time.Time { return testNow }}
	if gw != nil {
		deps.Gateway = gw
	}
	return NewService(deps)
}
