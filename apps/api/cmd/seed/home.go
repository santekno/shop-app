package main

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/lib/pq"
	"github.com/santekno/sdk/uuidx"
)

// featuredSlugs are the example products shown in the home screen's
// "featured" row (Bab 14). They are slugs of catalog.go.
var featuredSlugs = []string{
	"kaos-polos-hitam",
	"ponsel-android-128gb",
	"kopi-arabika-gayo-250g",
	"rice-cooker-1-8-liter",
}

// seedBanner is one card of the home screen's carousel. The API has no
// banner admin (a documented gap), so make seed is how a developer gets
// some.
type seedBanner struct {
	title        string
	subtitle     string
	cta          string
	categorySlug string // the category the banner opens
	color        string
}

var banners = []seedBanner{
	{"Kaos Baru Musim Ini", "Katun combed nyaman untuk sehari-hari", "Lihat kaos", "kaos", "#1E40AF"},
	{"Ponsel dan Aksesoris", "Casing, kabel dan pengisi daya cepat", "Belanja sekarang", "aksesoris-ponsel", "#0F766E"},
	{"Kopi Nusantara", "Arabika Gayo dan Robusta Lampung", "Cicipi kopinya", "kopi-teh", "#9A3412"},
}

// seedFeatured marks the example featured products and reports how many
// changed. Running it again changes nothing.
func seedFeatured(ctx context.Context, db *sql.DB) (int, error) {
	res, err := db.ExecContext(ctx,
		`UPDATE products SET is_featured = true WHERE slug = ANY($1) AND NOT is_featured`, pq.Array(featuredSlugs))
	if err != nil {
		return 0, fmt.Errorf("feature products: %w", err)
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// seedBanners inserts the example banners in carousel order and reports
// how many were added. A banner is skipped when one with its title
// exists, so a second run adds nothing and a banner edited or switched
// off by hand stays as it is.
func seedBanners(ctx context.Context, db *sql.DB) (int, error) {
	added := 0
	for i, b := range banners {
		res, err := db.ExecContext(ctx, `
			INSERT INTO banners (id, title, subtitle, cta_label, link_category_slug, background_color, position)
			SELECT $1, $2, $3, $4, $5, $6, $7
			WHERE NOT EXISTS (SELECT 1 FROM banners WHERE title = $2)`,
			uuidx.NewV7(), b.title, b.subtitle, b.cta, b.categorySlug, b.color, i)
		if err != nil {
			return added, fmt.Errorf("insert banner %q: %w", b.title, err)
		}
		if n, _ := res.RowsAffected(); n == 1 {
			added++
		}
	}
	return added, nil
}
