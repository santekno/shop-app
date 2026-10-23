package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// PostgresRepository stores accounts and their credentials in PostgreSQL
// with the queries sqlc generated from internal/db/queries.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// NewUser is an account to create. PasswordHash is empty for an account
// without a password (Google sign-in).
type NewUser struct {
	ID           string
	Email        string
	PasswordHash string
	Name         string
	Role         user.Role
}

// Credentials is a user with the password hash a login checks. Hash is
// empty for an account without a password (Google sign-in only).
type Credentials struct {
	User user.User
	Hash string
}

// ErrNoUser means no account (that is not anonymised) matches.
var ErrNoUser = errors.New("no such user")

// GetCredentials returns the account with email (already normalised) and
// its password hash, or ErrNoUser.
func (r *PostgresRepository) GetCredentials(ctx context.Context, email string) (Credentials, error) {
	row, err := r.q.GetUserByEmail(ctx, email)
	if errors.Is(err, sql.ErrNoRows) {
		return Credentials{}, ErrNoUser
	}
	if err != nil {
		return Credentials{}, fmt.Errorf("query user: %w", err)
	}
	return Credentials{User: userFromRow(sqlc.GetUserByIDRow(row)), Hash: row.PasswordHash.String}, nil
}

// CreateUser inserts u and returns it as stored, or ErrEmailTaken.
func (r *PostgresRepository) CreateUser(ctx context.Context, u NewUser) (user.User, error) {
	row, err := r.q.InsertUser(ctx, sqlc.InsertUserParams{
		ID:           u.ID,
		Email:        u.Email,
		PasswordHash: nullString(u.PasswordHash),
		Name:         u.Name,
		Role:         string(u.Role),
	})
	if err != nil {
		return user.User{}, writeError("insert user", err)
	}
	return userFromRow(sqlc.GetUserByIDRow(row)), nil
}

// userFromRow maps a users row (any of the queries that return its usual
// columns) to a user.User.
func userFromRow(row sqlc.GetUserByIDRow) user.User {
	u := user.User{
		ID:        row.ID,
		Email:     row.Email,
		Name:      row.Name,
		Role:      user.Role(row.Role),
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

func nullString(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }

// writeError turns the constraint violations a client can cause into the
// package's errors, matched by constraint name, and wraps anything else.
func writeError(action string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "22021" { // invalid UTF-8 or NUL: a backstop for the handler's checks
			return ErrInvalidText
		}
		if pgErr.ConstraintName == "users_email_key" {
			return ErrEmailTaken
		}
	}
	return fmt.Errorf("%s: %w", action, err)
}
