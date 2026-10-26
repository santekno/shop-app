package payment

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/moneyx"
)

// Outcome is what GoShop did with one status from the gateway; the
// payment_events_outcome_check values, plus OutcomeDuplicate, which is not
// stored.
type Outcome string

// The outcomes.
const (
	// OutcomePaid: the payment and its order are paid.
	OutcomePaid Outcome = "paid"
	// OutcomeOrderCancelled: the payment expired, and the unpaid order
	// was cancelled with its stock returned.
	OutcomeOrderCancelled Outcome = "order_cancelled"
	// OutcomeRefundRequired: money arrived for an order that can no
	// longer be paid; the order was left alone (Bab 6 artikel 03).
	OutcomeRefundRequired Outcome = "refund_required"
	// OutcomeAmountMismatch: the gateway reports another amount than the
	// payment's; nothing was changed.
	OutcomeAmountMismatch Outcome = "amount_mismatch"
	// OutcomeRecorded: the status was recorded; the order did not change.
	OutcomeRecorded Outcome = "recorded"
	// OutcomeDuplicate: this status was handled before; nothing happened.
	OutcomeDuplicate Outcome = "duplicate"
)

// Where a status came from: payment_events_source_check.
const (
	SourceWebhook   = "webhook"
	SourceReconcile = "reconcile"
)

// Notification is the part of a gateway notification GoShop reads: what
// it needs to check the signature and find the payment. Everything else
// comes from the gateway's status API.
type Notification struct {
	OrderID      string `json:"order_id"`
	StatusCode   string `json:"status_code"`
	GrossAmount  string `json:"gross_amount"`
	SignatureKey string `json:"signature_key"`
}

// HandleNotification is the payment webhook (ADR 0007): it checks n's
// signature, finds the payment, asks the gateway for the transaction's
// current status, and applies that status. Errors: ErrDisabled,
// ErrInvalidSignature, ErrPaymentNotFound, ErrGatewayUnavailable.
func (s *Service) HandleNotification(ctx context.Context, n Notification) (Outcome, error) {
	if s.gateway == nil {
		return "", ErrDisabled
	}
	if !s.gateway.VerifySignature(n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey) {
		return "", ErrInvalidSignature
	}
	p, err := s.repo.ByProviderOrderID(ctx, n.OrderID)
	if err != nil {
		return "", err
	}
	st, err := s.gateway.Status(ctx, n.OrderID)
	if errors.Is(err, ErrTransactionNotFound) {
		// A signed notification for a transaction the status API does not
		// know yet: answer an error, so the gateway sends it again later.
		return "", fmt.Errorf("%w: %w", ErrGatewayUnavailable, err)
	}
	if err != nil {
		return "", fmt.Errorf("payment %s status: %w", p.ID, err)
	}
	return s.Apply(ctx, p, st, SourceWebhook)
}

// Apply acts on st, the gateway's current status of payment p, in one
// transaction (ADR 0007): a guarded change of the payment's status, then
// the order's (paid, or cancelled when the payment expired), then a
// payment_events row. A status seen before is OutcomeDuplicate and
// changes nothing; an amount that is not the payment's changes nothing.
func (s *Service) Apply(ctx context.Context, p Payment, st TransactionStatus, source string) (Outcome, error) {
	to, known := StatusOf(st.TransactionStatus, st.FraudStatus)
	in := ApplyInput{
		Payment: p, To: to, Known: known, Gateway: st, Source: source, Now: s.now(),
		DedupeKey: DedupeKey(st),
	}
	in.Amount, in.AmountOK = wholeRupiah(st.GrossAmount)
	in.AmountMatches = in.AmountOK && in.Amount == p.Amount
	outcome, err := s.repo.Apply(ctx, in)
	if err != nil {
		return "", fmt.Errorf("apply payment %s status %s: %w", p.ID, st.TransactionStatus, err)
	}
	logOutcome(ctx, in, outcome)
	return outcome, nil
}

// logOutcome logs what an operator must see: an amount that does not
// match (ERROR), money for an order that can no longer take it (WARN), a
// paid status for a payment that could not move to paid (WARN), and every
// change. Never the signature or a key.
func logOutcome(ctx context.Context, in ApplyInput, outcome Outcome) {
	log := logx.FromContext(ctx).With("payment_id", in.Payment.ID, "order_id", in.Payment.OrderID,
		"provider_order_id", in.Payment.ProviderOrderID, "transaction_status", in.Gateway.TransactionStatus,
		"source", in.Source, "outcome", string(outcome))
	switch outcome {
	case OutcomeAmountMismatch:
		log.Error("payment amount does not match the order; nothing changed",
			"amount", in.Payment.Amount, "gross_amount", in.Gateway.GrossAmount)
	case OutcomeRefundRequired:
		log.Warn("payment arrived for an order that can no longer be paid; it must be refunded")
	case OutcomePaid, OutcomeOrderCancelled:
		log.Info("payment status applied")
	case OutcomeRecorded:
		if paidButStuck(in) {
			log.Warn("gateway says paid but the payment could not move to paid; money may have arrived with no order change",
				"payment_status", string(in.Payment.Status))
			return
		}
		log.Debug("payment status recorded")
	case OutcomeDuplicate:
		log.Debug("payment status recorded")
	}
}

// paidButStuck reports whether the gateway says in's payment is paid
// while the payment (as read before Apply) was not paid already and did
// not move: a settlement for a payment that is denied, failed or
// refunded, which no transition allows. Money may have arrived that no
// order shows, so an operator looks rather than a DEBUG line nobody reads.
func paidButStuck(in ApplyInput) bool {
	return in.Known && in.To == StatusPaid && in.Payment.Status != StatusPaid
}

// ApplyInput is one status for the repository to apply.
type ApplyInput struct {
	Payment Payment
	// To is the payment status the gateway's status maps to; Known is
	// false for a status GoShop does not know, which is only recorded.
	To    Status
	Known bool
	// Gateway is what the gateway said.
	Gateway TransactionStatus
	// Amount is Gateway.GrossAmount in whole rupiah, when AmountOK.
	Amount        int64
	AmountOK      bool
	AmountMatches bool
	Source        string
	DedupeKey     string
	Now           time.Time
}

// StatusOf maps a Midtrans transaction_status (and fraud_status, for card
// captures) to a payment status. known is false for a status GoShop does
// not act on.
func StatusOf(transactionStatus, fraudStatus string) (status Status, known bool) {
	switch transactionStatus {
	case "settlement":
		return StatusPaid, true
	case "capture":
		// A card payment is captured; the fraud check decides.
		switch fraudStatus {
		case "", "accept":
			return StatusPaid, true
		case "challenge":
			return StatusChallenge, true
		default:
			return StatusDenied, true
		}
	case "pending":
		return StatusPending, true
	case "deny":
		return StatusDenied, true
	case "cancel":
		return StatusCancelled, true
	case "expire":
		return StatusExpired, true
	case "failure":
		return StatusFailed, true
	case "refund", "chargeback":
		return StatusRefunded, true
	case "partial_refund", "partial_chargeback":
		return StatusPartiallyRefunded, true
	default:
		return "", false
	}
}

// DedupeKey is the payment_events key of st: the same status of the same
// gateway transaction is the same event, however often it arrives.
func DedupeKey(st TransactionStatus) string {
	id := st.TransactionID
	if id == "" {
		id = "none"
	}
	return strings.Join([]string{id, st.TransactionStatus, st.FraudStatus}, "|")
}

// wholeRupiah parses a gateway amount such as "117000.00" exactly (sdk
// moneyx), and reports false for anything that is not a whole number of
// rupiah.
func wholeRupiah(amount string) (int64, bool) {
	d, err := moneyx.Parse(amount)
	if err != nil {
		return 0, false
	}
	n := d.RoundIDR()
	if d.Cmp(moneyx.FromInt(n)) != 0 {
		return 0, false
	}
	return n, true
}
