package payment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"
)

// signedNotification is a notification for testPayment that claims it was
// settled.
func signedNotification() Notification {
	return Notification{
		OrderID: providerOrderID, StatusCode: "200", GrossAmount: "117000.00", SignatureKey: "sig-SECRET-0123456789abcdef",
	}
}

func notificationService(gw *fakeGateway) (*Service, *fakeRepo) {
	repo := &fakeRepo{byProvider: testPayment(), outcome: OutcomePaid}
	if gw == nil {
		return newTestService(repo, &fakeOrders{}, nil), repo
	}
	return newTestService(repo, &fakeOrders{}, gw), repo
}

func TestService_HandleNotification_Disabled(t *testing.T) {
	s, repo := notificationService(nil)
	_, err := s.HandleNotification(t.Context(), signedNotification())
	testx.AssertTrue(t, errors.Is(err, ErrDisabled), "got %v", err)
	testx.AssertEqual(t, len(repo.calls), 0)
}

// A notification whose signature does not check reaches neither the
// database nor the gateway's status API.
func TestService_HandleNotification_BadSignature(t *testing.T) {
	gw := newFakeGateway()
	gw.valid = false
	s, repo := notificationService(gw)
	n := signedNotification()
	outcome, err := s.HandleNotification(t.Context(), n)
	testx.AssertTrue(t, errors.Is(err, ErrInvalidSignature), "got %v", err)
	testx.AssertEqual(t, outcome, Outcome(""))
	testx.AssertEqual(t, len(gw.verifyCalls), 1)
	testx.AssertEqual(t, gw.verifyCalls[0], [4]string{n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey})
	testx.AssertEqual(t, len(repo.calls), 0, "the repository is never asked")
	testx.AssertEqual(t, len(gw.statusCalls), 0, "the status API is never asked")
}

func TestService_HandleNotification_UnknownPayment(t *testing.T) {
	gw := newFakeGateway()
	s, repo := notificationService(gw)
	repo.byProviderErr = ErrPaymentNotFound
	_, err := s.HandleNotification(t.Context(), signedNotification())
	testx.AssertTrue(t, errors.Is(err, ErrPaymentNotFound), "got %v", err)
	testx.AssertEqual(t, repo.calls[0], "ByProviderOrderID "+providerOrderID)
	testx.AssertEqual(t, len(gw.statusCalls), 0)
	testx.AssertEqual(t, len(repo.applied), 0)
}

// GoShop acts on the status API's answer, never on the notification's
// own fields.
func TestService_HandleNotification_AppliesStatusAPIAnswer(t *testing.T) {
	tests := []struct {
		name          string
		answer        TransactionStatus
		to            Status
		amountMatches bool
	}{
		{"status API says pending", TransactionStatus{
			OrderID: providerOrderID, StatusCode: "201", TransactionID: "tx-1", TransactionStatus: "pending", GrossAmount: "117000.00",
		}, StatusPending, true},
		{"status API says another amount", TransactionStatus{
			OrderID: providerOrderID, StatusCode: "200", TransactionID: "tx-1", TransactionStatus: "settlement", GrossAmount: "1000.00",
		}, StatusPaid, false},
		{"status API says settlement", settlement(), StatusPaid, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gw := newFakeGateway()
			gw.status = tc.answer
			s, repo := notificationService(gw)
			repo.outcome = OutcomeRecorded
			outcome, err := s.HandleNotification(t.Context(), signedNotification())
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, OutcomeRecorded, "the repository's outcome")
			testx.AssertEqual(t, len(gw.statusCalls), 1, "the status API is always asked")
			testx.AssertEqual(t, gw.statusCalls[0], providerOrderID)
			testx.AssertEqual(t, len(repo.applied), 1)
			in := repo.applied[0]
			testx.AssertEqual(t, in.Gateway, tc.answer)
			testx.AssertEqual(t, in.To, tc.to)
			testx.AssertEqual(t, in.AmountMatches, tc.amountMatches)
			testx.AssertEqual(t, in.Source, SourceWebhook)
			testx.AssertEqual(t, in.Payment.ID, paymentID)
			testx.AssertEqual(t, in.DedupeKey, DedupeKey(tc.answer))
		})
	}
}

func TestService_HandleNotification_StatusErrors(t *testing.T) {
	t.Run("transaction not found yet", func(t *testing.T) {
		gw := newFakeGateway()
		gw.statusErr = ErrTransactionNotFound
		s, repo := notificationService(gw)
		_, err := s.HandleNotification(t.Context(), signedNotification())
		testx.AssertTrue(t, errors.Is(err, ErrGatewayUnavailable), "got %v", err)
		testx.AssertTrue(t, errors.Is(err, ErrTransactionNotFound), "got %v", err)
		testx.AssertEqual(t, len(repo.applied), 0)
	})
	t.Run("status API fails", func(t *testing.T) {
		gw := newFakeGateway()
		gw.statusErr = fmt.Errorf("%w: 500", ErrGatewayUnavailable)
		s, repo := notificationService(gw)
		_, err := s.HandleNotification(t.Context(), signedNotification())
		testx.AssertTrue(t, errors.Is(err, ErrGatewayUnavailable), "got %v", err)
		testx.AssertFalse(t, errors.Is(err, ErrTransactionNotFound))
		testx.AssertContains(t, err.Error(), "payment "+paymentID+" status")
		testx.AssertEqual(t, len(repo.applied), 0)
	})
}

// Apply builds the repository's input from the gateway's status.
func TestService_Apply_Input(t *testing.T) {
	tests := []struct {
		name          string
		st            TransactionStatus
		to            Status
		known         bool
		amount        int64
		amountOK      bool
		amountMatches bool
	}{
		{"settlement of the payment's amount", settlement(), StatusPaid, true, 117000, true, true},
		{"accepted capture", TransactionStatus{TransactionID: "tx-2", TransactionStatus: "capture", FraudStatus: "accept", GrossAmount: "117000.00"},
			StatusPaid, true, 117000, true, true},
		{"challenged capture", TransactionStatus{TransactionID: "tx-2", TransactionStatus: "capture", FraudStatus: "challenge", GrossAmount: "117000.00"},
			StatusChallenge, true, 117000, true, true},
		{"another amount", TransactionStatus{TransactionID: "tx-1", TransactionStatus: "settlement", GrossAmount: "116999.00"},
			StatusPaid, true, 116999, true, false},
		{"not whole rupiah", TransactionStatus{TransactionID: "tx-1", TransactionStatus: "settlement", GrossAmount: "117000.50"},
			StatusPaid, true, 0, false, false},
		{"no amount", TransactionStatus{TransactionID: "tx-1", TransactionStatus: "expire"},
			StatusExpired, true, 0, false, false},
		{"unknown status", TransactionStatus{TransactionID: "tx-1", TransactionStatus: "authorize", GrossAmount: "117000.00"},
			"", false, 117000, true, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{outcome: OutcomeRecorded}
			s := newTestService(repo, &fakeOrders{}, newFakeGateway())
			outcome, err := s.Apply(t.Context(), testPayment(), tc.st, SourceReconcile)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, OutcomeRecorded)
			testx.AssertEqual(t, len(repo.applied), 1)
			in := repo.applied[0]
			testx.AssertEqual(t, in.Payment, testPayment())
			testx.AssertEqual(t, in.To, tc.to)
			testx.AssertEqual(t, in.Known, tc.known)
			testx.AssertEqual(t, in.Gateway, tc.st)
			testx.AssertEqual(t, in.Amount, tc.amount)
			testx.AssertEqual(t, in.AmountOK, tc.amountOK)
			testx.AssertEqual(t, in.AmountMatches, tc.amountMatches)
			testx.AssertEqual(t, in.Source, SourceReconcile)
			testx.AssertEqual(t, in.DedupeKey, DedupeKey(tc.st))
			testx.AssertEqual(t, in.Now, testNow)
		})
	}
}

func TestService_Apply_RepositoryError(t *testing.T) {
	repo := &fakeRepo{applyErr: errBoom}
	s := newTestService(repo, &fakeOrders{}, newFakeGateway())
	outcome, err := s.Apply(t.Context(), testPayment(), settlement(), SourceWebhook)
	testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
	testx.AssertContains(t, err.Error(), "apply payment "+paymentID+" status settlement")
	testx.AssertEqual(t, outcome, Outcome(""))
}

// logLine is one JSON log line.
type logLine map[string]any

func captureLogs(t *testing.T) (context.Context, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	logger := logx.New(logx.WithOutput(&buf), logx.WithFormat("json"), logx.WithLevel("debug"))
	return logx.WithContextLogger(t.Context(), logger), &buf
}

func parseLogs(t *testing.T, buf *bytes.Buffer) []logLine {
	t.Helper()
	var out []logLine
	for line := range strings.SplitSeq(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var l logLine
		if err := json.Unmarshal([]byte(line), &l); err != nil {
			t.Fatalf("log line %q: %v", line, err)
		}
		out = append(out, l)
	}
	return out
}

// What an operator must see is logged at its level, and the log never
// holds the signature or a key.
func TestService_HandleNotification_Logs(t *testing.T) {
	tests := []struct {
		outcome Outcome
		level   string
		msg     string
	}{
		{OutcomeAmountMismatch, "ERROR", "payment amount does not match the order; nothing changed"},
		{OutcomeRefundRequired, "WARN", "payment arrived for an order that can no longer be paid; it must be refunded"},
		{OutcomePaid, "INFO", "payment status applied"},
		{OutcomeOrderCancelled, "INFO", "payment status applied"},
		// testPayment is pending and the gateway says settlement: a paid
		// status that did not move the payment (TestService_HandleNotification_LogsPaidThatDidNotMove).
		{OutcomeRecorded, "WARN", msgPaidDidNotMove},
		{OutcomeDuplicate, "DEBUG", "payment status recorded"},
	}
	for _, tc := range tests {
		t.Run(string(tc.outcome), func(t *testing.T) {
			ctx, buf := captureLogs(t)
			gw := newFakeGateway()
			s, repo := notificationService(gw)
			repo.outcome = tc.outcome
			n := signedNotification()
			outcome, err := s.HandleNotification(ctx, n)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, tc.outcome)

			lines := parseLogs(t, buf)
			testx.AssertEqual(t, len(lines), 1, "log %s", buf.String())
			l := lines[0]
			testx.AssertEqual(t, l["level"], any(tc.level))
			testx.AssertEqual(t, l["msg"], any(tc.msg))
			testx.AssertEqual(t, l["payment_id"], any(paymentID))
			testx.AssertEqual(t, l["order_id"], any(orderID))
			testx.AssertEqual(t, l["provider_order_id"], any(providerOrderID))
			testx.AssertEqual(t, l["transaction_status"], any("settlement"))
			testx.AssertEqual(t, l["source"], any(SourceWebhook))
			testx.AssertEqual(t, l["outcome"], any(string(tc.outcome)))
			if tc.outcome == OutcomeAmountMismatch {
				testx.AssertEqual(t, l["amount"], any(float64(117000)))
				testx.AssertEqual(t, l["gross_amount"], any("117000.00"))
			}
			testx.AssertFalse(t, strings.Contains(buf.String(), n.SignatureKey), "the signature is logged: %s", buf.String())
			testx.AssertFalse(t, strings.Contains(buf.String(), gw.serverKey), "the server key is logged")
			testx.AssertFalse(t, strings.Contains(buf.String(), "sig-"), "the signature is logged")
		})
	}
}

const msgPaidDidNotMove = "gateway says paid but the payment could not move to paid; money may have arrived with no order change"

// A recorded status the gateway calls paid, for a payment that was not
// paid already, means money may have arrived that no order shows: WARN,
// with the payment's status. Every other recorded or duplicate status
// stays at DEBUG. Neither line carries the signature or a key.
func TestService_HandleNotification_LogsPaidThatDidNotMove(t *testing.T) {
	const debugMsg = "payment status recorded"
	tests := []struct {
		name              string
		from              Status // the payment's status before Apply
		transactionStatus string
		fraudStatus       string
		outcome           Outcome
		level, msg        string
		wantPaymentStatus bool
	}{
		{name: "settlement for a denied payment", from: StatusDenied, transactionStatus: "settlement", outcome: OutcomeRecorded, level: "WARN", msg: msgPaidDidNotMove, wantPaymentStatus: true},
		{name: "settlement for a failed payment", from: StatusFailed, transactionStatus: "settlement", outcome: OutcomeRecorded, level: "WARN", msg: msgPaidDidNotMove, wantPaymentStatus: true},
		{name: "settlement for a refunded payment", from: StatusRefunded, transactionStatus: "settlement", outcome: OutcomeRecorded, level: "WARN", msg: msgPaidDidNotMove, wantPaymentStatus: true},
		{name: "settlement for a partially refunded payment", from: StatusPartiallyRefunded, transactionStatus: "settlement", outcome: OutcomeRecorded, level: "WARN", msg: msgPaidDidNotMove, wantPaymentStatus: true},
		{name: "accepted capture for a denied payment", from: StatusDenied, transactionStatus: "capture", fraudStatus: "accept", outcome: OutcomeRecorded, level: "WARN", msg: msgPaidDidNotMove, wantPaymentStatus: true},
		{name: "settlement for a paid payment", from: StatusPaid, transactionStatus: "settlement", outcome: OutcomeRecorded, level: "DEBUG", msg: debugMsg},
		{name: "accepted capture for a paid payment", from: StatusPaid, transactionStatus: "capture", fraudStatus: "accept", outcome: OutcomeRecorded, level: "DEBUG", msg: debugMsg},
		{name: "pending recorded", from: StatusPending, transactionStatus: "pending", outcome: OutcomeRecorded, level: "DEBUG", msg: debugMsg},
		{name: "expire recorded", from: StatusDenied, transactionStatus: "expire", outcome: OutcomeRecorded, level: "DEBUG", msg: debugMsg},
		{name: "refund recorded", from: StatusPaid, transactionStatus: "refund", outcome: OutcomeRecorded, level: "DEBUG", msg: debugMsg},
		{name: "unknown status", from: StatusPending, transactionStatus: "authorize", outcome: OutcomeRecorded, level: "DEBUG", msg: debugMsg},
		{name: "capture under fraud challenge", from: StatusPending, transactionStatus: "capture", fraudStatus: "challenge", outcome: OutcomeRecorded, level: "DEBUG", msg: debugMsg},
		{name: "duplicate settlement for a denied payment", from: StatusDenied, transactionStatus: "settlement", outcome: OutcomeDuplicate, level: "DEBUG", msg: debugMsg},
		{name: "duplicate settlement for a paid payment", from: StatusPaid, transactionStatus: "settlement", outcome: OutcomeDuplicate, level: "DEBUG", msg: debugMsg},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, buf := captureLogs(t)
			gw := newFakeGateway()
			gw.status.TransactionStatus, gw.status.FraudStatus = tc.transactionStatus, tc.fraudStatus
			s, repo := notificationService(gw)
			repo.byProvider.Status = tc.from
			repo.outcome = tc.outcome
			n := signedNotification()

			outcome, err := s.HandleNotification(ctx, n)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, tc.outcome)

			lines := parseLogs(t, buf)
			if len(lines) != 1 {
				t.Fatalf("got %d log lines, want 1: %s", len(lines), buf.String())
			}
			l := lines[0]
			testx.AssertEqual(t, l["level"], any(tc.level))
			testx.AssertEqual(t, l["msg"], any(tc.msg))
			testx.AssertEqual(t, l["payment_id"], any(paymentID))
			testx.AssertEqual(t, l["order_id"], any(orderID))
			testx.AssertEqual(t, l["provider_order_id"], any(providerOrderID))
			testx.AssertEqual(t, l["transaction_status"], any(tc.transactionStatus))
			testx.AssertEqual(t, l["outcome"], any(string(tc.outcome)))
			ps, ok := l["payment_status"]
			testx.AssertEqual(t, ok, tc.wantPaymentStatus, "payment_status in %v", l)
			if tc.wantPaymentStatus {
				testx.AssertEqual(t, ps, any(string(tc.from)))
			}
			testx.AssertFalse(t, strings.Contains(buf.String(), n.SignatureKey), "the signature is logged: %s", buf.String())
			testx.AssertFalse(t, strings.Contains(buf.String(), "sig-"), "the signature is logged: %s", buf.String())
			testx.AssertFalse(t, strings.Contains(buf.String(), gw.serverKey), "the server key is logged: %s", buf.String())
			testx.AssertFalse(t, strings.Contains(buf.String(), "SB-Mid-"), "a key is logged: %s", buf.String())
		})
	}
}
