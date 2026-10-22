//go:build integration

package integration_test

import (
	"database/sql"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// insertCategories stores cats with plain SQL: the API has no endpoint that
// writes categories, so tests put them in the way the seed does.
func insertCategories(t *testing.T, db *sql.DB, cats []category.Category) {
	t.Helper()
	for _, c := range cats {
		level, parentLevel := 1, sql.NullInt16{}
		if c.ParentID != nil {
			level, parentLevel = 2, sql.NullInt16{Int16: 1, Valid: true}
		}
		mustExec(t, db, `INSERT INTO categories (id, parent_id, level, parent_level, name, slug)
			VALUES ($1, $2, $3, $4, $5, $6)`, c.ID, c.ParentID, level, parentLevel, c.Name, c.Slug)
	}
}

// seedCategories stores the 13 categories of the example catalog (four
// parents, nine children) and returns their IDs by slug.
func seedCategories(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	cats := category.SeedCategories()
	insertCategories(t, db, cats)
	ids := make(map[string]string, len(cats))
	for _, c := range cats {
		ids[c.Slug] = c.ID
	}
	return ids
}
