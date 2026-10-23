package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// Purpose is what a one-time email token is for; the values are the ones
// user_tokens_purpose_check allows.
type Purpose string

// The two purposes.
const (
	PurposeVerifyEmail   Purpose = "verify_email"
	PurposeResetPassword Purpose = "reset_password"
)

// Errors for tokens sent by email.
var (
	// ErrEmailTokenInvalid means the token is malformed, unknown, for
	// another purpose, already used, or its account was deleted.
	ErrEmailTokenInvalid = errors.New("email token invalid")
	// ErrEmailTokenExpired means the token is genuine but too old; the user
	// asks for a new email.
	ErrEmailTokenExpired = errors.New("email token expired")
)

// NewEmailToken is a one-time token to store.
type NewEmailToken struct {
	Token     opaqueToken
	UserID    string
	Purpose   Purpose
	ExpiresAt time.Time
}

// CreateEmailToken stores t and, in the same transaction, deletes the user's
// unused tokens of the same purpose, so only the newest email works. It
// locks the user first: two emails requested at the same moment then run
// one after the other, so one token survives, not two; and the lock order
// (users, then tokens) matches account deletion. ErrNoUser when the
// account is gone.
func (r *PostgresRepository) CreateEmailToken(ctx context.Context, t NewEmailToken) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if _, err := q.LockUser(ctx, t.UserID); errors.Is(err, sql.ErrNoRows) {
			return ErrNoUser
		} else if err != nil {
			return fmt.Errorf("lock user: %w", err)
		}
		err := q.DeleteUnusedUserTokens(ctx, sqlc.DeleteUnusedUserTokensParams{UserID: t.UserID, Purpose: string(t.Purpose)})
		if err != nil {
			return fmt.Errorf("delete old tokens: %w", err)
		}
		err = q.InsertUserToken(ctx, sqlc.InsertUserTokenParams{
			ID: t.Token.ID, UserID: t.UserID, Purpose: string(t.Purpose), TokenHash: t.Token.Hash, ExpiresAt: t.ExpiresAt,
		})
		if err != nil {
			return fmt.Errorf("insert token: %w", err)
		}
		return nil
	})
}

// VerifyEmail uses a verify_email token and marks its user's email as
// verified, in one transaction. See consumeEmailToken for the errors.
func (r *PostgresRepository) VerifyEmail(ctx context.Context, presented opaqueToken, now time.Time) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		userID, err := consumeEmailToken(ctx, q, presented, PurposeVerifyEmail, now)
		if err != nil {
			return err
		}
		if err := q.MarkEmailVerified(ctx, userID); err != nil {
			return fmt.Errorf("mark email verified: %w", err)
		}
		return nil
	})
}

// GetUser returns the account with id, or ErrNoUser.
func (r *PostgresRepository) GetUser(ctx context.Context, id string) (user.User, error) {
	row, err := r.q.GetUserByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return user.User{}, ErrNoUser
	}
	if err != nil {
		return user.User{}, fmt.Errorf("query user: %w", err)
	}
	return userFromRow(row), nil
}

// consumeEmailToken locks presented's user and then its row, and marks it
// used, inside the caller's transaction, and returns its user's ID. It returns
// ErrEmailTokenInvalid for an unknown id, a wrong secret, another purpose,
// a used token or a deleted account, and ErrEmailTokenExpired when now is
// past its expiry; the caller's transaction then rolls back.
func consumeEmailToken(ctx context.Context, q *sqlc.Queries, presented opaqueToken, purpose Purpose, now time.Time) (string, error) {
	// The user first, then the token (ADR 0005 lock order).
	if _, err := q.LockUserTokenOwner(ctx, presented.ID); errors.Is(err, sql.ErrNoRows) {
		return "", ErrEmailTokenInvalid
	} else if err != nil {
		return "", fmt.Errorf("lock token owner: %w", err)
	}
	row, err := q.LockUserToken(ctx, presented.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrEmailTokenInvalid
	}
	if err != nil {
		return "", fmt.Errorf("lock token: %w", err)
	}
	switch {
	case !presented.matches(row.TokenHash) || Purpose(row.Purpose) != purpose ||
		row.UsedAt.Valid || row.AnonymizedAt.Valid:
		return "", ErrEmailTokenInvalid
	case !now.Before(row.ExpiresAt):
		return "", ErrEmailTokenExpired
	}
	if err := q.MarkUserTokenUsed(ctx, row.ID); err != nil {
		return "", fmt.Errorf("mark token used: %w", err)
	}
	return row.UserID, nil
}
