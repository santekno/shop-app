package order

import (
	"slices"
	"testing"

	"github.com/santekno/sdk/testx"
)

var allStatuses = []Status{StatusPendingPayment, StatusPaid, StatusProcessing, StatusShipped, StatusCompleted, StatusCancelled}

// The life cycle of docs/erd.md, written out cell by cell: every move that
// is allowed, and by omission every move that is not.
func TestCanTransition(t *testing.T) {
	allowed := map[[2]Status]bool{
		{StatusPendingPayment, StatusPaid}:      true,
		{StatusPendingPayment, StatusCancelled}: true,
		{StatusPaid, StatusProcessing}:          true,
		{StatusPaid, StatusCancelled}:           true,
		{StatusProcessing, StatusShipped}:       true,
		{StatusProcessing, StatusCancelled}:     true,
		{StatusShipped, StatusCompleted}:        true,
	}
	for _, from := range allStatuses {
		for _, to := range allStatuses {
			testx.AssertEqual(t, CanTransition(from, to), allowed[[2]Status{from, to}], "%s -> %s", from, to)
		}
	}
	testx.AssertFalse(t, CanTransition("refunded", StatusPaid), "an unknown status moves nowhere")
	testx.AssertFalse(t, CanTransition(StatusPaid, "refunded"))
	testx.AssertFalse(t, CanTransition(StatusShipped, StatusCancelled), "never cancelled after shipping")
}

func TestFrom(t *testing.T) {
	tests := []struct {
		to   Status
		want []string
	}{
		{StatusPendingPayment, nil},
		{StatusPaid, []string{"pending_payment"}},
		{StatusProcessing, []string{"paid"}},
		{StatusShipped, []string{"processing"}},
		{StatusCompleted, []string{"shipped"}},
		{StatusCancelled, []string{"pending_payment", "paid", "processing"}},
		{"refunded", nil},
	}
	for _, tt := range tests {
		t.Run(string(tt.to), func(t *testing.T) {
			got := From(tt.to)
			if !slices.Equal(got, tt.want) {
				t.Fatalf("From(%s) = %v, want %v", tt.to, got, tt.want)
			}
		})
	}
	// A buyer may cancel only what they have not paid.
	testx.AssertTrue(t, slices.Equal(buyerCancellable, []string{"pending_payment"}))
}

func TestTransitionError(t *testing.T) {
	err := &TransitionError{Current: StatusShipped, To: StatusCancelled}
	testx.AssertEqual(t, err.Error(), "order is shipped and cannot become cancelled")
}
