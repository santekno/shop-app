package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// seedCategories inserts the category tree and returns every category's
// database ID by slug. Existing categories keep their ID.
func seedCategories(ctx context.Context, db *sql.DB) (map[string]string, error) {
	tree := category.SeedCategories() // parents come before their children
	slugOf := make(map[string]string, len(tree))
	for _, c := range tree {
		slugOf[c.ID] = c.Slug
	}

	ids := make(map[string]string, len(tree))
	for _, c := range tree {
		level, parentID, parentLevel := 1, any(nil), any(nil)
		if c.ParentID != nil {
			level, parentID, parentLevel = 2, ids[slugOf[*c.ParentID]], 1
		}
		_, err := db.ExecContext(ctx, `
			INSERT INTO categories (id, parent_id, level, parent_level, name, slug)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (slug) DO NOTHING`,
			c.ID, parentID, level, parentLevel, c.Name, c.Slug)
		if err != nil {
			return nil, fmt.Errorf("insert %s: %w", c.Slug, err)
		}
		var id string
		if err := db.QueryRowContext(ctx, `SELECT id FROM categories WHERE slug = $1`, c.Slug).Scan(&id); err != nil {
			return nil, fmt.Errorf("look up %s: %w", c.Slug, err)
		}
		ids[c.Slug] = id
	}
	return ids, nil
}

// insertProduct inserts p and its variants in one transaction, with
// price_from computed from the variants, as the API does. It returns false,
// and inserts nothing, when a product with p's slug already exists.
// createdAt backdates generated products; the zero time means now.
//
// The SQL is written here rather than taken from the sqlc queries, because
// a seed needs what the API never does: ON CONFLICT to skip what exists,
// a backdated created_at, and archived variants inserted as archived.
func insertProduct(ctx context.Context, db *sql.DB, categoryID string, p seedProduct, status string, createdAt time.Time) (bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // a no-op after Commit

	productID := uuidx.NewV7()
	var inserted bool
	err = tx.QueryRowContext(ctx, `
		INSERT INTO products (id, category_id, name, slug, description, status, price_from, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), COALESCE($8, now()))
		ON CONFLICT (slug) DO NOTHING
		RETURNING true`,
		productID, categoryID, p.name, p.slug, p.description, status, priceFrom(p.variants),
		sql.NullTime{Time: createdAt, Valid: !createdAt.IsZero()},
	).Scan(&inserted)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil // the slug exists: leave that product alone
	}
	if err != nil {
		return false, fmt.Errorf("insert product: %w", err)
	}

	for i, v := range p.variants {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO product_variants (id, product_id, sku, name, price, stock, weight_grams, position, archived_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() END)`,
			uuidx.NewV7(), productID, v.sku, v.name, v.price, v.stock, v.weight, i, v.archived)
		if err != nil {
			return false, fmt.Errorf("insert variant %s: %w", v.sku, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit: %w", err)
	}
	return true, nil
}

// priceFrom is the lowest price among the variants that are not archived,
// or NULL when every variant is archived.
func priceFrom(variants []seedVariant) sql.NullInt64 {
	var lowest sql.NullInt64
	for _, v := range variants {
		if !v.archived && (!lowest.Valid || v.price < lowest.Int64) {
			lowest = sql.NullInt64{Int64: v.price, Valid: true}
		}
	}
	return lowest
}

// seedGenerated adds n products derived from the example catalog, with
// random prices, stock and age. The random source has a fixed seed, so a
// second run produces the same slugs and inserts nothing new. One product in
// 20 is a draft and one in 50 archived, so the partial indexes have rows to
// leave out.
func seedGenerated(ctx context.Context, db *sql.DB, categoryIDs map[string]string, n int) error {
	rng := rand.New(rand.NewPCG(3, 2026)) //nolint:gosec // dummy data, not security
	now := time.Now()
	added := 0
	for i := 1; i <= n; i++ {
		base := catalog[rng.IntN(len(catalog))]
		// A brand and an edition give the generated text more distinct
		// words, so full-text statistics look like a real catalog's.
		brand, edition := brands[rng.IntN(len(brands))], editions[rng.IntN(len(editions))]
		p := seedProduct{
			category:    base.category,
			slug:        fmt.Sprintf("%s-seri-%05d", base.slug, i),
			name:        fmt.Sprintf("%s %s %s Seri %05d", base.name, brand, edition, i),
			description: fmt.Sprintf("%s Merek %s, edisi %s.", base.description, brand, strings.ToLower(edition)),
		}
		price := int64(10_000 + rng.IntN(600)*5_000) // Rp10.000 to Rp3.005.000
		for v := range 1 + rng.IntN(3) {
			p.variants = append(p.variants, seedVariant{
				sku:    fmt.Sprintf("GEN%05d-%d", i, v+1),
				name:   fmt.Sprintf("Varian %d", v+1),
				price:  price + int64(v)*10_000,
				stock:  int32(rng.IntN(40)),         // #nosec G115 -- below 40
				weight: int32(100 + rng.IntN(2000)), // #nosec G115 -- below 2100
			})
		}
		status := "active"
		switch {
		case i%50 == 0:
			status = "archived"
		case i%20 == 0:
			status = "draft"
		}
		createdAt := now.Add(-time.Duration(i) * 17 * time.Minute)

		inserted, err := insertProduct(ctx, db, categoryIDs[p.category], p, status, createdAt)
		if err != nil {
			return fmt.Errorf("generated product %s: %w", p.slug, err)
		}
		if inserted {
			added++
		}
	}
	fmt.Printf("generated products: %d added, %d already there\n", added, n-added)
	return nil
}
