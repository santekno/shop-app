package category

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"strings"
)

// Service holds the category rules. Today there is one: the listing order.
type Service struct {
	repo Repository
}

// NewService returns a Service that reads categories from repo.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// List returns every category in the order the contract promises: top-level
// categories before children, each group sorted by name.
//
// The order is applied here rather than left to the store, so it is the same
// for the in-memory repository and for PostgreSQL, whose collation would sort
// names differently from Go.
func (s *Service) List(ctx context.Context) ([]Category, error) {
	categories, err := s.repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	slices.SortStableFunc(categories, compareForListing)
	return categories, nil
}

// IDsBySlug returns the IDs of the category with slug and of its children,
// or ErrNotFound. Other features use it to resolve a category filter,
// instead of reading the category tables themselves.
func (s *Service) IDsBySlug(ctx context.Context, slug string) ([]string, error) {
	ids, err := s.repo.IDsBySlug(ctx, slug)
	if err != nil {
		return nil, fmt.Errorf("find category %s: %w", slug, err)
	}
	return ids, nil
}

// compareForListing orders parents first, then by case-insensitive name, then
// by slug so two categories with the same name still have a stable order.
func compareForListing(a, b Category) int {
	if a.IsTopLevel() != b.IsTopLevel() {
		if a.IsTopLevel() {
			return -1
		}
		return 1
	}
	return cmp.Or(
		strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)),
		strings.Compare(a.Slug, b.Slug),
	)
}
