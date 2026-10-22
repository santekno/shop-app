package product

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// Repository is where products are stored. The service depends on this
// interface, so a test can hand it a fake instead of PostgreSQL.
type Repository interface {
	List(ctx context.Context, q ListQuery) ([]Product, error)
	GetBySlug(ctx context.Context, slug string) (Product, error)
	GetAdmin(ctx context.Context, id string) (AdminProduct, error)
	Create(ctx context.Context, in Input) (string, error)
	Update(ctx context.Context, id string, in Input) error
	Archive(ctx context.Context, id string) error
}

// CategoryFinder resolves a category slug; category.Service is one. The
// product feature asks the category feature instead of reading its tables.
type CategoryFinder interface {
	// IDsBySlug returns the IDs of the category and its children, or
	// category.ErrNotFound for an unknown slug.
	IDsBySlug(ctx context.Context, slug string) ([]string, error)
}

// Service holds the product rules: what a page is, and what a valid save
// is. The repository holds the SQL and the transactions.
type Service struct {
	repo       Repository
	categories CategoryFinder
}

// NewService returns a Service on repo that resolves category filters with
// categories.
func NewService(repo Repository, categories CategoryFinder) *Service {
	return &Service{repo: repo, categories: categories}
}

// ListParams is one storefront list request, already validated by the
// handler.
type ListParams struct {
	// Category is a category slug; empty for every category. Products of
	// its child categories are included.
	Category string
	// Query is search text matched against name and description; empty
	// (or only spaces) for no search. It combines with Category and Sort.
	Query string
	// Sort is the order; the zero value is not valid, use SortNewest.
	Sort Sort
	// Cursor is page.next_cursor of the previous page; empty for the first.
	Cursor string
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

// List returns one page of active products and the cursor of the next
// page. It returns ErrUnknownCategory for a category slug that names no
// category, and ErrInvalidCursor for a cursor this API did not make for the
// same sort and filters.
func (s *Service) List(ctx context.Context, params ListParams) (Page, error) {
	if params.Limit < 1 || params.Limit > MaxLimit {
		return Page{}, fmt.Errorf("list products: limit %d out of range", params.Limit)
	}
	switch params.Sort {
	case SortNewest, SortPriceAsc, SortPriceDesc:
	default:
		return Page{}, fmt.Errorf("list products: unknown sort %q", params.Sort)
	}
	params.Query = strings.TrimSpace(params.Query)
	after, err := decodeCursor(params)
	if err != nil {
		return Page{}, err
	}
	query := ListQuery{Search: params.Query, Sort: params.Sort, After: after, Limit: params.Limit + 1}
	if params.Category != "" {
		ids, err := s.categories.IDsBySlug(ctx, params.Category)
		if errors.Is(err, category.ErrNotFound) {
			return Page{}, ErrUnknownCategory
		}
		if err != nil {
			return Page{}, fmt.Errorf("list products: %w", err)
		}
		query.CategoryIDs = ids
	}

	// One more than asked: if it comes back, there is a next page, and no
	// COUNT(*) is needed to know it.
	products, err := s.repo.List(ctx, query)
	if err != nil {
		return Page{}, fmt.Errorf("list products: %w", err)
	}
	if len(products) <= params.Limit {
		return Page{Products: products}, nil
	}
	products = products[:params.Limit]
	return Page{Products: products, NextCursor: encodeCursor(params, products[len(products)-1])}, nil
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

// Archive takes the product with id off the storefront, or returns
// ErrNotFound. Nothing is deleted: order history keeps pointing at it.
func (s *Service) Archive(ctx context.Context, id string) error {
	if err := s.repo.Archive(ctx, id); err != nil {
		return fmt.Errorf("archive product %s: %w", id, err)
	}
	return nil
}
