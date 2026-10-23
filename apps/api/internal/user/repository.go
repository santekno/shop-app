package user

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

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
