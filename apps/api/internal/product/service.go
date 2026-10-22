package product

import (
	"context"
	"fmt"
)

// Repository is where products are stored. The service depends on this
// interface, so a test can hand it a fake instead of PostgreSQL.
type Repository interface {
	List(ctx context.Context, q ListQuery) ([]Product, error)
	GetBySlug(ctx context.Context, slug string) (Product, error)
	GetAdmin(ctx context.Context, id string) (AdminProduct, error)
	Create(ctx context.Context, in Input) (string, error)
	Update(ctx context.Context, id string, in Input) error
}

// Service holds the product rules: what a page is, and what a valid save
// is. The repository holds the SQL and the transactions.
type Service struct {
	repo Repository
}

// NewService returns a Service on repo.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// ListParams is one storefront list request, already validated by the
// handler.
type ListParams struct {
	// Limit is the page size, 1 to MaxLimit.
	Limit int
}

// MaxLimit is the largest page size.
const MaxLimit = 100

// Page is one page of the storefront list.
type Page struct {
	Products []Product
	// NextCursor is passed back to get the next page; empty on the last
	// page.
	NextCursor string
}

// List returns one page of active products, newest first.
func (s *Service) List(ctx context.Context, params ListParams) (Page, error) {
	if params.Limit < 1 || params.Limit > MaxLimit {
		return Page{}, fmt.Errorf("list products: limit %d out of range", params.Limit)
	}
	products, err := s.repo.List(ctx, ListQuery{Limit: params.Limit})
	if err != nil {
		return Page{}, fmt.Errorf("list products: %w", err)
	}
	return Page{Products: products}, nil
}

// Get returns the active product with slug, or ErrNotFound.
func (s *Service) Get(ctx context.Context, slug string) (Product, error) {
	p, err := s.repo.GetBySlug(ctx, slug)
	if err != nil {
		return Product{}, fmt.Errorf("get product %s: %w", slug, err)
	}
	return p, nil
}

// GetAdmin returns any product by ID for the admin, or ErrNotFound.
func (s *Service) GetAdmin(ctx context.Context, id string) (AdminProduct, error) {
	p, err := s.repo.GetAdmin(ctx, id)
	if err != nil {
		return AdminProduct{}, fmt.Errorf("get product %s: %w", id, err)
	}
	return p, nil
}

// Create stores a new product with its variants and returns it as the admin
// sees it. New variants must not carry an ID.
func (s *Service) Create(ctx context.Context, in Input) (AdminProduct, error) {
	for _, v := range in.Variants {
		if v.ID != "" {
			return AdminProduct{}, ErrUnknownVariant
		}
	}
	id, err := s.repo.Create(ctx, in)
	if err != nil {
		return AdminProduct{}, fmt.Errorf("create product: %w", err)
	}
	return s.GetAdmin(ctx, id)
}

// Update saves the product with id and its variants, and returns it as the
// admin sees it.
func (s *Service) Update(ctx context.Context, id string, in Input) (AdminProduct, error) {
	if err := s.repo.Update(ctx, id, in); err != nil {
		return AdminProduct{}, fmt.Errorf("update product %s: %w", id, err)
	}
	return s.GetAdmin(ctx, id)
}
