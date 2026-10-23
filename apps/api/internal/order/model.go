// Package order is checkout and the orders it creates (ADR 0006): the
// validation of a cart against the catalog, the totals, the order with its
// line snapshots, the status machine and the buyer's order history.
package order

import (
	"errors"

	"github.com/santekno/shop-app/apps/api/internal/cart"
)

// ErrCartEmpty means there is nothing to check out.
var ErrCartEmpty = errors.New("cart is empty")

// LineProblem is one cart line that checkout refuses, with what the buyer
// needs to fix it.
type LineProblem struct {
	VariantID string
	SKU       string
	Problem   cart.Problem
	// Quantity is what the line asks for; Available is the stock on hand
	// (0 for an unavailable variant).
	Quantity  int32
	Available int32
	// AddedPrice is the price the buyer saw, Price the price now.
	AddedPrice int64
	Price      int64
}

// ProblemsError is every line checkout refuses, in cart order. It is
// answered 409 CHECKOUT_PROBLEMS.
type ProblemsError struct {
	Lines []LineProblem
}

func (e *ProblemsError) Error() string { return "checkout problems" }

// validateLines checks every line the way checkout does: a variant that
// can still be sold, enough stock, and the price the buyer saw. It returns
// nil when every line can be bought. Checkout runs it on rows it has
// locked, preview on a plain read.
func validateLines(lines []cart.Line) error {
	var problems []LineProblem
	for _, l := range lines {
		p := l.Problem()
		if p == cart.ProblemNone {
			continue
		}
		available := l.Stock
		if p == cart.ProblemUnavailable {
			available = 0
		}
		problems = append(problems, LineProblem{
			VariantID: l.VariantID, SKU: l.SKU, Problem: p, Quantity: l.Quantity,
			Available: available, AddedPrice: l.AddedPrice, Price: l.Price,
		})
	}
	if len(problems) > 0 {
		return &ProblemsError{Lines: problems}
	}
	return nil
}
