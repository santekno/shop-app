package user

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository reads and writes accounts in PostgreSQL with the
// queries sqlc generated from internal/db/queries/users.sql.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// Get returns the account with id, or ErrNotFound when there is none or
// it was deleted.
func (r *PostgresRepository) Get(ctx context.Context, id string) (User, error) {
	row, err := r.q.GetUserByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("query user: %w", err)
	}
	return fromRow(row), nil
}

// Update applies p to the account with id and returns it, or ErrNotFound.
func (r *PostgresRepository) Update(ctx context.Context, id string, p ProfileUpdate) (User, error) {
	params := sqlc.UpdateUserProfileParams{ID: id, SetPhone: p.SetPhone}
	if p.Name != nil {
		params.Name = sql.NullString{String: *p.Name, Valid: true}
	}
	if p.Phone != nil {
		params.Phone = sql.NullString{String: *p.Phone, Valid: true}
	}
	row, err := r.q.UpdateUserProfile(ctx, params)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("update user: %w", err)
	}
	return fromRow(sqlc.GetUserByIDRow(row)), nil
}

// Anonymise deletes the account with id the way docs/erd.md says, in one
// transaction: the users row stays (orders will point to it) but loses its
// email (deleted+<id>@invalid), name, phone and password; the user's
// addresses, sign-in identities and email tokens are deleted; and every
// session is revoked. It returns the revoked sessions' ids, or ErrNotFound
// when there is no such account or it was deleted already.
func (r *PostgresRepository) Anonymise(ctx context.Context, id string) ([]string, error) {
	var sessions []string
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		n, err := q.AnonymizeUser(ctx, id)
		if err != nil {
			return fmt.Errorf("anonymise user: %w", err)
		}
		if n == 0 {
			return ErrNotFound
		}
		if err := q.DeleteUserAddresses(ctx, id); err != nil {
			return fmt.Errorf("delete addresses: %w", err)
		}
		if err := q.DeleteUserIdentities(ctx, id); err != nil {
			return fmt.Errorf("delete identities: %w", err)
		}
		if err := q.DeleteUserTokens(ctx, id); err != nil {
			return fmt.Errorf("delete email tokens: %w", err)
		}
		sessions, err = q.RevokeUserSessions(ctx, id)
		if err != nil {
			return fmt.Errorf("revoke sessions: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return sessions, nil
}

// fromRow maps a users row to a User.
func fromRow(row sqlc.GetUserByIDRow) User {
	u := User{
		ID:        row.ID,
		Email:     row.Email,
		Name:      row.Name,
		Role:      Role(row.Role),
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
	if row.Phone.Valid {
		u.Phone = &row.Phone.String
	}
	if row.EmailVerifiedAt.Valid {
		u.EmailVerifiedAt = &row.EmailVerifiedAt.Time
	}
	return u
}
