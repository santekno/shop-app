package user

import (
	"context"
	"fmt"
)

// Repository is where accounts are stored.
type Repository interface {
	Get(ctx context.Context, id string) (User, error)
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
