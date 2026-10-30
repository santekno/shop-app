package product

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// ChangeStock applies change to the sellable variant variantID of
// productID in one guarded UPDATE, outside any transaction, and returns
// the variant afterwards. When the UPDATE changes nothing, one more read
// says why; its stock may already be newer than the one the UPDATE saw,
// which is why a client takes it as information, not as a base to write
// from.
func (r *PostgresRepository) ChangeStock(ctx context.Context, productID, variantID string, change StockChange) (AdminVariant, error) {
	var row sqlc.AdjustVariantStockRow
	var err error
	if change.IsSet {
		var set sqlc.SetVariantStockRow
		set, err = r.q.SetVariantStock(ctx, sqlc.SetVariantStockParams{
			ID: variantID, ProductID: productID, Stock: change.Set, Expected: change.Expected,
		})
		// The two RETURNING lists are the same columns.
		row = sqlc.AdjustVariantStockRow(set)
	} else {
		row, err = r.q.AdjustVariantStock(ctx, sqlc.AdjustVariantStockParams{
			ID: variantID, ProductID: productID, Delta: change.Delta, MaxStock: MaxVariantStock,
		})
	}
	if errors.Is(err, sql.ErrNoRows) {
		return AdminVariant{}, r.stockRefused(ctx, productID, variantID, change)
	}
	if err != nil {
		return AdminVariant{}, fmt.Errorf("update stock: %w", err)
	}
	return AdminVariant{
		ID: row.ID, SKU: row.Sku, Name: row.Name, Price: row.Price, Stock: row.Stock,
		WeightGrams: row.WeightGrams, Version: row.Version,
	}, nil
}

// stockRefused tells why a stock change changed nothing.
func (r *PostgresRepository) stockRefused(ctx context.Context, productID, variantID string, change StockChange) error {
	now, err := r.q.GetVariantStock(ctx, sqlc.GetVariantStockParams{ID: variantID, ProductID: productID})
	if errors.Is(err, sql.ErrNoRows) {
		return ErrVariantNotFound
	}
	if err != nil {
		return fmt.Errorf("query variant stock: %w", err)
	}
	if now.Archived {
		return &VariantArchivedError{VariantID: variantID}
	}
	if change.IsSet {
		return &StockError{Err: ErrStockChanged, VariantID: variantID, Stock: now.Stock}
	}
	return &StockError{Err: ErrStockOutOfRange, VariantID: variantID, Stock: now.Stock}
}
