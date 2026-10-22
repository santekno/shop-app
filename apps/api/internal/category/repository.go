package category

import (
	"context"
	"database/sql"
	"fmt"
	"slices"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// Repository is where categories are stored. The service depends on this
// interface, not on a concrete store: the API uses PostgresRepository, and
// tests can use MemoryRepository, without touching the service or the
// handler.
type Repository interface {
	// List returns every category, in no particular order.
	List(ctx context.Context) ([]Category, error)
	// IDsBySlug returns the IDs of the category with slug and of its
	// children, or ErrNotFound.
	IDsBySlug(ctx context.Context, slug string) ([]string, error)
}

// PostgresRepository reads categories from PostgreSQL with the queries sqlc
// generated from internal/db/queries/categories.sql.
type PostgresRepository struct {
	q *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's connection
// pool (or any database a test opens).
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{q: sqlc.New(db)}
}

// List returns every category, in no particular order.
func (r *PostgresRepository) List(ctx context.Context) ([]Category, error) {
	rows, err := r.q.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("query categories: %w", err)
	}
	categories := make([]Category, 0, len(rows))
	for _, row := range rows {
		categories = append(categories, Category{
			ID:       row.ID,
			Slug:     row.Slug,
			Name:     row.Name,
			ParentID: row.ParentID,
		})
	}
	return categories, nil
}

// IDsBySlug returns the IDs of the category with slug and of its children,
// or ErrNotFound.
func (r *PostgresRepository) IDsBySlug(ctx context.Context, slug string) ([]string, error) {
	ids, err := r.q.ListCategoryTreeIDs(ctx, slug)
	if err != nil {
		return nil, fmt.Errorf("query category %s: %w", slug, err)
	}
	if len(ids) == 0 {
		return nil, ErrNotFound
	}
	return ids, nil
}

// MemoryRepository keeps categories in memory. It is read-only, so it is safe
// for concurrent use without a lock.
type MemoryRepository struct {
	categories []Category
}

// NewMemoryRepository returns a repository holding a copy of categories.
func NewMemoryRepository(categories []Category) *MemoryRepository {
	return &MemoryRepository{categories: slices.Clone(categories)}
}

// List returns a copy of the stored categories, so a caller that sorts or
// edits the result cannot change what the next request sees. It returns
// ctx's error when the request was cancelled or timed out, like a database
// query would.
func (m *MemoryRepository) List(ctx context.Context) ([]Category, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return slices.Clone(m.categories), nil
}

// IDsBySlug returns the IDs of the category with slug and of its children,
// or ErrNotFound.
func (m *MemoryRepository) IDsBySlug(ctx context.Context, slug string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var id string
	for _, c := range m.categories {
		if c.Slug == slug {
			id = c.ID
		}
	}
	if id == "" {
		return nil, ErrNotFound
	}
	ids := []string{id}
	for _, c := range m.categories {
		if c.ParentID != nil && *c.ParentID == id {
			ids = append(ids, c.ID)
		}
	}
	return ids, nil
}

// SeedCategories returns the categories GoShop starts with: cmd/seed (make
// seed) writes them to PostgreSQL, and tests use them with MemoryRepository.
// Parents come before their children. IDs are new UUIDv7s on every call.
func SeedCategories() []Category {
	type child struct{ slug, name string }
	tree := []struct {
		slug, name string
		children   []child
	}{
		{"pakaian", "Pakaian", []child{{"kaos", "Kaos"}, {"kemeja", "Kemeja"}, {"celana", "Celana"}}},
		{"elektronik", "Elektronik", []child{{"ponsel", "Ponsel"}, {"aksesoris-ponsel", "Aksesoris Ponsel"}}},
		{"rumah-tangga", "Rumah Tangga", []child{{"peralatan-dapur", "Peralatan Dapur"}, {"dekorasi-rumah", "Dekorasi Rumah"}}},
		{"makanan-minuman", "Makanan & Minuman", []child{{"kopi-teh", "Kopi & Teh"}, {"camilan", "Camilan"}}},
	}

	var out []Category
	for _, parent := range tree {
		parentID := uuidx.NewV7()
		out = append(out, Category{ID: parentID, Slug: parent.slug, Name: parent.name})
		for _, c := range parent.children {
			out = append(out, Category{ID: uuidx.NewV7(), Slug: c.slug, Name: c.name, ParentID: &parentID})
		}
	}
	return out
}
