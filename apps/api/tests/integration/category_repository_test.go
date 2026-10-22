//go:build integration

package integration_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// TestCategoryRepository_List reads the categories back from PostgreSQL
// exactly as they were stored.
func TestCategoryRepository_List(t *testing.T) {
	_, db := newTestDB(t)
	repo := category.NewPostgresRepository(db)
	ctx := t.Context()

	empty, err := repo.List(ctx)
	if err != nil || len(empty) != 0 {
		t.Fatalf("List on an empty table = %v, %v; want no categories and no error", empty, err)
	}

	want := category.SeedCategories()
	insertCategories(t, db, want)
	got, err := repo.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("List returned %d categories, want %d", len(got), len(want))
	}
	byID := map[string]category.Category{}
	for _, c := range got {
		byID[c.ID] = c
	}
	for _, w := range want {
		g, ok := byID[w.ID]
		switch {
		case !ok:
			t.Errorf("category %s (%s) missing", w.Slug, w.ID)
		case g.Slug != w.Slug || g.Name != w.Name:
			t.Errorf("category %s = %+v, want %+v", w.ID, g, w)
		case (g.ParentID == nil) != (w.ParentID == nil) || (g.ParentID != nil && *g.ParentID != *w.ParentID):
			t.Errorf("category %s parent = %v, want %v", w.Slug, g.ParentID, w.ParentID)
		}
	}
}

// TestCategoryRepository_IDsBySlug checks what ?category= covers: the
// category and its children, and ErrNotFound for a slug that names none.
func TestCategoryRepository_IDsBySlug(t *testing.T) {
	_, db := newTestDB(t)
	ids := seedCategories(t, db)
	rare := uuidx.NewV7()
	insertCategories(t, db, []category.Category{{ID: rare, Slug: "barang-langka", Name: "Barang Langka"}})
	repo := category.NewPostgresRepository(db)

	tests := []struct {
		slug string
		want []string // slugs; nil means ErrNotFound
	}{
		{"pakaian", []string{"pakaian", "kaos", "kemeja", "celana"}},
		{"elektronik", []string{"elektronik", "ponsel", "aksesoris-ponsel"}},
		{"kaos", []string{"kaos"}},
		{"barang-langka", []string{"barang-langka"}}, // a parent without children
		{"sepatu", nil},
		{"", nil},
		{"Kaos", nil}, // slugs are case-sensitive
	}
	ids["barang-langka"] = rare
	for _, tt := range tests {
		t.Run(tt.slug, func(t *testing.T) {
			got, err := repo.IDsBySlug(t.Context(), tt.slug)
			if tt.want == nil {
				if !errors.Is(err, category.ErrNotFound) {
					t.Fatalf("IDsBySlug(%q) = %v, %v; want ErrNotFound", tt.slug, got, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("IDsBySlug(%q): %v", tt.slug, err)
			}
			var want []string
			for _, s := range tt.want {
				want = append(want, ids[s])
			}
			slices.Sort(got)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Errorf("IDsBySlug(%q) = %v, want the IDs of %v", tt.slug, got, tt.want)
			}
		})
	}
}
