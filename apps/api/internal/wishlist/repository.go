package wishlist

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// Repository is where wishlists are stored. The service depends on this
// interface, so a test can hand it a fake instead of PostgreSQL.
type Repository interface {
	// Add saves the active product with slug for userID. Saving it again
	// changes nothing. Errors: ErrNoUser, ErrProductNotFound,
	// ErrLimitReached.
	Add(ctx context.Context, userID, slug string) error
	// Remove takes the product with slug off userID's wishlist; a product
	// that is not on it, or does not exist, is not an error.
	Remove(ctx context.Context, userID, slug string) error
	// List returns up to limit entries after the position, newest saved
	// first, of products that are still active.
	List(ctx context.Context, userID string, after position, limit int) ([]Entry, error)
}

// PostgresRepository stores wishlists in PostgreSQL with the queries sqlc
// generated from internal/db/queries/wishlist.sql.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// Add runs in one transaction that first locks the user row, so the size
// limit holds when two requests race (the same lock the address book takes).
// A product that is already saved is a success even at the limit: the
// limit is for new products only.
func (r *PostgresRepository) Add(ctx context.Context, userID, slug string) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if _, err := q.LockUser(ctx, userID); errors.Is(err, sql.ErrNoRows) {
			return ErrNoUser
		} else if err != nil {
			return fmt.Errorf("lock user: %w", err)
		}
		productID, err := q.GetActiveProductIDBySlug(ctx, slug)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrProductNotFound
		}
		if err != nil {
			return fmt.Errorf("query product: %w", err)
		}
		saved, err := q.WishlistItemExists(ctx, sqlc.WishlistItemExistsParams{UserID: userID, ProductID: productID})
		if err != nil {
			return fmt.Errorf("query wishlist item: %w", err)
		}
		if saved {
			return nil
		}
		n, err := q.CountWishlistItems(ctx, userID)
		if err != nil {
			return fmt.Errorf("count wishlist items: %w", err)
		}
		if n >= MaxItems {
			return ErrLimitReached
		}
		if err := q.InsertWishlistItem(ctx, sqlc.InsertWishlistItemParams{UserID: userID, ProductID: productID}); err != nil {
			return fmt.Errorf("insert wishlist item: %w", err)
		}
		return nil
	})
}

// Remove deletes the row, if there is one.
func (r *PostgresRepository) Remove(ctx context.Context, userID, slug string) error {
	if err := r.q.DeleteWishlistItem(ctx, sqlc.DeleteWishlistItemParams{UserID: userID, Slug: slug}); err != nil {
		return fmt.Errorf("delete wishlist item: %w", err)
	}
	return nil
}

// List reads one page of entries.
func (r *PostgresRepository) List(ctx context.Context, userID string, after position, limit int) ([]Entry, error) {
	rows, err := r.q.ListWishlistItems(ctx, sqlc.ListWishlistItemsParams{
		UserID: userID, CursorCreatedAt: after.CreatedAt, CursorID: after.ProductID,
		PageSize: int32(limit), // #nosec G115 -- the service caps limit at 101
	})
	if err != nil {
		return nil, fmt.Errorf("query wishlist: %w", err)
	}
	entries := make([]Entry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, Entry{ProductID: row.ProductID, AddedAt: row.CreatedAt})
	}
	return entries, nil
}

// AccountCloser returns what deleting an account (DELETE /v1/me) does to
// the user's wishlist, inside the deletion's transaction: the rows are
// deleted, because the users row is anonymised, not deleted, so the foreign
// key's CASCADE never fires. internal/app hands it to
// user.NewPostgresRepository, so the user package does not import this one.
func AccountCloser() func(ctx context.Context, q *sqlc.Queries, userID string) error {
	return func(ctx context.Context, q *sqlc.Queries, userID string) error {
		if err := q.DeleteUserWishlist(ctx, userID); err != nil {
			return fmt.Errorf("delete wishlist: %w", err)
		}
		return nil
	}
}
