package payment

import (
	"slices"
	"testing"

	"github.com/santekno/sdk/testx"
)

// Every Midtrans transaction_status (and fraud_status of a capture) maps
// to one payment status; anything else is not known.
func TestStatusOf(t *testing.T) {
	tests := []struct {
		tx, fraud string
		want      Status
		known     bool
	}{
		{"settlement", "", StatusPaid, true},
		{"settlement", "accept", StatusPaid, true},
		{"capture", "", StatusPaid, true},
		{"capture", "accept", StatusPaid, true},
		{"capture", "challenge", StatusChallenge, true},
		{"capture", "deny", StatusDenied, true},
		{"capture", "something-new", StatusDenied, true},
		{"pending", "", StatusPending, true},
		{"deny", "", StatusDenied, true},
		{"cancel", "", StatusCancelled, true},
		{"expire", "", StatusExpired, true},
		{"failure", "", StatusFailed, true},
		{"refund", "", StatusRefunded, true},
		{"chargeback", "", StatusRefunded, true},
		{"partial_refund", "", StatusPartiallyRefunded, true},
		{"partial_chargeback", "", StatusPartiallyRefunded, true},
		{"authorize", "", "", false},
		{"", "", "", false},
		{"SETTLEMENT", "", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.tx+"/"+tc.fraud, func(t *testing.T) {
			got, known := StatusOf(tc.tx, tc.fraud)
			testx.AssertEqual(t, got, tc.want)
			testx.AssertEqual(t, known, tc.known)
		})
	}
}

// The payment life cycle only moves forward.
func TestCanTransition(t *testing.T) {
	tests := []struct {
		from, to Status
		want     bool
	}{
		{StatusPending, StatusChallenge, true},
		{StatusPending, StatusPaid, true},
		{StatusPending, StatusDenied, true},
		{StatusPending, StatusCancelled, true},
		{StatusPending, StatusExpired, true},
		{StatusPending, StatusFailed, true},
		{StatusPending, StatusPending, false},
		{StatusPending, StatusRefunded, false},
		{StatusChallenge, StatusPaid, true},
		{StatusChallenge, StatusDenied, true},
		{StatusChallenge, StatusCancelled, true},
		{StatusChallenge, StatusExpired, true},
		{StatusChallenge, StatusFailed, true},
		{StatusChallenge, StatusPending, false},
		{StatusChallenge, StatusChallenge, false},
		{StatusPaid, StatusRefunded, true},
		{StatusPaid, StatusPartiallyRefunded, true},
		{StatusPaid, StatusPending, false},
		{StatusPaid, StatusChallenge, false},
		{StatusPaid, StatusPaid, false},
		{StatusPaid, StatusExpired, false},
		{StatusPaid, StatusDenied, false},
		{StatusPartiallyRefunded, StatusPartiallyRefunded, true},
		{StatusPartiallyRefunded, StatusRefunded, true},
		{StatusPartiallyRefunded, StatusPaid, false},
		// GoShop closes a payment when its order closes, without telling
		// Midtrans: money that still arrives is recorded (and flagged for a
		// refund), never lost.
		{StatusExpired, StatusPaid, true},
		{StatusExpired, StatusChallenge, false},
		{StatusExpired, StatusPending, false},
		{StatusDenied, StatusPaid, false},
		{StatusCancelled, StatusPaid, true},
		{StatusCancelled, StatusPending, false},
		{StatusCancelled, StatusExpired, false},
		{StatusFailed, StatusPaid, false},
		{StatusRefunded, StatusPaid, false},
		{StatusRefunded, StatusPartiallyRefunded, false},
		{StatusRefunded, StatusRefunded, false},
		{"bogus", StatusPaid, false},
	}
	for _, tc := range tests {
		t.Run(string(tc.from)+"->"+string(tc.to), func(t *testing.T) {
			testx.AssertEqual(t, CanTransition(tc.from, tc.to), tc.want)
		})
	}
}

// From is the guarded UPDATE's @from_statuses for each target.
func TestFrom(t *testing.T) {
	tests := []struct {
		to   Status
		want []string
	}{
		{StatusPaid, []string{"pending", "challenge", "cancelled", "expired"}},
		{StatusChallenge, []string{"pending"}},
		{StatusPending, nil},
		{StatusDenied, []string{"pending", "challenge"}},
		{StatusCancelled, []string{"pending", "challenge"}},
		{StatusExpired, []string{"pending", "challenge"}},
		{StatusFailed, []string{"pending", "challenge"}},
		{StatusRefunded, []string{"paid", "partially_refunded"}},
		{StatusPartiallyRefunded, []string{"paid", "partially_refunded"}},
	}
	for _, tc := range tests {
		t.Run(string(tc.to), func(t *testing.T) {
			got := From(tc.to)
			testx.AssertTrue(t, slices.Equal(got, tc.want), "From(%s) = %v, want %v", tc.to, got, tc.want)
		})
	}
}

func TestStatus_Open(t *testing.T) {
	for _, s := range allStatuses {
		want := s == StatusPending || s == StatusChallenge
		testx.AssertEqual(t, s.Open(), want, "status %s", s)
	}
	testx.AssertEqual(t, len(allStatuses), 9, "every status is listed")
}

func TestNotPayableError(t *testing.T) {
	err := &NotPayableError{Status: "paid"}
	testx.AssertEqual(t, err.Error(), "order is paid and cannot be paid")
}

// The same status of the same transaction is the same event.
func TestDedupeKey(t *testing.T) {
	st := TransactionStatus{TransactionID: "tx", TransactionStatus: "settlement", FraudStatus: "accept", GrossAmount: "1.00"}
	testx.AssertEqual(t, DedupeKey(st), "tx|settlement|accept")

	noID := st
	noID.TransactionID = ""
	testx.AssertEqual(t, DedupeKey(noID), "none|settlement|accept")

	again := st
	again.GrossAmount, again.StatusCode = "999.00", "201"
	testx.AssertEqual(t, DedupeKey(again), DedupeKey(st), "only the transaction, status and fraud status count")

	challenge := st
	challenge.FraudStatus = "challenge"
	testx.AssertNotEqual(t, DedupeKey(challenge), DedupeKey(st))

	pending := st
	pending.TransactionStatus = "pending"
	testx.AssertNotEqual(t, DedupeKey(pending), DedupeKey(st))

	other := st
	other.TransactionID = "tx-2"
	testx.AssertNotEqual(t, DedupeKey(other), DedupeKey(st))

	testx.AssertEqual(t, DedupeKey(TransactionStatus{TransactionStatus: "expire"}), "none|expire|")
}

// Gateway amounts are parsed exactly; only whole rupiah are accepted.
func TestWholeRupiah(t *testing.T) {
	tests := []struct {
		in   string
		want int64
		ok   bool
	}{
		{"117000.00", 117000, true},
		{"117000", 117000, true},
		{"117000.0", 117000, true},
		{"1.00", 1, true},
		{"0.00", 0, true},
		{"999999999999.00", 999999999999, true},
		{"117000.50", 0, false},
		{"117000.01", 0, false},
		{"117000.001", 0, false},
		{"abc", 0, false},
		{"", 0, false},
		{"117,000.00", 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got, ok := wholeRupiah(tc.in)
			testx.AssertEqual(t, ok, tc.ok)
			testx.AssertEqual(t, got, tc.want)
		})
	}
	// A negative amount parses (moneyx accepts a sign), so it is the
	// amount comparison in Apply that refuses it: it never equals a
	// payment's positive amount.
	n, ok := wholeRupiah("-5.00")
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, n, int64(-5))
}
