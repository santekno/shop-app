package address

import (
	"context"
	"fmt"

	"github.com/santekno/sdk/uuidx"
)

// Repository is where addresses are stored.
type Repository interface {
	List(ctx context.Context, userID string) ([]Address, error)
	Get(ctx context.Context, userID, id string) (Address, error)
	Create(ctx context.Context, userID, id string, in Input) (Address, error)
	Update(ctx context.Context, userID, id string, p Patch) (Address, error)
	Delete(ctx context.Context, userID, id string) error
}

// Service holds the address-book rules. Every method takes the caller's
// user ID: that is what scopes each query to the caller's own addresses.
type Service struct {
	repo  Repository
	newID func() string
}

// NewService returns a Service on repo.
func NewService(repo Repository) *Service {
	return &Service{repo: repo, newID: uuidx.NewV7}
}

// List returns userID's addresses, the default first.
func (s *Service) List(ctx context.Context, userID string) ([]Address, error) {
	list, err := s.repo.List(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list addresses: %w", err)
	}
	return list, nil
}

// Get returns userID's address id, or ErrNotFound.
func (s *Service) Get(ctx context.Context, userID, id string) (Address, error) {
	a, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return Address{}, fmt.Errorf("get address %s: %w", id, err)
	}
	return a, nil
}

// Create adds an address for userID. The first one is the default.
func (s *Service) Create(ctx context.Context, userID string, in Input) (Address, error) {
	a, err := s.repo.Create(ctx, userID, s.newID(), in)
	if err != nil {
		return Address{}, fmt.Errorf("create address: %w", err)
	}
	return a, nil
}

// Update changes userID's address id.
func (s *Service) Update(ctx context.Context, userID, id string, p Patch) (Address, error) {
	a, err := s.repo.Update(ctx, userID, id, p)
	if err != nil {
		return Address{}, fmt.Errorf("update address %s: %w", id, err)
	}
	return a, nil
}

// Delete removes userID's address id.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	if err := s.repo.Delete(ctx, userID, id); err != nil {
		return fmt.Errorf("delete address %s: %w", id, err)
	}
	return nil
}
