package cart

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository stores carts in PostgreSQL with the queries sqlc
// generated from internal/db/queries/carts.sql.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// Get returns owner's cart; an owner without one gets an empty cart.
func (r *PostgresRepository) Get(ctx context.Context, owner Owner) (Cart, error) {
	id, err := r.q.GetUserCartID(ctx, &owner.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return Cart{}, nil
	}
	if err != nil {
		return Cart{}, fmt.Errorf("query cart: %w", err)
	}
	return loadCart(ctx, r.q, id)
}

// Add puts quantity more of variantID into owner's cart, creating the cart
// and the line when needed, in one transaction under the cart lock.
// Errors: ErrVariantUnavailable, ErrCartFull, ErrQuantityLimit,
// *InsufficientStockError.
func (r *PostgresRepository) Add(ctx context.Context, owner Owner, variantID string, quantity int32) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		cartID, err := lockCart(ctx, q, owner)
		if err != nil {
			return err
		}
		current, err := q.GetCartItemQuantity(ctx, sqlc.GetCartItemQuantityParams{CartID: cartID, VariantID: variantID})
		switch {
		case errors.Is(err, sql.ErrNoRows):
			n, err := q.CountCartItems(ctx, cartID)
			if err != nil {
				return fmt.Errorf("count cart lines: %w", err)
			}
			if n >= MaxLines {
				return ErrCartFull
			}
		case err != nil:
			return fmt.Errorf("query cart line: %w", err)
		}
		return writeLine(ctx, q, cartID, variantID, current+quantity)
	})
}

// SetQuantity replaces the quantity of variantID's line in owner's cart,
// and takes the current price as the one the buyer has seen. Errors:
// ErrLineNotFound, ErrVariantUnavailable, *InsufficientStockError.
func (r *PostgresRepository) SetQuantity(ctx context.Context, owner Owner, variantID string, quantity int32) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		cartID, err := lockCart(ctx, q, owner)
		if err != nil {
			return err
		}
		_, err = q.GetCartItemQuantity(ctx, sqlc.GetCartItemQuantityParams{CartID: cartID, VariantID: variantID})
		if errors.Is(err, sql.ErrNoRows) {
			return ErrLineNotFound
		}
		if err != nil {
			return fmt.Errorf("query cart line: %w", err)
		}
		return writeLine(ctx, q, cartID, variantID, quantity)
	})
}

// Remove deletes variantID's line from owner's cart, or returns
// ErrLineNotFound.
func (r *PostgresRepository) Remove(ctx context.Context, owner Owner, variantID string) error {
	cartID, err := r.q.GetUserCartID(ctx, &owner.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrLineNotFound
	}
	if err != nil {
		return fmt.Errorf("query cart: %w", err)
	}
	n, err := r.q.DeleteCartItem(ctx, sqlc.DeleteCartItemParams{CartID: cartID, VariantID: variantID})
	if err != nil {
		return fmt.Errorf("delete cart line: %w", err)
	}
	if n == 0 {
		return ErrLineNotFound
	}
	return nil
}

// lockCart returns the id of owner's cart, created on first use, locked
// for the rest of the transaction.
func lockCart(ctx context.Context, q *sqlc.Queries, owner Owner) (string, error) {
	id, err := q.UpsertUserCart(ctx, sqlc.UpsertUserCartParams{ID: uuidx.NewV7(), UserID: owner.UserID})
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrAccountGone
	}
	if err != nil {
		return "", fmt.Errorf("lock cart: %w", err)
	}
	return id, nil
}

// writeLine stores quantity of variantID in the cart, at its current
// price, after checking that the variant is sellable, the quantity within
// MaxQuantity and the stock on hand.
func writeLine(ctx context.Context, q *sqlc.Queries, cartID, variantID string, quantity int32) error {
	v, err := q.GetSellableVariant(ctx, variantID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrVariantUnavailable
	}
	if err != nil {
		return fmt.Errorf("query variant: %w", err)
	}
	if quantity > MaxQuantity {
		return ErrQuantityLimit
	}
	if quantity > v.Stock {
		return &InsufficientStockError{Available: v.Stock}
	}
	err = q.UpsertCartItem(ctx, sqlc.UpsertCartItemParams{
		CartID: cartID, VariantID: variantID, Quantity: quantity, UnitPrice: v.Price,
	})
	if err != nil {
		return fmt.Errorf("write cart line: %w", err)
	}
	return nil
}

// loadCart reads the lines of the cart with id.
func loadCart(ctx context.Context, q *sqlc.Queries, id string) (Cart, error) {
	rows, err := q.ListCartLines(ctx, id)
	if err != nil {
		return Cart{}, fmt.Errorf("query cart lines: %w", err)
	}
	c := Cart{Lines: make([]Line, 0, len(rows))}
	for _, row := range rows {
		c.Lines = append(c.Lines, Line{
			VariantID: row.VariantID, ProductID: row.ProductID, ProductSlug: row.ProductSlug,
			ProductName: row.ProductName, VariantName: row.VariantName, SKU: row.Sku,
			Quantity: row.Quantity, AddedPrice: row.AddedPrice, Price: row.Price, Stock: row.Stock,
			WeightGrams: row.WeightGrams, Sellable: row.Sellable, CreatedAt: row.CreatedAt,
		})
	}
	return c, nil
}
