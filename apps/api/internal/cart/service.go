package cart

import (
	"context"
	"fmt"
)

// Repository is where carts are stored. The rules that must hold under
// concurrent requests (the line limit, the quantity against stock) run in
// its transactions, under the cart's row lock.
type Repository interface {
	Get(ctx context.Context, owner Owner) (Cart, error)
	Add(ctx context.Context, owner Owner, variantID string, quantity int32) error
	SetQuantity(ctx context.Context, owner Owner, variantID string, quantity int32) error
	Remove(ctx context.Context, owner Owner, variantID string) error
}

// Service is the cart feature. Every method returns the whole cart after
// the change, which is what a client shows next.
type Service struct {
	repo Repository
}

// NewService returns a Service on repo.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// Get returns owner's cart.
func (s *Service) Get(ctx context.Context, owner Owner) (Cart, error) {
	c, err := s.repo.Get(ctx, owner)
	if err != nil {
		return Cart{}, fmt.Errorf("get cart: %w", err)
	}
	return c, nil
}

// Add puts quantity (1 to MaxQuantity) more of variantID into owner's
// cart. A variant already in the cart gets the sum, which must stay within
// MaxQuantity and the stock on hand.
func (s *Service) Add(ctx context.Context, owner Owner, variantID string, quantity int32) (Cart, error) {
	if quantity < 1 || quantity > MaxQuantity {
		return Cart{}, ErrQuantityLimit
	}
	if err := s.repo.Add(ctx, owner, variantID, quantity); err != nil {
		return Cart{}, fmt.Errorf("add to cart: %w", err)
	}
	return s.Get(ctx, owner)
}

// SetQuantity sets the quantity of a line already in owner's cart. Saving
// the same quantity again is how a buyer accepts a changed price.
func (s *Service) SetQuantity(ctx context.Context, owner Owner, variantID string, quantity int32) (Cart, error) {
	if quantity < 1 || quantity > MaxQuantity {
		return Cart{}, ErrQuantityLimit
	}
	if err := s.repo.SetQuantity(ctx, owner, variantID, quantity); err != nil {
		return Cart{}, fmt.Errorf("update cart line: %w", err)
	}
	return s.Get(ctx, owner)
}

// Remove takes variantID's line out of owner's cart.
func (s *Service) Remove(ctx context.Context, owner Owner, variantID string) (Cart, error) {
	if err := s.repo.Remove(ctx, owner, variantID); err != nil {
		return Cart{}, fmt.Errorf("remove cart line: %w", err)
	}
	return s.Get(ctx, owner)
}
