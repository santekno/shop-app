package product

import (
	"context"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// fakeRepo is a Repository that records what the service asked for and
// answers from its fields, so the service is tested without PostgreSQL.
type fakeRepo struct {
	listQueries []ListQuery
	listResult  []Product
	listErr     error

	getSlug string
	getErr  error

	adminIDs []string
	admin    AdminProduct
	adminErr error

	created   []Input
	createID  string
	createErr error

	updatedID string
	updated   Input
	updateErr error

	archived   []string
	archiveErr error
}

func (f *fakeRepo) List(_ context.Context, q ListQuery) ([]Product, error) {
	f.listQueries = append(f.listQueries, q)
	return f.listResult, f.listErr
}

func (f *fakeRepo) GetBySlug(_ context.Context, slug string) (Product, error) {
	f.getSlug = slug
	if f.getErr != nil {
		return Product{}, f.getErr
	}
	return Product{ID: "p-" + slug, Slug: slug}, nil
}

func (f *fakeRepo) GetAdmin(_ context.Context, id string) (AdminProduct, error) {
	f.adminIDs = append(f.adminIDs, id)
	if f.adminErr != nil {
		return AdminProduct{}, f.adminErr
	}
	p := f.admin
	p.ID = id
	return p, nil
}

func (f *fakeRepo) Create(_ context.Context, in Input) (string, error) {
	f.created = append(f.created, in)
	return f.createID, f.createErr
}

func (f *fakeRepo) Update(_ context.Context, id string, in Input) error {
	f.updatedID, f.updated = id, in
	return f.updateErr
}

func (f *fakeRepo) Archive(_ context.Context, id string) error {
	f.archived = append(f.archived, id)
	return f.archiveErr
}

// fakeCategories resolves the slugs in ids to those IDs (a category and
// its children); any other slug is category.ErrNotFound, and err (when set)
// is returned for every slug.
type fakeCategories struct {
	ids   map[string][]string
	err   error
	asked []string
}

func (f *fakeCategories) IDsBySlug(_ context.Context, slug string) ([]string, error) {
	f.asked = append(f.asked, slug)
	if f.err != nil {
		return nil, f.err
	}
	ids, ok := f.ids[slug]
	if !ok {
		// Wrapped, as category.Service returns it.
		return nil, fmt.Errorf("find category %s: %w", slug, category.ErrNotFound)
	}
	return ids, nil
}

// testProducts returns n products, newest first, with valid UUIDs, a
// creation time each, increasing prices and one sellable variant each (the
// service leaves out products without one).
func testProducts(n int) []Product {
	base := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	products := make([]Product, n)
	for i := range products {
		products[i] = Product{
			ID:        fmt.Sprintf("0190c8a0-0000-7000-8000-%012d", i+1),
			Slug:      fmt.Sprintf("produk-%d", i+1),
			PriceFrom: int64(10_000 * (i + 1)),
			CreatedAt: base.Add(-time.Duration(i) * time.Hour),
			Variants:  []Variant{{ID: fmt.Sprintf("0190c8a0-0000-7000-9000-%012d", i+1), SKU: fmt.Sprintf("SKU-%d", i+1), Price: int64(10_000 * (i + 1)), Stock: 1}},
		}
	}
	return products
}
