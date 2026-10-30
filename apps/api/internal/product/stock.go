package product

import (
	"context"
	"errors"
	"fmt"
)

// Stock adjustments (Bab 12): one variant's stock changed in one guarded
// statement, without the whole-product PUT and its versions. Like a
// checkout, an adjustment bumps the variant's version and nothing of the
// product's.

// MaxVariantStock is the most units one variant may hold, the bound of a
// variant's stock in the product body too.
const MaxVariantStock = 1_000_000

// StockChange is one adjustment: Delta, or Set with Expected.
type StockChange struct {
	// Delta is added to the stock as it is when the change runs ("20
	// received", "-2 damaged"). Not 0 when used.
	Delta int32
	// IsSet makes it a count: the stock becomes Set, but only while it is
	// still Expected, the stock the seller saw.
	IsSet    bool
	Set      int32
	Expected int32
}

// Stock errors.
var (
	// ErrVariantNotFound: the variant is not one of the product's.
	ErrVariantNotFound = errors.New("variant not found")
	// ErrStockOutOfRange: the delta would take the stock below 0, or is an
	// increase past MaxVariantStock (a decrease is never capped). See
	// StockError.
	ErrStockOutOfRange = errors.New("stock out of range")
	// ErrStockChanged: a count's expected stock is not the stock any more.
	// See StockError.
	ErrStockChanged = errors.New("stock changed")
)

// StockError is ErrStockOutOfRange or ErrStockChanged for one variant,
// with its stock read right after the refused change.
type StockError struct {
	Err       error
	VariantID string
	Stock     int32
}

func (e *StockError) Error() string {
	return fmt.Sprintf("variant %s (stock %d): %v", e.VariantID, e.Stock, e.Err)
}

// Unwrap makes errors.Is(err, e.Err) true.
func (e *StockError) Unwrap() error { return e.Err }

// StockRepository changes stock; *PostgresRepository is one.
type StockRepository interface {
	// ChangeStock applies change to the sellable variant variantID of
	// productID and returns the variant afterwards.
	ChangeStock(ctx context.Context, productID, variantID string, change StockChange) (AdminVariant, error)
}

// StockService serves the stock adjustments.
type StockService struct {
	repo StockRepository
}

// NewStockService returns a StockService on repo.
func NewStockService(repo StockRepository) *StockService {
	return &StockService{repo: repo}
}

// Change applies change and returns the variant afterwards. Errors:
// ErrVariantNotFound, a *VariantArchivedError, a *StockError
// (ErrStockOutOfRange, ErrStockChanged).
func (s *StockService) Change(ctx context.Context, productID, variantID string, change StockChange) (AdminVariant, error) {
	switch {
	case change.IsSet && (change.Set < 0 || change.Set > MaxVariantStock):
		return AdminVariant{}, fmt.Errorf("change stock: set %d out of range", change.Set)
	case change.IsSet && (change.Expected < 0 || change.Expected > MaxVariantStock):
		return AdminVariant{}, fmt.Errorf("change stock: expected %d out of range", change.Expected)
	case !change.IsSet && (change.Delta == 0 || change.Delta < -MaxVariantStock || change.Delta > MaxVariantStock):
		return AdminVariant{}, fmt.Errorf("change stock: delta %d out of range", change.Delta)
	}
	v, err := s.repo.ChangeStock(ctx, productID, variantID, change)
	if err != nil {
		return AdminVariant{}, fmt.Errorf("change stock of variant %s: %w", variantID, err)
	}
	return v, nil
}
