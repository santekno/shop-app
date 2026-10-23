package order

import "slices"

// transitions is the order life cycle (docs/erd.md, ADR 0006): for each
// status, the statuses an order may move to from it. It is the one place
// the rule lives in Go; every status-change query takes its from-statuses
// from it (From), so the SQL enforces the same rule against races.
var transitions = map[Status][]Status{
	StatusPendingPayment: {StatusPaid, StatusCancelled},
	StatusPaid:           {StatusProcessing, StatusCancelled},
	StatusProcessing:     {StatusShipped, StatusCancelled},
	StatusShipped:        {StatusCompleted},
	StatusCompleted:      {},
	StatusCancelled:      {},
}

// CanTransition reports whether an order in status from may move to to.
func CanTransition(from, to Status) bool {
	return slices.Contains(transitions[from], to)
}

// From lists the statuses an order may move to to from, in life-cycle
// order: the @from_statuses of the status-change queries.
func From(to Status) []string {
	var from []string
	for _, s := range []Status{StatusPendingPayment, StatusPaid, StatusProcessing, StatusShipped, StatusCompleted, StatusCancelled} {
		if CanTransition(s, to) {
			from = append(from, string(s))
		}
	}
	return from
}

// buyerCancellable is what a buyer may cancel themselves: only an order
// they have not paid. A paid order needs a refund, which the seller
// handles (Bab 6).
var buyerCancellable = []string{string(StatusPendingPayment)}

// TransitionError means the order is not in a status it may move to To
// from. It is answered 409 INVALID_TRANSITION with the current status.
type TransitionError struct {
	Current Status
	To      Status
}

func (e *TransitionError) Error() string {
	return "order is " + string(e.Current) + " and cannot become " + string(e.To)
}
