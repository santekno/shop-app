package order

import (
	"context"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/cart"
)

// Carts reads a buyer's cart; cart.Service is one.
type Carts interface {
	Get(ctx context.Context, owner cart.Owner) (cart.Cart, error)
}

// Service is checkout and orders.
type Service struct {
	carts Carts
}

// NewService returns a Service.
func NewService(carts Carts) *Service {
	return &Service{carts: carts}
}

// Preview is what checkout would charge now, without writing anything.
type Preview struct {
	Lines  []cart.Line
	Totals Totals
}

// Preview validates userID's cart the way checkout will: ErrCartEmpty, or a
// *ProblemsError listing every line that cannot be bought as it is.
// Checkout validates again on locked rows, so a preview that passed is a
// hint, not a promise.
func (s *Service) Preview(ctx context.Context, userID string) (Preview, error) {
	c, err := s.carts.Get(ctx, cart.Owner{UserID: userID})
	if err != nil {
		return Preview{}, fmt.Errorf("preview checkout: %w", err)
	}
	if len(c.Lines) == 0 {
		return Preview{}, ErrCartEmpty
	}
	if err := validateLines(c.Lines); err != nil {
		return Preview{}, err
	}
	totals := CalculateTotals(TotalsInput{Lines: totalsLines(c.Lines)})
	return Preview{Lines: c.Lines, Totals: totals}, nil
}
