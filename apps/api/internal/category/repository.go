package category

import (
	"context"
	"slices"

	"github.com/santekno/sdk/uuidx"
)

// Repository is where categories are stored. The service depends on this
// interface, not on a concrete store: Bab 2 uses MemoryRepository, Bab 3
// swaps in PostgreSQL without touching the service or the handler.
type Repository interface {
	// List returns every category, in no particular order.
	List(ctx context.Context) ([]Category, error)
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
