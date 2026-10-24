package payment

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/order"
)

var errBoom = errors.New("boom")

// providerOrderIDPattern is the order code, a dash and 6 characters of
// Crockford's base32 (no I, L, O, U).
var providerOrderIDPattern = regexp.MustCompile(`^` + regexp.QuoteMeta(orderCode) + `-[0-9A-HJKMNP-TV-Z]{6}$`)

func TestSnapMinutes(t *testing.T) {
	testx.AssertEqual(t, expiryMargin, time.Minute)
	tests := []struct {
		name string
		left time.Duration
		want int
	}{
		{"an hour", time.Hour, 59},
		{"30m30s rounds down", 30*time.Minute + 30*time.Second, 29},
		{"exactly 2 minutes", 2 * time.Minute, 1},
		{"1m59s", 2*time.Minute - time.Second, 0},
		{"exactly the margin", time.Minute, 0},
		{"past the deadline", -5 * time.Minute, -6},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			testx.AssertEqual(t, snapMinutes(testNow, testNow.Add(tc.left)), tc.want)
		})
	}
}

func TestNewProviderOrderID(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		id, err := newProviderOrderID(orderCode)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, providerOrderIDPattern.MatchString(id), "%q is not <code>-<6 Crockford chars>", id)
		testx.AssertFalse(t, seen[id], "%q repeated", id)
		seen[id] = true
	}
	testx.AssertEqual(t, len(providerAlphabet), 32)
}

func TestService_EnabledAndClientKey(t *testing.T) {
	off := newTestService(&fakeRepo{}, &fakeOrders{}, nil)
	testx.AssertFalse(t, off.Enabled())
	testx.AssertEqual(t, off.ClientKey(), "")

	on := newTestService(&fakeRepo{}, &fakeOrders{}, newFakeGateway())
	testx.AssertTrue(t, on.Enabled())
	testx.AssertEqual(t, on.ClientKey(), "SB-Mid-client-abc")

	// No clock: time.Now.
	s := NewService(Deps{})
	testx.AssertTrue(t, time.Since(s.now()) < time.Minute)
}

func TestService_Pay_Disabled(t *testing.T) {
	orders := &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}
	repo := &fakeRepo{}
	s := newTestService(repo, orders, nil)
	_, created, err := s.Pay(t.Context(), buyerID, orderID)
	testx.AssertTrue(t, errors.Is(err, ErrDisabled), "got %v", err)
	testx.AssertFalse(t, created)
	testx.AssertEqual(t, len(orders.calls), 0, "no order is read")
	testx.AssertEqual(t, len(repo.calls), 0)
}

func TestService_Pay_OrderErrors(t *testing.T) {
	paid := pendingOrder()
	paid.Status = order.StatusPaid
	tests := []struct {
		name   string
		answer orderAnswer
		check  func(t *testing.T, err error)
	}{
		{"not found", orderAnswer{err: order.ErrNotFound}, func(t *testing.T, err error) {
			testx.AssertTrue(t, errors.Is(err, ErrOrderNotFound), "got %v", err)
		}},
		{"wrapped not found", orderAnswer{err: fmt.Errorf("get: %w", order.ErrNotFound)}, func(t *testing.T, err error) {
			testx.AssertTrue(t, errors.Is(err, ErrOrderNotFound), "got %v", err)
		}},
		{"read fails", orderAnswer{err: errBoom}, func(t *testing.T, err error) {
			testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
			testx.AssertFalse(t, errors.Is(err, ErrOrderNotFound))
			testx.AssertContains(t, err.Error(), "pay order "+orderID)
		}},
		{"already paid", orderAnswer{o: paid}, func(t *testing.T, err error) {
			var np *NotPayableError
			testx.AssertTrue(t, errors.As(err, &np), "got %v", err)
			testx.AssertEqual(t, np.Status, "paid")
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gw := newFakeGateway()
			repo := &fakeRepo{}
			orders := &fakeOrders{answers: []orderAnswer{tc.answer}}
			p, created, err := newTestService(repo, orders, gw).Pay(t.Context(), buyerID, orderID)
			tc.check(t, err)
			testx.AssertEqual(t, p.ID, "")
			testx.AssertFalse(t, created)
			testx.AssertEqual(t, orders.calls[0], buyerID+" "+orderID, "the buyer's own order is read")
			testx.AssertEqual(t, len(gw.createReqs), 0)
			testx.AssertEqual(t, len(repo.calls), 0)
		})
	}
}

// Paying twice returns the open payment; no second gateway transaction.
func TestService_Pay_ReusesOpenPayment(t *testing.T) {
	open := testPayment()
	open.ExpiresAt = testNow.Add(time.Second)
	gw := newFakeGateway()
	repo := &fakeRepo{open: []openAnswer{{p: open, ok: true}}}
	p, created, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}, gw).
		Pay(t.Context(), buyerID, orderID)
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, created)
	testx.AssertEqual(t, p.ID, open.ID)
	testx.AssertEqual(t, p.Token, open.Token)
	testx.AssertEqual(t, len(gw.createReqs), 0)
	testx.AssertEqual(t, len(repo.calls), 1)
	testx.AssertEqual(t, repo.calls[0], "OpenPayment "+orderID)
}

// An open payment the gateway no longer takes money for is not handed out
// again: a new transaction is created.
func TestService_Pay_OpenPaymentExpired(t *testing.T) {
	for _, expires := range []time.Time{testNow, testNow.Add(-time.Minute)} {
		open := testPayment()
		open.ExpiresAt = expires
		gw := newFakeGateway()
		repo := &fakeRepo{open: []openAnswer{{p: open, ok: true}}, insertOK: true}
		p, created, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}, gw).
			Pay(t.Context(), buyerID, orderID)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, created, "expires %v", expires)
		testx.AssertNotEqual(t, p.ID, open.ID)
		testx.AssertEqual(t, p.Token, "snap-token-new")
		testx.AssertEqual(t, len(gw.createReqs), 1)
	}
}

// A new payment charges the order's total, until a minute before the
// order's deadline.
func TestService_Pay_CreatesPayment(t *testing.T) {
	gw := newFakeGateway()
	repo := &fakeRepo{insertOK: true}
	o := pendingOrder()
	p, created, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: o}}}, gw).Pay(t.Context(), buyerID, orderID)
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, created)

	testx.AssertEqual(t, len(gw.createReqs), 1)
	req := gw.createReqs[0]
	testx.AssertEqual(t, req.Amount, int64(117000))
	testx.AssertEqual(t, req.Minutes, 59)
	testx.AssertEqual(t, req.Start, testNow)
	testx.AssertTrue(t, providerOrderIDPattern.MatchString(req.OrderID), "order_id %q", req.OrderID)

	testx.AssertTrue(t, uuidx.IsValidUUID(p.ID), "id %q", p.ID)
	testx.AssertEqual(t, p.OrderID, orderID)
	testx.AssertEqual(t, p.Provider, "midtrans")
	testx.AssertEqual(t, p.ProviderOrderID, req.OrderID)
	testx.AssertEqual(t, p.Amount, int64(117000))
	testx.AssertEqual(t, p.Status, StatusPending)
	testx.AssertEqual(t, p.Token, "snap-token-new")
	testx.AssertEqual(t, p.RedirectURL, gw.tx.RedirectURL)
	testx.AssertEqual(t, p.ExpiresAt, testNow.Add(59*time.Minute))
	testx.AssertEqual(t, p.CreatedAt, testNow)
	testx.AssertEqual(t, p.UpdatedAt, testNow)

	testx.AssertEqual(t, len(repo.inserted), 1)
	testx.AssertEqual(t, repo.inserted[0].ID, p.ID)
	testx.AssertEqual(t, repo.inserted[0].ProviderOrderID, p.ProviderOrderID)
	testx.AssertEqual(t, len(repo.calls), 2)
	testx.AssertEqual(t, repo.calls[0], "OpenPayment "+orderID)
	testx.AssertEqual(t, repo.calls[1], "Insert")

	// The provider is the gateway's name.
	fake := newFakeGateway()
	fake.name = "fake"
	p, _, err = newTestService(&fakeRepo{insertOK: true}, &fakeOrders{answers: []orderAnswer{{o: o}}}, fake).
		Pay(t.Context(), buyerID, orderID)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, p.Provider, "fake")
}

// Fewer than two minutes before the deadline, no transaction is created.
func TestService_Pay_Window(t *testing.T) {
	tests := []struct {
		name    string
		left    time.Duration
		minutes int // 0: window closed
	}{
		{"2m0s left", 2 * time.Minute, 1},
		{"1m59s left", 2*time.Minute - time.Second, 0},
		{"1m left", time.Minute, 0},
		{"deadline passed", -time.Minute, 0},
		{"30m30s left", 30*time.Minute + 30*time.Second, 29},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			o := pendingOrder()
			o.PaymentExpiresAt = testNow.Add(tc.left)
			gw := newFakeGateway()
			repo := &fakeRepo{insertOK: true}
			p, created, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: o}}}, gw).Pay(t.Context(), buyerID, orderID)
			if tc.minutes == 0 {
				testx.AssertTrue(t, errors.Is(err, ErrWindowClosed), "got %v", err)
				testx.AssertFalse(t, created)
				testx.AssertEqual(t, len(gw.createReqs), 0, "the gateway is not called")
				testx.AssertEqual(t, len(repo.inserted), 0)
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertTrue(t, created)
			testx.AssertEqual(t, gw.createReqs[0].Minutes, tc.minutes)
			testx.AssertEqual(t, p.ExpiresAt, testNow.Add(time.Duration(tc.minutes)*time.Minute))
		})
	}
}

func TestService_Pay_Failures(t *testing.T) {
	t.Run("gateway fails", func(t *testing.T) {
		gw := newFakeGateway()
		gw.createErr = fmt.Errorf("%w: timeout", ErrGatewayUnavailable)
		repo := &fakeRepo{insertOK: true}
		_, created, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}, gw).Pay(t.Context(), buyerID, orderID)
		testx.AssertTrue(t, errors.Is(err, ErrGatewayUnavailable), "got %v", err)
		testx.AssertContains(t, err.Error(), "pay order "+orderID)
		testx.AssertFalse(t, created)
		testx.AssertEqual(t, len(repo.inserted), 0, "nothing is stored")
	})
	t.Run("open payment query fails", func(t *testing.T) {
		gw := newFakeGateway()
		repo := &fakeRepo{open: []openAnswer{{err: errBoom}}}
		_, _, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}, gw).Pay(t.Context(), buyerID, orderID)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "pay order "+orderID)
		testx.AssertEqual(t, len(gw.createReqs), 0)
	})
	t.Run("insert fails", func(t *testing.T) {
		gw := newFakeGateway()
		repo := &fakeRepo{insertErr: errBoom}
		p, created, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}, gw).Pay(t.Context(), buyerID, orderID)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "pay order "+orderID)
		testx.AssertFalse(t, created)
		testx.AssertEqual(t, p.ID, "")
	})
}

// Two pays race: the loser's insert stores nothing.
func TestService_Pay_LostInsertRace(t *testing.T) {
	t.Run("the winner's payment is returned", func(t *testing.T) {
		winner := testPayment()
		winner.ID = "0192f0a0-0000-7000-8000-0000000000c9"
		gw := newFakeGateway()
		repo := &fakeRepo{open: []openAnswer{{}, {p: winner, ok: true}}, insertOK: false}
		p, created, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}, gw).Pay(t.Context(), buyerID, orderID)
		testx.AssertNoError(t, err)
		testx.AssertFalse(t, created)
		testx.AssertEqual(t, p.ID, winner.ID)
		testx.AssertEqual(t, len(repo.calls), 3)
		testx.AssertEqual(t, repo.calls[2], "OpenPayment "+orderID)
	})
	t.Run("the order stopped waiting for payment", func(t *testing.T) {
		cancelled := pendingOrder()
		cancelled.Status = order.StatusCancelled
		orders := &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}, {o: cancelled}}}
		repo := &fakeRepo{insertOK: false}
		_, created, err := newTestService(repo, orders, newFakeGateway()).Pay(t.Context(), buyerID, orderID)
		var np *NotPayableError
		testx.AssertTrue(t, errors.As(err, &np), "got %v", err)
		testx.AssertEqual(t, np.Status, "cancelled")
		testx.AssertFalse(t, created)
		testx.AssertEqual(t, len(orders.calls), 2, "the order is read again")
		// The insert stored nothing (0 rows), so there is nothing to close.
		testx.AssertEqual(t, strings.Join(repo.calls, ","), "OpenPayment "+orderID+",Insert,OpenPayment "+orderID)
		testx.AssertEqual(t, len(repo.inserted), 1)
	})
	t.Run("the second open payment query fails", func(t *testing.T) {
		repo := &fakeRepo{open: []openAnswer{{}, {err: errBoom}}, insertOK: false}
		_, _, err := newTestService(repo, &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}}}, newFakeGateway()).Pay(t.Context(), buyerID, orderID)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "pay order "+orderID)
	})
	t.Run("the second order read fails", func(t *testing.T) {
		orders := &fakeOrders{answers: []orderAnswer{{o: pendingOrder()}, {err: errBoom}}}
		_, _, err := newTestService(&fakeRepo{}, orders, newFakeGateway()).Pay(t.Context(), buyerID, orderID)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "pay order "+orderID)
	})
}
