package payment

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// reconcilePayment is an open payment n created two minutes ago.
func reconcilePayment(n int, expiresAt time.Time) Payment {
	p := testPayment()
	p.ID = fmt.Sprintf("0192f0a0-0000-7000-8000-0000000001%02d", n)
	p.ProviderOrderID = fmt.Sprintf("%s-P%05d", orderCode, n)
	p.Amount = int64(100000 + n)
	p.ExpiresAt = expiresAt
	return p
}

func TestService_Reconcile_Disabled(t *testing.T) {
	repo := &fakeRepo{}
	_, err := newTestService(repo, &fakeOrders{}, nil).Reconcile(t.Context())
	testx.AssertTrue(t, errors.Is(err, ErrDisabled), "got %v", err)
	testx.AssertEqual(t, len(repo.calls), 0)
}

func TestService_Reconcile_ListError(t *testing.T) {
	repo := &fakeRepo{toReconcileErr: errBoom}
	gw := newFakeGateway()
	res, err := newTestService(repo, &fakeOrders{}, gw).Reconcile(t.Context())
	testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
	testx.AssertEqual(t, res, ReconcileResult{})
	testx.AssertEqual(t, len(gw.statusCalls), 0)
}

// Every open payment is asked about and its answer applied as the
// reconciler's; only the outcomes that changed something count.
func TestService_Reconcile_AppliesEachAnswer(t *testing.T) {
	later := testNow.Add(30 * time.Minute)
	payments := []Payment{
		reconcilePayment(1, later), reconcilePayment(2, later), reconcilePayment(3, later),
		reconcilePayment(4, later), reconcilePayment(5, later), reconcilePayment(6, later),
	}
	repo := &fakeRepo{toReconcile: payments, outcomes: map[string]Outcome{
		payments[0].ID: OutcomePaid,
		payments[1].ID: OutcomeOrderCancelled,
		payments[2].ID: OutcomeRefundRequired,
		payments[3].ID: OutcomeRecorded,
		payments[4].ID: OutcomeDuplicate,
		payments[5].ID: OutcomeAmountMismatch,
	}}
	gw := newFakeGateway()
	gw.statuses = map[string]TransactionStatus{}
	for _, p := range payments {
		st := settlement()
		st.OrderID, st.TransactionID = p.ProviderOrderID, "tx-"+p.ProviderOrderID
		gw.statuses[p.ProviderOrderID] = st
	}
	res, err := newTestService(repo, &fakeOrders{}, gw).Reconcile(t.Context())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, res, ReconcileResult{Checked: 6, Changed: 3, Failed: 0})

	testx.AssertEqual(t, repo.toReconcileBefore, testNow.Add(-time.Minute))
	testx.AssertEqual(t, repo.toReconcileLimit, int32(100))
	testx.AssertEqual(t, len(gw.statusCalls), 6)
	testx.AssertEqual(t, len(repo.applied), 6)
	testx.AssertEqual(t, len(repo.checked), 6)
	for i, p := range payments {
		testx.AssertEqual(t, gw.statusCalls[i], p.ProviderOrderID)
		in := repo.applied[i]
		testx.AssertEqual(t, in.Payment.ID, p.ID)
		testx.AssertEqual(t, in.Source, SourceReconcile)
		testx.AssertEqual(t, in.Gateway, gw.statuses[p.ProviderOrderID])
		testx.AssertEqual(t, repo.checked[i], p.ID)
		testx.AssertEqual(t, repo.checkedAt[i], testNow)
	}
	// Each payment is applied, then marked checked.
	testx.AssertEqual(t, repo.calls[1], "Apply "+payments[0].ID)
	testx.AssertEqual(t, repo.calls[2], "MarkChecked "+payments[0].ID)
}

// One failing payment does not stop the others.
func TestService_Reconcile_FailuresContinue(t *testing.T) {
	later := testNow.Add(30 * time.Minute)
	statusFails := reconcilePayment(1, later)
	applyFails := reconcilePayment(2, later)
	markFails := reconcilePayment(3, later)
	ok := reconcilePayment(4, later)
	repo := &fakeRepo{
		toReconcile: []Payment{statusFails, applyFails, markFails, ok},
		outcome:     OutcomePaid,
		applyErrs:   map[string]error{applyFails.ID: errBoom},
		markErrs:    map[string]error{markFails.ID: errBoom},
	}
	gw := newFakeGateway()
	gw.statusErrs = map[string]error{statusFails.ProviderOrderID: fmt.Errorf("%w: 500", ErrGatewayUnavailable)}
	gw.status = TransactionStatus{TransactionID: "tx", TransactionStatus: "settlement", GrossAmount: "1.00"}

	ctx, buf := captureLogs(t)
	res, err := newTestService(repo, &fakeOrders{}, gw).Reconcile(ctx)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, res, ReconcileResult{Checked: 4, Changed: 1, Failed: 3})
	testx.AssertEqual(t, len(gw.statusCalls), 4, "every payment is asked about")
	testx.AssertEqual(t, len(repo.applied), 3, "the failed status is not applied")
	testx.AssertEqual(t, repo.applied[0].Payment.ID, applyFails.ID)
	// A failed status call and a failed apply are not marked checked: they
	// are first again next run.
	testx.AssertEqual(t, len(repo.checked), 2)
	testx.AssertEqual(t, repo.checked[0], markFails.ID)
	testx.AssertEqual(t, repo.checked[1], ok.ID)

	warns := 0
	for _, l := range parseLogs(t, buf) {
		if l["msg"] == "reconcile payment" {
			warns++
			testx.AssertEqual(t, l["level"], any("WARN"))
		}
	}
	testx.AssertEqual(t, warns, 3)
}

// A transaction the gateway does not know is closed as expired once its
// expiry has passed, and left alone before.
func TestService_Reconcile_TransactionNotFound(t *testing.T) {
	tests := []struct {
		name      string
		expiresAt time.Time
		expire    bool
	}{
		{"expiry passed", testNow.Add(-time.Second), true},
		{"expires now", testNow, true},
		{"not expired yet", testNow.Add(time.Second), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := reconcilePayment(7, tc.expiresAt)
			repo := &fakeRepo{toReconcile: []Payment{p}, outcome: OutcomeOrderCancelled}
			gw := newFakeGateway()
			gw.statusErr = fmt.Errorf("status: %w", ErrTransactionNotFound)
			s := newTestService(repo, &fakeOrders{}, gw)
			res, err := s.Reconcile(t.Context())
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(repo.checked), 1, "checked either way")
			testx.AssertEqual(t, repo.checked[0], p.ID)
			// Before expiry Snap may still start the transaction: not final.
			// After it, the synthesized expire is the last word: final.
			testx.AssertEqual(t, repo.checkedFinal[0], tc.expire, "final")
			if !tc.expire {
				testx.AssertEqual(t, len(repo.applied), 0, "nothing is applied before expiry")
				testx.AssertEqual(t, res, ReconcileResult{Checked: 1})
				outcome, err := s.reconcileOne(t.Context(), p, testNow)
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, outcome, OutcomeRecorded)
				return
			}
			testx.AssertEqual(t, res, ReconcileResult{Checked: 1, Changed: 1})
			testx.AssertEqual(t, len(repo.applied), 1)
			in := repo.applied[0]
			testx.AssertEqual(t, in.Gateway, TransactionStatus{
				OrderID: p.ProviderOrderID, StatusCode: "407", TransactionStatus: "expire", GrossAmount: "100007.00",
			})
			testx.AssertEqual(t, in.To, StatusExpired)
			testx.AssertTrue(t, in.Known)
			testx.AssertTrue(t, in.AmountMatches, "the synthesized amount is the payment's")
			testx.AssertEqual(t, in.Source, SourceReconcile)
			testx.AssertEqual(t, in.DedupeKey, "none|expire|")
		})
	}
	t.Run("mark checked fails before expiry", func(t *testing.T) {
		p := reconcilePayment(8, testNow.Add(time.Hour))
		repo := &fakeRepo{toReconcile: []Payment{p}, markErr: errBoom}
		gw := newFakeGateway()
		gw.statusErr = ErrTransactionNotFound
		res, err := newTestService(repo, &fakeOrders{}, gw).Reconcile(t.Context())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, res, ReconcileResult{Checked: 1, Failed: 1})
	})
}

// stoppableCtx is a context whose Err a test sets, for a deadline that
// passes in the middle of a run without waiting for a clock.
type stoppableCtx struct {
	context.Context
	mu  sync.Mutex
	err error
}

func (c *stoppableCtx) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err != nil {
		return c.err
	}
	return c.Context.Err()
}

func (c *stoppableCtx) stop(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.err = err
}

// stopAfterGateway calls stop once it has answered after status calls:
// the worker's job timeout ending ctx while a gateway call runs.
type stopAfterGateway struct {
	*fakeGateway
	after int
	stop  func()
}

func (g *stopAfterGateway) Status(ctx context.Context, id string) (TransactionStatus, error) {
	st, err := g.fakeGateway.Status(ctx, id)
	if g.stop != nil && len(g.statusCalls) == g.after {
		g.stop()
	}
	return st, err
}

// When ctx ends, Reconcile stops before the next payment: it does not ask
// the gateway again, does not mark the rest checked (they stay first in
// the queue), and returns what it did with ctx's error. A live ctx runs
// every payment and returns no error.
func TestService_Reconcile_StopsWhenCtxEnds(t *testing.T) {
	type run struct {
		ctx  context.Context
		stop func() // called after the gateway's stopAfter-th answer
	}
	cancelled := func(t *testing.T) run {
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		return run{ctx: ctx}
	}
	pastDeadline := func(t *testing.T) run {
		ctx, cancel := context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
		t.Cleanup(cancel)
		return run{ctx: ctx}
	}
	cancelMidRun := func(t *testing.T) run {
		ctx, cancel := context.WithCancel(t.Context())
		t.Cleanup(cancel)
		return run{ctx: ctx, stop: cancel}
	}
	deadlineMidRun := func(t *testing.T) run {
		ctx := &stoppableCtx{Context: t.Context()}
		return run{ctx: ctx, stop: func() { ctx.stop(context.DeadlineExceeded) }}
	}
	live := func(t *testing.T) run { return run{ctx: t.Context()} }

	tests := []struct {
		name       string
		payments   int
		failFirst  bool // the first payment's status call fails
		start      func(*testing.T) run
		stopAfter  int
		wantRes    ReconcileResult
		wantErrIs  error
		wantErrMsg string
	}{
		{name: "live ctx", payments: 3, start: live,
			wantRes: ReconcileResult{Checked: 3, Changed: 3}},
		{name: "cancelled before the run", payments: 3, start: cancelled,
			wantRes: ReconcileResult{}, wantErrIs: context.Canceled,
			wantErrMsg: "reconcile stopped after 0 of 3 payments: context canceled"},
		{name: "deadline passed before the run", payments: 3, start: pastDeadline,
			wantRes: ReconcileResult{}, wantErrIs: context.DeadlineExceeded,
			wantErrMsg: "reconcile stopped after 0 of 3 payments: context deadline exceeded"},
		{name: "cancelled after 2 of 4", payments: 4, start: cancelMidRun, stopAfter: 2,
			wantRes: ReconcileResult{Checked: 2, Changed: 2}, wantErrIs: context.Canceled,
			wantErrMsg: "reconcile stopped after 2 of 4 payments: context canceled"},
		{name: "deadline after 1 of 3", payments: 3, start: deadlineMidRun, stopAfter: 1,
			wantRes: ReconcileResult{Checked: 1, Changed: 1}, wantErrIs: context.DeadlineExceeded,
			wantErrMsg: "reconcile stopped after 1 of 3 payments: context deadline exceeded"},
		{name: "a failure before the cancel stays counted", payments: 4, failFirst: true, start: cancelMidRun, stopAfter: 2,
			wantRes: ReconcileResult{Checked: 2, Changed: 1, Failed: 1}, wantErrIs: context.Canceled,
			wantErrMsg: "reconcile stopped after 2 of 4 payments: context canceled"},
		{name: "cancelled during the last payment", payments: 3, start: cancelMidRun, stopAfter: 3,
			wantRes: ReconcileResult{Checked: 3, Changed: 3}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			later := testNow.Add(30 * time.Minute)
			payments := make([]Payment, tt.payments)
			for i := range payments {
				payments[i] = reconcilePayment(i+1, later)
			}
			repo := &fakeRepo{toReconcile: payments, outcome: OutcomePaid}
			fake := newFakeGateway()
			if tt.failFirst {
				fake.statusErrs = map[string]error{payments[0].ProviderOrderID: fmt.Errorf("%w: 500", ErrGatewayUnavailable)}
			}
			r := tt.start(t)
			gw := &stopAfterGateway{fakeGateway: fake, after: tt.stopAfter, stop: r.stop}
			s := NewService(Deps{Repo: repo, Orders: &fakeOrders{}, Gateway: gw, Clock: func() time.Time { return testNow }})

			res, err := s.Reconcile(r.ctx)
			testx.AssertEqual(t, res, tt.wantRes)
			if tt.wantErrIs == nil {
				testx.AssertNoError(t, err)
			} else {
				if err == nil {
					t.Fatalf("err = nil, want %v; result %+v", tt.wantErrIs, res)
				}
				testx.AssertTrue(t, errors.Is(err, tt.wantErrIs), "err = %v, want %v", err, tt.wantErrIs)
				testx.AssertEqual(t, err.Error(), tt.wantErrMsg)
			}

			// Only the payments reached were asked about, and in order.
			testx.AssertEqual(t, len(fake.statusCalls), tt.wantRes.Checked, "gateway calls %v", fake.statusCalls)
			for i, id := range fake.statusCalls {
				testx.AssertEqual(t, id, payments[i].ProviderOrderID)
			}
			// The payments not reached are never marked checked.
			wantMarked := tt.wantRes.Checked - tt.wantRes.Failed
			testx.AssertEqual(t, len(repo.checked), wantMarked, "marked %v", repo.checked)
			for _, p := range payments[tt.wantRes.Checked:] {
				for _, id := range repo.checked {
					testx.AssertNotEqual(t, id, p.ID, "an unreached payment was marked checked")
				}
				for _, in := range repo.applied {
					testx.AssertNotEqual(t, in.Payment.ID, p.ID, "an unreached payment was applied")
				}
			}
			testx.AssertEqual(t, repo.calls[0], "ToReconcile")
		})
	}
}
