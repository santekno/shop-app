package user

import (
	"context"
	"fmt"

	"github.com/santekno/sdk/logx"
)

// Repository is where accounts are stored.
type Repository interface {
	Get(ctx context.Context, id string) (User, error)
	Update(ctx context.Context, id string, p ProfileUpdate) (User, error)
	Anonymise(ctx context.Context, id string) ([]string, error)
}

// SessionRevoker ends sessions at once, so their access tokens stop
// working before they expire; auth.RedisSessionRevocations is one. The
// interface lives here so this package does not import auth.
type SessionRevoker interface {
	Revoke(ctx context.Context, sessionIDs ...string) error
}

// Service holds the rules for a user's own account.
type Service struct {
	repo    Repository
	revoker SessionRevoker
}

// NewService returns a Service on repo that ends the sessions of a deleted
// account through revoker.
func NewService(repo Repository, revoker SessionRevoker) *Service {
	return &Service{repo: repo, revoker: revoker}
}

// Get returns the account with id, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id string) (User, error) {
	u, err := s.repo.Get(ctx, id)
	if err != nil {
		return User{}, fmt.Errorf("get user %s: %w", id, err)
	}
	return u, nil
}

// Update changes the profile of the account with id and returns it, or
// ErrNotFound. The email cannot change here: a new address would need
// verifying first, which GoShop does not do yet.
func (s *Service) Update(ctx context.Context, id string, p ProfileUpdate) (User, error) {
	u, err := s.repo.Update(ctx, id, p)
	if err != nil {
		return User{}, fmt.Errorf("update user %s: %w", id, err)
	}
	return u, nil
}

// Delete deletes the account with id by anonymising it (docs/erd.md), or
// returns ErrNotFound. Its refresh tokens are revoked in the same
// transaction; its access tokens are revoked in Redis right after. That
// second step is logged, not returned, when it fails: the account is gone
// either way, and the tokens expire within APP_ACCESS_TOKEN_TTL.
func (s *Service) Delete(ctx context.Context, id string) error {
	sessions, err := s.repo.Anonymise(ctx, id)
	if err != nil {
		return fmt.Errorf("delete user %s: %w", id, err)
	}
	if len(sessions) == 0 {
		return nil
	}
	if err := s.revoker.Revoke(ctx, sessions...); err != nil {
		logx.FromContext(ctx).Error("revoke access tokens of a deleted account",
			"sessions", len(sessions), "error", err.Error())
	}
	return nil
}
