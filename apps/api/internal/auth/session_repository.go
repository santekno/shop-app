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

// Refresh-token errors.
var (
	// ErrRefreshTokenInvalid means the token is malformed, unknown,
	// revoked, or belongs to a deleted account.
	ErrRefreshTokenInvalid = errors.New("refresh token invalid")
	// ErrRefreshTokenExpired means the token is genuine but past its
	// expiry; the user logs in again.
	ErrRefreshTokenExpired = errors.New("refresh token expired")
	// ErrRefreshTokenReused means the token was already rotated. Someone
	// else holds a copy, so its whole session has been revoked.
	ErrRefreshTokenReused = errors.New("refresh token reused")
)

// NewRefreshToken is a refresh token to store.
type NewRefreshToken struct {
	Token     opaqueToken
	UserID    string
	FamilyID  string
	ExpiresAt time.Time
	// VerifiedHash is the password hash a password login just verified;
	// empty for a session that did not come from a password (Google).
	VerifiedHash string
}

// Rotated is the outcome of a rotation.
type Rotated struct {
	// User is the account, read in the same transaction, so a new access
	// token carries the user's current role.
	User user.User
	// FamilyID is the session. It is set for ErrRefreshTokenReused too:
	// the session that was just revoked.
	FamilyID string
}

// CreateRefreshToken stores the first token of a new session, in one
// transaction that first locks the user (FOR SHARE, the users ->
// refresh_tokens lock order of ADR 0005). A login verifies the password
// before it gets here, and argon2id takes a while; a password reset or an
// account deletion may commit in between. So it refuses:
//
//   - a deleted (anonymised) account: ErrNoUser;
//   - a password login whose verified hash (t.VerifiedHash) is no longer
//     the account's hash, because the password was reset meanwhile:
//     ErrInvalidCredentials.
//
// A reset or deletion still in flight makes it wait, and then refuses too.
func (r *PostgresRepository) CreateRefreshToken(ctx context.Context, t NewRefreshToken) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		owner, err := q.LockSessionOwner(ctx, t.UserID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNoUser
		}
		if err != nil {
			return fmt.Errorf("lock session owner: %w", err)
		}
		if owner.AnonymizedAt.Valid {
			return ErrNoUser
		}
		if t.VerifiedHash != "" && owner.PasswordHash.String != t.VerifiedHash {
			return ErrInvalidCredentials
		}
		if err := insertRefreshToken(ctx, q, t); err != nil {
			return fmt.Errorf("insert refresh token: %w", err)
		}
		return nil
	})
}

func insertRefreshToken(ctx context.Context, q *sqlc.Queries, t NewRefreshToken) error {
	return q.InsertRefreshToken(ctx, sqlc.InsertRefreshTokenParams{
		ID: t.Token.ID, UserID: t.UserID, FamilyID: t.FamilyID, TokenHash: t.Token.Hash, ExpiresAt: t.ExpiresAt,
	})
}

// RotateRefreshToken replaces presented with next in one transaction. It
// locks the token's user (FOR SHARE) and then the token row, so two
// refreshes with the same token cannot both succeed, and a concurrent
// password reset or account deletion cannot miss the new token:
//
//   - unknown id, wrong secret, revoked token or deleted account:
//     ErrRefreshTokenInvalid, nothing changes;
//   - already rotated (used): the whole family is revoked and committed,
//     then ErrRefreshTokenReused is returned with the family in Rotated;
//   - past expiresAt at now: ErrRefreshTokenExpired;
//   - otherwise presented is marked used and next is stored in the same
//     family with nextExpiresAt.
//
// A wrong secret does not revoke anything: only the holder of a real token
// can end a session, not someone guessing ids.
func (r *PostgresRepository) RotateRefreshToken(ctx context.Context, presented, next opaqueToken, now, nextExpiresAt time.Time) (Rotated, error) {
	var out Rotated
	reused := false
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		// The user first, then the token: the lock order every
		// transaction on a user's tokens follows (ADR 0005), so a password
		// reset or an account deletion either waits for this rotation and
		// revokes the new token too, or makes this rotation wait and fail.
		if _, err := q.LockRefreshTokenOwner(ctx, presented.ID); errors.Is(err, sql.ErrNoRows) {
			return ErrRefreshTokenInvalid
		} else if err != nil {
			return fmt.Errorf("lock token owner: %w", err)
		}
		row, err := q.LockRefreshToken(ctx, presented.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrRefreshTokenInvalid
		}
		if err != nil {
			return fmt.Errorf("lock refresh token: %w", err)
		}
		switch {
		case !presented.matches(row.TokenHash) || row.RevokedAt.Valid || row.AnonymizedAt.Valid:
			return ErrRefreshTokenInvalid
		case row.UsedAt.Valid:
			reused, out.FamilyID = true, row.FamilyID
			if err := q.RevokeRefreshFamily(ctx, row.FamilyID); err != nil {
				return fmt.Errorf("revoke session: %w", err)
			}
			return nil // commit the revocation; the error is returned below
		case !now.Before(row.ExpiresAt):
			return ErrRefreshTokenExpired
		}
		if err := q.MarkRefreshTokenUsed(ctx, row.ID); err != nil {
			return fmt.Errorf("mark refresh token used: %w", err)
		}
		err = insertRefreshToken(ctx, q, NewRefreshToken{
			Token: next, UserID: row.UserID, FamilyID: row.FamilyID, ExpiresAt: nextExpiresAt,
		})
		if err != nil {
			return fmt.Errorf("insert refresh token: %w", err)
		}
		out = Rotated{FamilyID: row.FamilyID, User: userFromRow(sqlc.GetUserByIDRow{
			ID: row.UserID, Email: row.Email, Name: row.Name, Phone: row.Phone, Role: row.Role,
			EmailVerifiedAt: row.EmailVerifiedAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		})}
		return nil
	})
	if err != nil {
		return Rotated{}, err
	}
	if reused {
		return out, ErrRefreshTokenReused
	}
	return out, nil
}

// RevokeSessionOf revokes the session (family) of presented and returns its
// id. An unknown token, or one whose secret does not match, revokes
// nothing and returns "" without an error: logging out twice is fine.
//
// It runs in one transaction that locks the token's user first (FOR NO KEY
// UPDATE, which conflicts with a rotation's FOR SHARE): a refresh in flight
// finishes before the family is revoked, so the token it issued is revoked
// too, instead of keeping the session alive.
func (r *PostgresRepository) RevokeSessionOf(ctx context.Context, presented opaqueToken) (string, error) {
	var sessionID string
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if _, err := q.LockRefreshTokenOwnerForLogout(ctx, presented.ID); errors.Is(err, sql.ErrNoRows) {
			return nil
		} else if err != nil {
			return fmt.Errorf("lock token owner: %w", err)
		}
		row, err := q.GetRefreshToken(ctx, presented.ID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("query refresh token: %w", err)
		}
		if !presented.matches(row.TokenHash) {
			return nil
		}
		if err := q.RevokeRefreshFamily(ctx, row.FamilyID); err != nil {
			return fmt.Errorf("revoke session: %w", err)
		}
		sessionID = row.FamilyID
		return nil
	})
	if err != nil {
		return "", err
	}
	return sessionID, nil
}
