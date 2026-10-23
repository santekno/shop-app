package user

import (
	"context"
	"fmt"
)

// Repository is where accounts are stored.
type Repository interface {
	Get(ctx context.Context, id string) (User, error)
	Update(ctx context.Context, id string, p ProfileUpdate) (User, error)
	Anonymise(ctx context.Context, id string) ([]string, error)
}

// Service holds the rules for a user's own account.
type Service struct {
	repo Repository
}

// NewService returns a Service on repo.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
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
// returns ErrNotFound. Its sessions end in the same transaction.
func (s *Service) Delete(ctx context.Context, id string) error {
	if _, err := s.repo.Anonymise(ctx, id); err != nil {
		return fmt.Errorf("delete user %s: %w", id, err)
	}
	return nil
}
