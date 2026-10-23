package cart

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository stores carts in PostgreSQL with the queries sqlc
// generated from internal/db/queries/carts.sql.
type PostgresRepository struct {
	db     *sql.DB
	q      *sqlc.Queries
	random io.Reader
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db), random: rand.Reader}
}

// errNoCart means the owner has no cart yet: a user who never added
// anything, or a guest without a token.
var errNoCart = errors.New("no cart yet")

// Get returns owner's cart; an owner without one gets an empty cart, and a
// bad guest token is ErrCartNotFound.
func (r *PostgresRepository) Get(ctx context.Context, owner Owner) (Cart, error) {
	id, err := findCart(ctx, r.q, owner, false)
	if errors.Is(err, errNoCart) {
		return Cart{}, nil
	}
	if err != nil {
		return Cart{}, err
	}
	return loadCart(ctx, r.q, id)
}

// Add puts quantity more of variantID into owner's cart in one transaction
// under the cart lock. A user's cart is created on first use. A guest
// without a token gets a new guest cart, and Add returns its token, which
// the client must keep; otherwise token is empty. Errors: ErrCartNotFound,
// ErrVariantUnavailable, ErrCartFull, ErrQuantityLimit,
// *InsufficientStockError.
func (r *PostgresRepository) Add(ctx context.Context, owner Owner, variantID string, quantity int32) (token string, err error) {
	err = database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		cartID, err := findCart(ctx, q, owner, true)
		if errors.Is(err, errNoCart) {
			cartID, token, err = r.createGuestCart(ctx, q)
		}
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
	if err != nil {
		return "", err
	}
	return token, nil
}

// SetQuantity replaces the quantity of variantID's line in owner's cart,
// and takes the current price as the one the buyer has seen. Errors:
// ErrCartNotFound, ErrLineNotFound, ErrVariantUnavailable,
// *InsufficientStockError.
func (r *PostgresRepository) SetQuantity(ctx context.Context, owner Owner, variantID string, quantity int32) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		cartID, err := findCart(ctx, q, owner, true)
		if errors.Is(err, errNoCart) {
			return ErrLineNotFound
		}
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

// Remove deletes variantID's line from owner's cart. Errors:
// ErrCartNotFound, ErrLineNotFound.
func (r *PostgresRepository) Remove(ctx context.Context, owner Owner, variantID string) error {
	cartID, err := findCart(ctx, r.q, owner, false)
	if errors.Is(err, errNoCart) {
		return ErrLineNotFound
	}
	if err != nil {
		return err
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

// Merge moves the guest cart of token into userID's cart (see Merge for
// the rule) and deletes the guest cart, in one transaction that locks the
// user's cart first and the guest cart second. Errors: ErrCartNotFound,
// ErrAccountGone.
func (r *PostgresRepository) Merge(ctx context.Context, userID, token string) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		userCart, err := findCart(ctx, q, Owner{UserID: userID}, true)
		if err != nil {
			return err
		}
		guestCart, err := findCart(ctx, q, Owner{Token: token}, true)
		if errors.Is(err, errNoCart) {
			return ErrCartNotFound
		}
		if err != nil {
			return err
		}
		user, err := loadCart(ctx, q, userCart)
		if err != nil {
			return err
		}
		guest, err := loadCart(ctx, q, guestCart)
		if err != nil {
			return err
		}
		// In variant_id order: each new line locks its variant FOR KEY
		// SHARE (the foreign key check), and an admin save that changes
		// SKUs holds those variants FOR UPDATE in id order (ADR 0006).
		writes := Merge(user.Lines, guest.Lines)
		slices.SortFunc(writes, func(a, b LineWrite) int { return strings.Compare(a.VariantID, b.VariantID) })
		for _, w := range writes {
			err := q.UpsertCartItem(ctx, sqlc.UpsertCartItemParams{
				CartID: userCart, VariantID: w.VariantID, Quantity: w.Quantity, UnitPrice: w.UnitPrice,
			})
			if err != nil {
				return fmt.Errorf("write merged line: %w", err)
			}
		}
		if err := q.DeleteCart(ctx, guestCart); err != nil {
			return fmt.Errorf("delete guest cart: %w", err)
		}
		return nil
	})
}

// findCart returns the id of owner's cart. With lock, the row is locked
// for the rest of the transaction, and a user's cart is created when it
// does not exist yet. errNoCart: a user without a cart (lock false) or a
// guest without a token. ErrCartNotFound: a guest token that names no
// guest cart, or whose secret does not match. ErrAccountGone: a user whose
// account was deleted (lock true).
func findCart(ctx context.Context, q *sqlc.Queries, owner Owner, lock bool) (string, error) {
	if !owner.IsGuest() {
		if lock {
			id, err := q.UpsertUserCart(ctx, sqlc.UpsertUserCartParams{ID: uuidx.NewV7(), UserID: owner.UserID})
			if errors.Is(err, sql.ErrNoRows) {
				return "", ErrAccountGone
			}
			if err != nil {
				return "", fmt.Errorf("lock cart: %w", err)
			}
			return id, nil
		}
		id, err := q.GetUserCartID(ctx, &owner.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return "", errNoCart
		}
		if err != nil {
			return "", fmt.Errorf("query cart: %w", err)
		}
		return id, nil
	}
	if owner.Token == "" {
		return "", errNoCart
	}
	t, ok := parseGuestToken(owner.Token)
	if !ok {
		return "", ErrCartNotFound
	}
	read := q.GetGuestCart
	if lock {
		read = q.LockGuestCart
	}
	stored, err := read(ctx, t.CartID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrCartNotFound
	}
	if err != nil {
		return "", fmt.Errorf("query guest cart: %w", err)
	}
	if !t.matches(stored) {
		return "", ErrCartNotFound
	}
	return t.CartID, nil
}

// createGuestCart inserts a new guest cart and returns its id and token.
func (r *PostgresRepository) createGuestCart(ctx context.Context, q *sqlc.Queries) (string, string, error) {
	token, t, err := newGuestToken(r.random, uuidx.NewV7())
	if err != nil {
		return "", "", err
	}
	if err := q.InsertGuestCart(ctx, sqlc.InsertGuestCartParams{ID: t.CartID, TokenHash: t.Hash}); err != nil {
		return "", "", fmt.Errorf("insert guest cart: %w", err)
	}
	return t.CartID, token, nil
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
