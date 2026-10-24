package payment

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/santekno/sdk/logx"
)

// Reconciliation (ADR 0007): a notification can be lost (GoShop was down
// for longer than Midtrans retries), so the reconciler asks the gateway
// about every open payment and applies the answer with Apply, exactly as
// the webhook does.

// ReconcileBatchSize is how many open payments one run asks about, one
// gateway call each; closed ones get a quarter of it more (closedShare).
const ReconcileBatchSize = 100

// reconcileGrace is how old a payment must be before the reconciler asks
// about it: a fresh one is still waiting for its first notification.
const reconcileGrace = time.Minute

// closedWindow is how long after its Snap expiry a payment GoShop closed
// itself (cancelled, when its order closed) is still taken to be able to
// take money: Midtrans was never told, so it accepts payment until
// expires_at, and the margin covers a settlement at the last second and
// clocks that disagree. Once that window has ended, a closed payment that
// has not been checked since is due at once; after that the reconciler
// keeps asking every closedRecheck until it gets a final answer (Final),
// however long a backlog makes it wait. A settlement found is applied like the webhook's:
// paid, and flagged for a refund, because the order is closed.
const closedWindow = 10 * time.Minute

// closedRecheck is how often, at most, the reconciler asks again about a
// payment GoShop closed. Such a payment rarely takes money, and the
// reconciler's batch belongs first to the open ones, whose orders are
// still waiting; every 30 minutes still catches a lost settlement well
// before anyone refunds by hand.
const closedRecheck = 30 * time.Minute

// closedShare sets the closed payments' own budget per run: a quarter of
// the open ones' (25 for ReconcileBatchSize), on top of it, so a long
// queue of open payments never stops the closed ones being asked about,
// and a backlog of closed ones never delays an open one.
const closedShare = 4

// ReconcileResult is what one run did.
type ReconcileResult struct {
	// Checked is how many payments the gateway was asked about.
	Checked int
	// Changed is how many of them changed an order (paid, cancelled) or
	// were flagged for a refund.
	Changed int
	// Failed is how many asks failed; they are tried again next run.
	Failed int
}

// Reconcile asks the gateway about the payments that may still take
// money, the least recently checked first, and applies each answer: up to
// ReconcileBatchSize open ones, and up to a quarter of that of the ones
// GoShop closed with their order, each until a check gets a final answer
// (Final), so money that arrives without a notification is never lost: a
// backlog is delayed, not dropped. A transaction the gateway does not know (the buyer never
// chose how to pay) is closed as expired once its expiry has passed. One
// failing payment does not stop the others. When ctx ends (the worker's
// job timeout), it stops before the next payment and returns what it did
// with ctx's error: the gateway calls ignore ctx's end, so without the
// check one slow run would overlap the next. The payments not asked about
// keep their place at the front of the queue. `api reconcile-payments`
// runs it once; the worker every 5 minutes.
func (s *Service) Reconcile(ctx context.Context) (ReconcileResult, error) {
	if s.gateway == nil {
		return ReconcileResult{}, ErrDisabled
	}
	now := s.now()
	payments, err := s.repo.ToReconcile(ctx, now.Add(-reconcileGrace), ReconcileBatchSize)
	if err != nil {
		return ReconcileResult{}, err
	}
	var res ReconcileResult
	for _, p := range payments {
		if err := ctx.Err(); err != nil {
			return res, fmt.Errorf("reconcile stopped after %d of %d payments: %w", res.Checked, len(payments), err)
		}
		outcome, err := s.reconcileOne(ctx, p, now)
		res.Checked++
		if err != nil {
			res.Failed++
			logx.FromContext(ctx).Warn("reconcile payment", "payment_id", p.ID, "error", err.Error())
			continue
		}
		if outcome == OutcomePaid || outcome == OutcomeOrderCancelled || outcome == OutcomeRefundRequired {
			res.Changed++
		}
	}
	return res, nil
}

// reconcileOne asks about p and applies the answer, then records that p
// was checked, so the next run starts with the others.
func (s *Service) reconcileOne(ctx context.Context, p Payment, now time.Time) (Outcome, error) {
	st, err := s.gateway.Status(ctx, p.ProviderOrderID)
	switch {
	case errors.Is(err, ErrTransactionNotFound) && !now.Before(p.ExpiresAt):
		// No transaction was ever started, and Snap no longer would:
		// nothing will ever notify about it. Close it as expired.
		st = TransactionStatus{
			OrderID: p.ProviderOrderID, StatusCode: "407", TransactionStatus: "expire",
			GrossAmount: strconv.FormatInt(p.Amount, 10) + ".00",
		}
	case errors.Is(err, ErrTransactionNotFound):
		// Not started yet, and Snap may still start it: not final.
		return OutcomeRecorded, s.repo.MarkChecked(ctx, p.ID, now, false)
	case err != nil:
		// No answer: checked_at stays, so the payment is asked about again
		// in the next run.
		return "", fmt.Errorf("payment status: %w", err)
	}
	outcome, err := s.Apply(ctx, p, st, SourceReconcile)
	if err != nil {
		return "", err
	}
	// An answer whose amount is not the payment's changed nothing, so it
	// settles nothing either: the payment stays queued.
	return outcome, s.repo.MarkChecked(ctx, p.ID, now, Final(st) && outcome != OutcomeAmountMismatch)
}

// Final reports whether st is an answer after which the transaction takes
// no money GoShop would not hear about: settled (or an accepted card
// capture), expired, denied, cancelled, failed, or refunded. Pending, a
// card capture under a fraud challenge, or a status GoShop does not know
// is not final: Midtrans may still move it, so the reconciler asks again.
func Final(st TransactionStatus) bool {
	to, known := StatusOf(st.TransactionStatus, st.FraudStatus)
	return known && to != StatusPending && to != StatusChallenge
}
