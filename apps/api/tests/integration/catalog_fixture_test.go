//go:build integration

package integration_test

import (
	"cmp"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// catalog is a test database with the example categories, plus the
// repository and the service on it.
type catalog struct {
	db   *sql.DB
	repo *product.PostgresRepository
	svc  *product.Service
	// cats holds every category ID by slug: the 13 example ones and
	// barang-langka, a top-level category without children.
	cats map[string]string
}

// newCatalog seeds the categories into db and wires the product service on
// it the way app.New does.
func newCatalog(t *testing.T, db *sql.DB) *catalog {
	t.Helper()
	cats := seedCategories(t, db)
	cats["barang-langka"] = uuidx.NewV7()
	insertCategories(t, db, []category.Category{{ID: cats["barang-langka"], Slug: "barang-langka", Name: "Barang Langka"}})
	repo := product.NewPostgresRepository(db)
	return &catalog{
		db:   db,
		repo: repo,
		svc:  product.NewService(repo, category.NewService(category.NewPostgresRepository(db))),
		cats: cats,
	}
}

// variant is a VariantInput with a weight, for short fixtures.
func variant(sku, name string, price int64, stock int32) product.VariantInput {
	return product.VariantInput{SKU: sku, Name: name, Price: price, Stock: stock, WeightGrams: 200}
}

// create stores an active product in the category with slug catSlug
// through the repository and returns its ID.
func (c *catalog) create(t *testing.T, catSlug, slug, name, description string, variants ...product.VariantInput) string {
	t.Helper()
	return c.createWithStatus(t, product.StatusActive, catSlug, slug, name, description, variants...)
}

func (c *catalog) createWithStatus(t *testing.T, status, catSlug, slug, name, description string,
	variants ...product.VariantInput,
) string {
	t.Helper()
	catID, ok := c.cats[catSlug]
	if !ok {
		t.Fatalf("fixture: no category %q", catSlug)
	}
	id, err := c.repo.Create(t.Context(), product.Input{
		CategoryID: catID, Slug: slug, Name: name, Description: description, Status: status, Variants: variants,
	})
	if err != nil {
		t.Fatalf("create product %s: %v", slug, err)
	}
	return id
}

// The listing fixture: active products across the category tree, with
// equal created_at values and equal prices so the id tie-breaker matters,
// plus products the storefront must never list.
const (
	listedActive = 11 // active products with a sellable variant
)

// addListingProducts stores the listing fixture and gives every product a
// fixed created_at, so the newest order does not depend on timing.
func (c *catalog) addListingProducts(t *testing.T) {
	t.Helper()
	type fixture struct {
		cat, slug, name, desc string
		variants              []product.VariantInput
		createdAt             time.Duration // after base
	}
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	same := 50 * time.Hour // three products share this created_at
	products := []fixture{
		{"kaos", "kaos-polos-hitam", "Kaos Polos Hitam", "Kaos katun combed, nyaman dipakai sehari-hari.",
			[]product.VariantInput{variant("KPH-M", "M", 89000, 12), variant("KPH-XL", "XL", 99000, 0)}, 10 * time.Hour},
		{"kaos", "kaos-polos-putih", "Kaos Polos Putih", "Kaos katun, warna putih bersih.",
			[]product.VariantInput{variant("KPP-S", "S", 89000, 0)}, 20 * time.Hour},
		{"kemeja", "kemeja-flanel", "Kemeja Flanel", "Bahan katun tebal bermotif kotak.",
			[]product.VariantInput{variant("KF-L", "L", 150000, 3)}, 30 * time.Hour},
		{"celana", "celana-chino", "Celana Chino", "Celana panjang untuk kerja.",
			[]product.VariantInput{variant("CC-32", "32", 175000, 4)}, 40 * time.Hour},
		{"ponsel", "ponsel-murah", "Ponsel Murah", "Layar enam inci, baterai awet.",
			[]product.VariantInput{variant("PM-64", "64 GB", 1500000, 5), variant("PM-128", "128 GB", 1900000, 1)}, 45 * time.Hour},
		{"aksesoris-ponsel", "casing-ponsel", "Casing Ponsel", "Pelindung bening.",
			[]product.VariantInput{variant("CP-1", "Bening", 25000, 40)}, 46 * time.Hour},
		{"kopi-teh", "kopi-arabika", "Kopi Arabika", "Biji sangrai medium.",
			[]product.VariantInput{variant("KA-250", "250 g", 65000, 8)}, same},
		{"kopi-teh", "teh-hijau", "Teh Hijau", "Daun teh pilihan.",
			[]product.VariantInput{variant("TH-100", "100 g", 65000, 9)}, same},
		{"camilan", "keripik-singkong", "Keripik Singkong", "Renyah dan gurih.",
			[]product.VariantInput{variant("KS-1", "Original", 15000, 30)}, same},
		{"peralatan-dapur", "wajan-anti-lengket", "Wajan Anti Lengket", "Diameter 28 cm.",
			[]product.VariantInput{variant("WAL-28", "28 cm", 120000, 2)}, 60 * time.Hour},
		{"barang-langka", "barang-langka-satu", "Barang Langka Satu", "Hanya satu di toko.",
			[]product.VariantInput{variant("BLS-1", "Satu", 89000, 1)}, 70 * time.Hour},
		// Never listed: a draft and an archived product. (An active product
		// without a sellable variant cannot exist: products_active_price_check
		// and UpdateProduct's price_from recompute forbid it, see
		// TestProductRepository_ActiveNeedsASellableVariant.)
		{"kaos", "kaos-draft", "Kaos Draft", "Kaos katun yang belum dijual.",
			[]product.VariantInput{variant("KD-1", "M", 10000, 5)}, 80 * time.Hour},
		{"kaos", "kaos-arsip", "Kaos Arsip", "Kaos katun yang sudah tidak dijual.",
			[]product.VariantInput{variant("KAR-1", "M", 10000, 5)}, 90 * time.Hour},
	}
	for _, p := range products {
		status := product.StatusActive
		if p.slug == "kaos-draft" {
			status = product.StatusDraft
		}
		id := c.createWithStatus(t, status, p.cat, p.slug, p.name, p.desc, p.variants...)
		mustExec(t, c.db, "UPDATE products SET created_at = $1 WHERE id = $2", base.Add(p.createdAt), id)
		if p.slug == "kaos-arsip" {
			if err := c.repo.Archive(t.Context(), id); err != nil {
				t.Fatalf("archive %s: %v", p.slug, err)
			}
		}
	}
}

// listedProduct is one active product as the database holds it: the
// oracle the tests compare the API's order with.
type listedProduct struct {
	ID, Slug, CategoryID string
	CreatedAt            time.Time
	PriceFrom            int64
	Sellable             bool // has at least one non-archived variant
}

// activeProducts reads every active product with plain SQL.
func (c *catalog) activeProducts(t *testing.T) []listedProduct {
	t.Helper()
	rows, err := c.db.QueryContext(t.Context(), `
		SELECT p.id, p.slug, p.category_id, p.created_at, p.price_from,
		       EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.archived_at IS NULL)
		FROM products p WHERE p.status = 'active'`)
	if err != nil {
		t.Fatalf("read products: %v", err)
	}
	defer func() { _ = rows.Close() }()
	var out []listedProduct
	for rows.Next() {
		var p listedProduct
		if err := rows.Scan(&p.ID, &p.Slug, &p.CategoryID, &p.CreatedAt, &p.PriceFrom, &p.Sellable); err != nil {
			t.Fatalf("scan product: %v", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read products: %v", err)
	}
	return out
}

// expectedOrder sorts products the way the contract describes sort, ties
// broken by id, and returns the slugs of the sellable ones that keep says
// to keep (nil keeps all).
func expectedOrder(products []listedProduct, sort product.Sort, keep func(listedProduct) bool) []string {
	products = slices.Clone(products)
	slices.SortFunc(products, func(a, b listedProduct) int {
		switch sort {
		case product.SortPriceAsc:
			return cmp.Or(cmp.Compare(a.PriceFrom, b.PriceFrom), cmp.Compare(a.ID, b.ID))
		case product.SortPriceDesc:
			return cmp.Or(cmp.Compare(b.PriceFrom, a.PriceFrom), cmp.Compare(b.ID, a.ID))
		default:
			return cmp.Or(b.CreatedAt.Compare(a.CreatedAt), cmp.Compare(b.ID, a.ID))
		}
	})
	var slugs []string
	for _, p := range products {
		if p.Sellable && (keep == nil || keep(p)) {
			slugs = append(slugs, p.Slug)
		}
	}
	return slugs
}

// inCategories keeps products of the given category slugs.
func (c *catalog) inCategories(slugs ...string) func(listedProduct) bool {
	ids := map[string]bool{}
	for _, s := range slugs {
		ids[c.cats[s]] = true
	}
	return func(p listedProduct) bool { return ids[p.CategoryID] }
}

// withSlugs keeps the products with the given slugs.
func withSlugs(slugs ...string) func(listedProduct) bool {
	return func(p listedProduct) bool { return slices.Contains(slugs, p.Slug) }
}

var allSorts = []product.Sort{product.SortNewest, product.SortPriceAsc, product.SortPriceDesc}
