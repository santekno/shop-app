package wishlist

import (
	"context"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

// Products turns product IDs into storefront products; product's
// PostgresRepository is one. The wishlist asks the product feature instead
// of reading its tables.
type Products interface {
	// ListActiveByIDs returns the active products among ids, in no
	// particular order.
	ListActiveByIDs(ctx context.Context, ids []string) ([]product.Product, error)
}

// Service holds the wishlist rules: the size limit, and what a page is.
type Service struct {
	repo     Repository
	products Products
}

// NewService returns a Service that stores entries in repo and reads the
// products of a page from products.
func NewService(repo Repository, products Products) *Service {
	return &Service{repo: repo, products: products}
}

// Page is one page of the wishlist.
type Page struct {
	// Products are the saved products, newest saved first.
	Products []product.Product
	// NextCursor is passed back to get the next page; empty on the last
	// page.
	NextCursor string
}

// Add saves the active product with slug for userID; saving it again is a
// success that changes nothing. It returns ErrProductNotFound for a slug
// that names no active product, ErrLimitReached when userID has MaxItems
// products saved already, and ErrNoUser for a deleted account.
func (s *Service) Add(ctx context.Context, userID, slug string) error {
	if err := s.repo.Add(ctx, userID, slug); err != nil {
		return fmt.Errorf("add to wishlist: %w", err)
	}
	return nil
}

// Remove takes the product with slug off userID's wishlist. It is a success
// when the product was not there.
func (s *Service) Remove(ctx context.Context, userID, slug string) error {
	if err := s.repo.Remove(ctx, userID, slug); err != nil {
		return fmt.Errorf("remove from wishlist: %w", err)
	}
	return nil
}

// List returns one page of userID's wishlist, newest saved first, and the
// cursor of the next page. It returns ErrInvalidCursor for a cursor this
// API did not make for the wishlist.
func (s *Service) List(ctx context.Context, userID, cursor string, limit int) (Page, error) {
	if limit < 1 || limit > MaxLimit {
		return Page{}, fmt.Errorf("list wishlist: limit %d out of range", limit)
	}
	after, err := decodeCursor(cursor)
	if err != nil {
		return Page{}, err
	}
	// One more than asked: if it comes back, there is a next page, and no
	// COUNT(*) is needed to know it.
	entries, err := s.repo.List(ctx, userID, after, limit+1)
	if err != nil {
		return Page{}, fmt.Errorf("list wishlist: %w", err)
	}
	page := Page{}
	if len(entries) > limit {
		entries = entries[:limit]
		page.NextCursor = encodeCursor(entries[len(entries)-1])
	}
	page.Products, err = s.productsInOrder(ctx, entries)
	if err != nil {
		return Page{}, err
	}
	return page, nil
}

// productsInOrder loads the products of entries and returns them in the
// entries' order. An entry whose product stopped being active between the
// two reads is left out.
func (s *Service) productsInOrder(ctx context.Context, entries []Entry) ([]product.Product, error) {
	if len(entries) == 0 {
		return []product.Product{}, nil
	}
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.ProductID
	}
	loaded, err := s.products.ListActiveByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list wishlist: %w", err)
	}
	byID := make(map[string]product.Product, len(loaded))
	for _, p := range loaded {
		byID[p.ID] = p
	}
	out := make([]product.Product, 0, len(entries))
	for _, e := range entries {
		if p, ok := byID[e.ProductID]; ok {
			out = append(out, p)
		}
	}
	return out, nil
}
