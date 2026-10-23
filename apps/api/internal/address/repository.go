package address

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository stores addresses in PostgreSQL with the queries sqlc
// generated from internal/db/queries/addresses.sql.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// List returns userID's addresses, the default first, then the newest.
func (r *PostgresRepository) List(ctx context.Context, userID string) ([]Address, error) {
	rows, err := r.q.ListAddresses(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("query addresses: %w", err)
	}
	out := make([]Address, 0, len(rows))
	for _, row := range rows {
		out = append(out, fromRow(sqlc.GetAddressRow(row)))
	}
	return out, nil
}

// Get returns userID's address id, or ErrNotFound.
func (r *PostgresRepository) Get(ctx context.Context, userID, id string) (Address, error) {
	row, err := r.q.GetAddress(ctx, sqlc.GetAddressParams{ID: id, UserID: userID})
	if errors.Is(err, sql.ErrNoRows) {
		return Address{}, ErrNotFound
	}
	if err != nil {
		return Address{}, fmt.Errorf("query address: %w", err)
	}
	return fromRow(row), nil
}

// Create stores in as a new address id of userID, in one transaction that
// first locks the user, so the limit and the single default hold when two
// requests race. The first address is always the default; a new default
// takes the flag from the old one. Errors: ErrNoUser, ErrLimitReached.
func (r *PostgresRepository) Create(ctx context.Context, userID, id string, in Input) (Address, error) {
	var created Address
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if err := lockUser(ctx, q, userID); err != nil {
			return err
		}
		n, err := q.CountAddresses(ctx, userID)
		if err != nil {
			return fmt.Errorf("count addresses: %w", err)
		}
		if n >= MaxPerUser {
			return ErrLimitReached
		}
		isDefault := in.IsDefault || n == 0
		if isDefault {
			if err := q.ClearDefaultAddress(ctx, userID); err != nil {
				return fmt.Errorf("clear default: %w", err)
			}
		}
		row, err := q.InsertAddress(ctx, sqlc.InsertAddressParams{
			ID: id, UserID: userID, Label: in.Label, RecipientName: in.RecipientName, Phone: in.Phone,
			Street: in.Street, City: in.City, Province: in.Province, PostalCode: in.PostalCode, IsDefault: isDefault,
		})
		if err != nil {
			return writeError("insert address", err)
		}
		created = fromRow(sqlc.GetAddressRow(row))
		return nil
	})
	return created, err
}

// Update applies p to userID's address id in one transaction under the
// user lock. Errors: ErrNoUser, ErrNotFound, ErrDefaultRequired (p sets
// is_default false on the default address).
func (r *PostgresRepository) Update(ctx context.Context, userID, id string, p Patch) (Address, error) {
	var updated Address
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if err := lockUser(ctx, q, userID); err != nil {
			return err
		}
		current, err := q.GetAddress(ctx, sqlc.GetAddressParams{ID: id, UserID: userID})
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("query address: %w", err)
		}
		if p.IsDefault != nil {
			switch {
			case !*p.IsDefault && current.IsDefault:
				return ErrDefaultRequired
			case *p.IsDefault && !current.IsDefault:
				if err := q.ClearDefaultAddress(ctx, userID); err != nil {
					return fmt.Errorf("clear default: %w", err)
				}
			}
		}
		row, err := q.UpdateAddress(ctx, sqlc.UpdateAddressParams{
			ID: id, UserID: userID,
			Label: nullString(p.Label), RecipientName: nullString(p.RecipientName), Phone: nullString(p.Phone),
			Street: nullString(p.Street), City: nullString(p.City), Province: nullString(p.Province),
			PostalCode: nullString(p.PostalCode), IsDefault: nullBool(p.IsDefault),
		})
		if err != nil {
			return writeError("update address", err)
		}
		updated = fromRow(sqlc.GetAddressRow(row))
		return nil
	})
	return updated, err
}

// Delete removes userID's address id in one transaction under the user
// lock. When it was the default, the newest remaining address becomes the
// default. Errors: ErrNoUser, ErrNotFound.
func (r *PostgresRepository) Delete(ctx context.Context, userID, id string) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if err := lockUser(ctx, q, userID); err != nil {
			return err
		}
		wasDefault, err := q.DeleteAddress(ctx, sqlc.DeleteAddressParams{ID: id, UserID: userID})
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("delete address: %w", err)
		}
		if wasDefault {
			if err := q.PromoteNewestAddress(ctx, userID); err != nil {
				return fmt.Errorf("promote default: %w", err)
			}
		}
		return nil
	})
}

// lockUser locks the user's row for the rest of the transaction, or
// returns ErrNoUser for a deleted account.
func lockUser(ctx context.Context, q *sqlc.Queries, userID string) error {
	_, err := q.LockUser(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoUser
	}
	if err != nil {
		return fmt.Errorf("lock user: %w", err)
	}
	return nil
}

func fromRow(row sqlc.GetAddressRow) Address {
	return Address{
		ID: row.ID, Label: row.Label, RecipientName: row.RecipientName, Phone: row.Phone,
		Street: row.Street, City: row.City, Province: row.Province, PostalCode: row.PostalCode,
		IsDefault: row.IsDefault, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func nullString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

func nullBool(b *bool) sql.NullBool {
	if b == nil {
		return sql.NullBool{}
	}
	return sql.NullBool{Bool: *b, Valid: true}
}

// writeError maps invalid text (a backstop for the handler's checks) and
// wraps anything else.
func writeError(action string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "22021" {
		return ErrInvalidText
	}
	return fmt.Errorf("%s: %w", action, err)
}
