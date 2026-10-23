package order

import (
	"context"
	"sync"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/address"
	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// fakeRepo is a Repository that records what the service asked for and
// answers from its fields.
type fakeRepo struct {
	mu    sync.Mutex
	calls []string

	voucher    Voucher
	voucherErr error
	uses       int64
	usesErr    error

	placed   []PlaceInput
	placeErr error
	placeOut Response

	claim      claimResult
	claimErr   error
	claimNow   time.Time
	claimIdem  Idempotency
	released   []string
	releaseCtx context.Context
	releaseErr error

	deleted    []int64 // what each DeleteExpiredKeys call returns
	deleteErr  error
	deleteNows []time.Time

	order    Order
	getErr   error
	getUsers []string

	changes       []Change
	transitionErr func(c Change) error

	expired    [][]string // one batch per call
	expiredErr error
	expiredAt  []time.Time

	listStatus  []StatusQuery
	listHistory []HistoryQuery
	listOut     []Order
	listErr     error
}

func (f *fakeRepo) record(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, name)
}

func (f *fakeRepo) VoucherByCode(_ context.Context, code string) (Voucher, error) {
	f.record("VoucherByCode " + code)
	return f.voucher, f.voucherErr
}

func (f *fakeRepo) VoucherUses(_ context.Context, voucherID, userID string) (int64, error) {
	f.record("VoucherUses " + voucherID + " " + userID)
	return f.uses, f.usesErr
}

func (f *fakeRepo) Place(_ context.Context, in PlaceInput) (Response, error) {
	f.record("Place")
	f.placed = append(f.placed, in)
	return f.placeOut, f.placeErr
}

func (f *fakeRepo) ClaimKey(_ context.Context, userID string, idem Idempotency, now time.Time) (claimResult, error) {
	f.record("ClaimKey " + userID)
	f.claimIdem, f.claimNow = idem, now
	return f.claim, f.claimErr
}

func (f *fakeRepo) ReleaseKey(ctx context.Context, userID, key, _ string) error {
	f.record("ReleaseKey " + userID)
	f.released = append(f.released, key)
	f.releaseCtx = ctx
	return f.releaseErr
}

func (f *fakeRepo) DeleteExpiredKeys(_ context.Context, now time.Time, limit int32) (int64, error) {
	f.record("DeleteExpiredKeys")
	f.deleteNows = append(f.deleteNows, now)
	if limit != KeyCleanupBatch {
		panic("unexpected batch size")
	}
	if len(f.deleted) == 0 {
		return 0, f.deleteErr
	}
	n := f.deleted[0]
	f.deleted = f.deleted[1:]
	if len(f.deleted) == 0 && f.deleteErr != nil {
		return n, f.deleteErr
	}
	return n, nil
}

func (f *fakeRepo) Get(_ context.Context, userID, id string) (Order, error) {
	f.record("Get " + id)
	f.getUsers = append(f.getUsers, userID)
	o := f.order
	o.ID = id
	return o, f.getErr
}

func (f *fakeRepo) Transition(_ context.Context, c Change) error {
	f.record("Transition " + c.OrderID)
	f.changes = append(f.changes, c)
	if f.transitionErr != nil {
		return f.transitionErr(c)
	}
	return nil
}

func (f *fakeRepo) ExpiredOrderIDs(_ context.Context, now time.Time, limit int32) ([]string, error) {
	f.record("ExpiredOrderIDs")
	f.expiredAt = append(f.expiredAt, now)
	if limit != ExpireBatchSize {
		panic("unexpected batch size")
	}
	if f.expiredErr != nil {
		return nil, f.expiredErr
	}
	if len(f.expired) == 0 {
		return nil, nil
	}
	ids := f.expired[0]
	f.expired = f.expired[1:]
	return ids, nil
}

func (f *fakeRepo) GetAny(_ context.Context, id string) (Order, error) {
	f.record("GetAny " + id)
	o := f.order
	o.ID = id
	return o, f.getErr
}

func (f *fakeRepo) ListByStatus(_ context.Context, q StatusQuery) ([]Order, error) {
	f.record("ListByStatus")
	f.listStatus = append(f.listStatus, q)
	return f.listOut, f.listErr
}

func (f *fakeRepo) ListForUser(_ context.Context, q HistoryQuery) ([]Order, error) {
	f.record("ListForUser")
	f.listHistory = append(f.listHistory, q)
	return f.listOut, f.listErr
}

// fakeCarts answers Get with its cart.
type fakeCarts struct {
	cart   cart.Cart
	err    error
	owners []cart.Owner
}

func (f *fakeCarts) Get(_ context.Context, owner cart.Owner) (cart.Cart, error) {
	f.owners = append(f.owners, owner)
	return f.cart, f.err
}

// fakeAddresses holds the buyer's one address.
type fakeAddresses struct {
	err   error
	asked [][2]string
}

func testAddress() address.Address {
	return address.Address{
		ID: addressID, RecipientName: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1",
		City: "Bandung", Province: "Jawa Barat", PostalCode: "40111",
	}
}

func (f *fakeAddresses) Get(_ context.Context, userID, id string) (address.Address, error) {
	f.asked = append(f.asked, [2]string{userID, id})
	if f.err != nil {
		return address.Address{}, f.err
	}
	if userID != buyerID || id != addressID {
		return address.Address{}, address.ErrNotFound
	}
	return testAddress(), nil
}

// fakeProvider answers every quote with quotes (shipping.Static's by
// default) and records the requests.
type fakeProvider struct {
	quotes   []shipping.Quote
	err      error
	requests []shipping.Request
}

func (p *fakeProvider) Name() string { return "fake" }

func (p *fakeProvider) Quote(ctx context.Context, req shipping.Request) ([]shipping.Quote, error) {
	p.requests = append(p.requests, req)
	if p.err != nil {
		return nil, p.err
	}
	if p.quotes != nil {
		return p.quotes, nil
	}
	return shipping.Static{}.Quote(ctx, req)
}

// serviceEnv is a Service on fakes, at a fixed clock.
type serviceEnv struct {
	repo      *fakeRepo
	carts     *fakeCarts
	addresses *fakeAddresses
	provider  *fakeProvider
	svc       *Service
}

func newServiceEnv(lines ...cart.Line) *serviceEnv {
	env := &serviceEnv{
		repo: &fakeRepo{}, carts: &fakeCarts{cart: cart.Cart{Lines: lines}},
		addresses: &fakeAddresses{}, provider: &fakeProvider{},
	}
	env.svc = NewService(Deps{
		Repo: env.repo, Carts: env.carts, Addresses: env.addresses, Shipping: env.provider,
		OriginPostalCode: "40115", Clock: func() time.Time { return testTime }, PaymentTTL: time.Hour,
	})
	return env
}
