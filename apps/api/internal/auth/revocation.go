package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/redisx"
)

// SessionRevocations ends sessions before their access tokens expire
// (ADR 0005). The API uses RedisSessionRevocations; a test passes a fake.
type SessionRevocations interface {
	// Revoke marks the sessions as ended: their access tokens stop working
	// at the next request.
	Revoke(ctx context.Context, sessionIDs ...string) error
	// IsRevoked reports whether the session has been revoked.
	IsRevoked(ctx context.Context, sessionID string) (bool, error)
}

// revokedPrefix starts the key of a revoked session.
const revokedPrefix = "goshop:session-revoked:"

// RedisSessionRevocations keeps one key per revoked session in Redis,
// through sdk redisx. A key lives as long as an access token (ttl): by then
// every access token of the session has expired on its own, and the
// session's refresh tokens are already revoked in PostgreSQL, so the key
// has nothing left to stop.
type RedisSessionRevocations struct {
	kv  redisx.RedisClient
	ttl time.Duration
}

// NewRedisSessionRevocations returns revocations stored through kv that
// last ttl (APP_ACCESS_TOKEN_TTL).
func NewRedisSessionRevocations(kv redisx.RedisClient, ttl time.Duration) *RedisSessionRevocations {
	return &RedisSessionRevocations{kv: kv, ttl: ttl}
}

// Revoke implements SessionRevocations.
func (r *RedisSessionRevocations) Revoke(ctx context.Context, sessionIDs ...string) error {
	for _, id := range sessionIDs {
		if err := r.kv.Set(ctx, revokedPrefix+id, "1", r.ttl); err != nil {
			return fmt.Errorf("revoke session %s: %w", id, err)
		}
	}
	return nil
}

// IsRevoked implements SessionRevocations: one GET per request.
func (r *RedisSessionRevocations) IsRevoked(ctx context.Context, sessionID string) (bool, error) {
	_, err := r.kv.Get(ctx, revokedPrefix+sessionID)
	switch {
	case errors.Is(err, redisx.ErrKeyNotFound):
		return false, nil
	case err != nil:
		return false, fmt.Errorf("check session %s: %w", sessionID, err)
	}
	return true, nil
}
