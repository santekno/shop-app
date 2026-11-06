package banner

import (
	"context"
	"fmt"
)

// Service holds the banner rules. Today there are none beyond "active
// banners, in order", which the repository already guarantees; the service
// keeps the layering the other features have.
type Service struct {
	repo Repository
}

// NewService returns a Service that reads banners from repo.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// List returns the active banners in carousel order.
func (s *Service) List(ctx context.Context) ([]Banner, error) {
	banners, err := s.repo.ListActive(ctx)
	if err != nil {
		return nil, fmt.Errorf("list banners: %w", err)
	}
	return banners, nil
}
