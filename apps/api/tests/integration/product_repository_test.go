//go:build integration

package integration_test

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// queryInt runs a query that returns one integer, such as a count.
func queryInt(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(t.Context(), query, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func getAdmin(t *testing.T, c *catalog, id string) product.AdminProduct {
	t.Helper()
	p, err := c.repo.GetAdmin(t.Context(), id)
	if err != nil {
		t.Fatalf("GetAdmin(%s): %v", id, err)
	}
	return p
}

func skus[V product.AdminVariant | product.Variant](variants []V) []string {
	out := make([]string, 0, len(variants))
	for _, v := range variants {
		switch v := any(v).(type) {
		case product.AdminVariant:
			out = append(out, v.SKU)
		case product.Variant:
			out = append(out, v.SKU)
		}
	}
	return out
}

// asInput turns what the admin sees back into an Input that keeps every
// variant, as an admin form would send it.
func asInput(p product.AdminProduct) product.Input {
	in := product.Input{
		CategoryID: p.CategoryID, Slug: p.Slug, Name: p.Name, Description: p.Description, Status: p.Status,
		Version: p.Version,
	}
	for _, v := range p.Variants {
		in.Variants = append(in.Variants, product.VariantInput{
			ID: v.ID, SKU: v.SKU, Name: v.Name, Price: v.Price, Stock: v.Stock, WeightGrams: v.WeightGrams,
			Version: v.Version,
		})
	}
	return in
}

// TestProductRepository_CreateAndRead stores a product with its variants in
// one transaction and reads it back through the admin and storefront reads.
func TestProductRepository_CreateAndRead(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	ctx := t.Context()

	id := c.create(t, "kaos", "kaos-polos-hitam", "Kaos Polos Hitam", "Kaos katun.",
		variant("KPH-XL", "XL", 99000, 0), variant("KPH-M", "M", 89000, 12))

	p := getAdmin(t, c, id)
	if p.Status != product.StatusActive || p.CategoryID != c.cats["kaos"] || p.Slug != "kaos-polos-hitam" {
		t.Errorf("GetAdmin = %+v", p)
	}
	if p.PriceFrom == nil || *p.PriceFrom != 89000 {
		t.Errorf("PriceFrom = %v, want 89000 (the cheapest variant)", p.PriceFrom)
	}
	if got := skus(p.Variants); !slices.Equal(got, []string{"KPH-M", "KPH-XL"}) {
		t.Errorf("variants = %v, want cheapest first", got)
	}
	if p.UpdatedAt.Before(p.CreatedAt) {
		t.Errorf("UpdatedAt %v before CreatedAt %v", p.UpdatedAt, p.CreatedAt)
	}
	// position is the index in the request, not the price order.
	if n := queryInt(t, db, `SELECT position FROM product_variants WHERE sku = 'KPH-XL'`); n != 0 {
		t.Errorf("position of the first variant in the request = %d, want 0", n)
	}

	sp, err := c.repo.GetBySlug(ctx, "kaos-polos-hitam")
	if err != nil {
		t.Fatalf("GetBySlug: %v", err)
	}
	if sp.ID != id || sp.PriceFrom != 89000 || !sp.InStock() || sp.Category.Slug != "kaos" || sp.Category.ParentID == nil {
		t.Errorf("GetBySlug = %+v", sp)
	}
}

// TestProductRepository_VariantOrder checks the order price, position, id:
// variants with the same price keep the admin's order, whatever their ids.
func TestProductRepository_VariantOrder(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)

	id := c.create(t, "kaos", "kaos-ukuran", "Kaos Ukuran", "",
		variant("KU-S", "S", 89000, 1), variant("KU-M", "M", 89000, 1), variant("KU-L", "L", 89000, 1))

	assertOrder := func(t *testing.T, want ...string) {
		t.Helper()
		if got := skus(getAdmin(t, c, id).Variants); !slices.Equal(got, want) {
			t.Errorf("admin variants = %v, want %v", got, want)
		}
		sp, err := c.repo.GetBySlug(t.Context(), "kaos-ukuran")
		if err != nil {
			t.Fatalf("GetBySlug: %v", err)
		}
		if got := skus(sp.Variants); !slices.Equal(got, want) {
			t.Errorf("storefront variants = %v, want %v", got, want)
		}
		page, err := c.svc.List(t.Context(), product.ListParams{Sort: product.SortNewest, Limit: 10})
		if err != nil || len(page.Products) != 1 {
			t.Fatalf("List: %v, %d products", err, len(page.Products))
		}
		if got := skus(page.Products[0].Variants); !slices.Equal(got, want) {
			t.Errorf("list variants = %v, want %v", got, want)
		}
	}
	assertOrder(t, "KU-S", "KU-M", "KU-L")

	// Reorder to L, M, S and add a cheaper XS at the end: XS comes first by
	// price, the rest keep the new order.
	in := asInput(getAdmin(t, c, id))
	in.Variants = []product.VariantInput{in.Variants[2], in.Variants[1], in.Variants[0], variant("KU-XS", "XS", 79000, 1)}
	if err := c.repo.Update(t.Context(), id, in); err != nil {
		t.Fatalf("Update: %v", err)
	}
	assertOrder(t, "KU-XS", "KU-L", "KU-M", "KU-S")
	if n := queryInt(t, db, `SELECT position FROM product_variants WHERE sku = 'KU-S'`); n != 2 {
		t.Errorf("position of KU-S = %d, want 2 (its index in the request)", n)
	}
}

// TestProductRepository_StockPriceAndArchivedVariants checks in_stock and
// price_from as variants change: both come from sellable variants only, and
// an archived variant leaves the storefront but keeps its row and its SKU.
func TestProductRepository_StockPriceAndArchivedVariants(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	ctx := t.Context()

	id := c.create(t, "kaos", "kaos-stok", "Kaos Stok", "", variant("KS-A", "A", 50000, 0), variant("KS-B", "B", 30000, 0))
	sp, err := c.repo.GetBySlug(ctx, "kaos-stok")
	if err != nil {
		t.Fatalf("GetBySlug: %v", err)
	}
	if sp.InStock() || sp.PriceFrom != 30000 {
		t.Errorf("InStock = %v, PriceFrom = %d; want false and 30000", sp.InStock(), sp.PriceFrom)
	}

	// Keep A, leave B out (archived), add C with stock.
	in := asInput(getAdmin(t, c, id))
	a := in.Variants[1] // cheapest first: B, A
	if a.SKU != "KS-A" {
		t.Fatalf("fixture: variants %v", in.Variants)
	}
	in.Variants = []product.VariantInput{a, variant("KS-C", "C", 70000, 5)}
	if err := c.repo.Update(ctx, id, in); err != nil {
		t.Fatalf("Update: %v", err)
	}

	sp, err = c.repo.GetBySlug(ctx, "kaos-stok")
	if err != nil {
		t.Fatalf("GetBySlug: %v", err)
	}
	if got := skus(sp.Variants); !slices.Equal(got, []string{"KS-A", "KS-C"}) {
		t.Errorf("storefront variants = %v, want KS-A and KS-C (KS-B archived)", got)
	}
	if !sp.InStock() || sp.PriceFrom != 50000 {
		t.Errorf("InStock = %v, PriceFrom = %d; want true and 50000", sp.InStock(), sp.PriceFrom)
	}
	if n := queryInt(t, db, `SELECT count(*) FROM product_variants WHERE sku = 'KS-B' AND archived_at IS NOT NULL AND stock = 0`); n != 1 {
		t.Error("KS-B was not archived in place (its row, stock and SKU stay)")
	}
	page, err := c.svc.List(ctx, product.ListParams{Sort: product.SortPriceAsc, Limit: 10})
	if err != nil || len(page.Products) != 1 || page.Products[0].PriceFrom != 50000 {
		t.Errorf("List after the update: %v, %+v; want price_from 50000", err, page.Products)
	}

	// The archived SKU is still taken, for every product.
	_, err = c.repo.Create(ctx, product.Input{
		CategoryID: c.cats["kaos"], Slug: "kaos-lain", Name: "Kaos Lain", Status: product.StatusActive,
		Variants: []product.VariantInput{variant("KS-B", "B", 30000, 1)},
	})
	if !errors.Is(err, product.ErrSKUTaken) {
		t.Errorf("Create with an archived variant's SKU: error = %v, want ErrSKUTaken", err)
	}
}

// TestProductRepository_ArchiveVariantsNotIn covers the archiving step of
// Update with some IDs kept and with none, and the reason the repository
// passes an empty array rather than NULL.
func TestProductRepository_ArchiveVariantsNotIn(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	sellable := func(id string) int {
		return queryInt(t, db, `SELECT count(*) FROM product_variants WHERE product_id = $1 AND archived_at IS NULL`, id)
	}

	t.Run("some kept", func(t *testing.T) {
		id := c.create(t, "kaos", "kaos-sebagian", "Kaos", "",
			variant("SB-1", "1", 10000, 1), variant("SB-2", "2", 20000, 1), variant("SB-3", "3", 30000, 1))
		in := asInput(getAdmin(t, c, id))
		in.Variants = []product.VariantInput{in.Variants[0], in.Variants[2]} // drop SB-2
		if err := c.repo.Update(t.Context(), id, in); err != nil {
			t.Fatalf("Update: %v", err)
		}
		if got := skus(getAdmin(t, c, id).Variants); !slices.Equal(got, []string{"SB-1", "SB-3"}) {
			t.Errorf("variants = %v, want SB-1 and SB-3", got)
		}
	})

	t.Run("none kept: only new variants in the request", func(t *testing.T) {
		id := c.create(t, "kaos", "kaos-baru-semua", "Kaos", "", variant("BS-1", "1", 10000, 1), variant("BS-2", "2", 20000, 1))
		in := asInput(getAdmin(t, c, id))
		in.Variants = []product.VariantInput{variant("BS-3", "3", 55000, 2)}
		if err := c.repo.Update(t.Context(), id, in); err != nil {
			t.Fatalf("Update: %v", err)
		}
		p := getAdmin(t, c, id)
		if got := skus(p.Variants); !slices.Equal(got, []string{"BS-3"}) {
			t.Errorf("variants = %v, want only BS-3", got)
		}
		if p.PriceFrom == nil || *p.PriceFrom != 55000 {
			t.Errorf("PriceFrom = %v, want 55000", p.PriceFrom)
		}
	})

	t.Run("the query: empty array archives all, NULL archives nothing", func(t *testing.T) {
		id := c.create(t, "kaos", "kaos-kueri", "Kaos", "", variant("KQ-1", "1", 10000, 1), variant("KQ-2", "2", 20000, 1))
		q := sqlc.New(db)
		if err := q.ArchiveVariantsNotIn(t.Context(), sqlc.ArchiveVariantsNotInParams{ProductID: id, KeepIds: nil}); err != nil {
			t.Fatalf("ArchiveVariantsNotIn(nil): %v", err)
		}
		if n := sellable(id); n != 2 {
			t.Errorf("after keep=NULL: %d sellable variants, want 2 (id <> ALL(NULL) matches nothing)", n)
		}
		if err := q.ArchiveVariantsNotIn(t.Context(), sqlc.ArchiveVariantsNotInParams{ProductID: id, KeepIds: []string{}}); err != nil {
			t.Fatalf("ArchiveVariantsNotIn([]): %v", err)
		}
		if n := sellable(id); n != 0 {
			t.Errorf("after keep=[]: %d sellable variants, want 0", n)
		}
		// The query alone, without UpdateProduct after it in the same
		// transaction (which Update always runs), leaves an active product
		// with nothing to sell; the storefront's inner join hides it.
		if _, err := c.repo.GetBySlug(t.Context(), "kaos-kueri"); !errors.Is(err, product.ErrNotFound) {
			t.Errorf("GetBySlug of a product without sellable variants: error = %v, want ErrNotFound", err)
		}
	})
}

// TestProductRepository_ActiveNeedsASellableVariant checks the invariant
// behind the storefront's inner join: an active product always has a
// sellable variant. A save that would archive the last one fails on
// products_active_price_check and changes nothing; as a draft the same save
// is allowed, and price_from becomes NULL.
func TestProductRepository_ActiveNeedsASellableVariant(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	id := c.create(t, "kaos", "kaos-terakhir", "Kaos Terakhir", "", variant("KT-1", "M", 50000, 1))
	before := getAdmin(t, c, id)

	in := asInput(before)
	in.Variants = nil // archive every variant
	err := c.repo.Update(t.Context(), id, in)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.ConstraintName != "products_active_price_check" {
		t.Fatalf("Update of an active product to no variants: error = %v, want products_active_price_check", err)
	}
	after := getAdmin(t, c, id)
	if after.Status != product.StatusActive || len(after.Variants) != 1 || after.PriceFrom == nil || *after.PriceFrom != 50000 {
		t.Errorf("the failed save changed the product: %+v", after)
	}
	if _, err := c.repo.GetBySlug(t.Context(), "kaos-terakhir"); err != nil {
		t.Errorf("GetBySlug after the failed save: %v", err)
	}

	in.Status = product.StatusDraft
	if err := c.repo.Update(t.Context(), id, in); err != nil {
		t.Fatalf("Update to a draft with no variants: %v", err)
	}
	draft := getAdmin(t, c, id)
	if draft.Status != product.StatusDraft || len(draft.Variants) != 0 || draft.PriceFrom != nil {
		t.Errorf("draft without variants = %+v, want no variants and price_from NULL", draft)
	}
}

// TestProductRepository_GetBySlugNotFound lists what the storefront detail
// treats as not found.
func TestProductRepository_GetBySlugNotFound(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	c.addListingProducts(t)
	for _, slug := range []string{"kaos-draft", "kaos-arsip", "tidak-ada"} {
		if _, err := c.repo.GetBySlug(t.Context(), slug); !errors.Is(err, product.ErrNotFound) {
			t.Errorf("GetBySlug(%s): error = %v, want ErrNotFound", slug, err)
		}
	}
	if _, err := c.repo.GetBySlug(t.Context(), "kaos-polos-hitam"); err != nil {
		t.Errorf("GetBySlug of an active product: %v", err)
	}
}

// TestProductRepository_ConstraintErrors maps each constraint a client can
// break to the package's error, and checks that the failed write left
// nothing behind: Create and Update run in one transaction each.
func TestProductRepository_ConstraintErrors(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	existing := c.create(t, "kaos", "kaos-ada", "Kaos Ada", "", variant("ADA-1", "M", 50000, 1))
	other := c.create(t, "kaos", "kaos-lain", "Kaos Lain", "", variant("LAIN-1", "M", 60000, 1), variant("LAIN-2", "L", 70000, 1))
	unknownCategory := uuidx.NewV7()

	count := func() (products, variants int) {
		return queryInt(t, db, `SELECT count(*) FROM products`), queryInt(t, db, `SELECT count(*) FROM product_variants`)
	}

	creates := []struct {
		name string
		in   product.Input
		want error
	}{
		{"slug taken", product.Input{CategoryID: c.cats["kaos"], Slug: "kaos-ada", Name: "X", Status: product.StatusActive,
			Variants: []product.VariantInput{variant("NEW-1", "M", 1000, 1)}}, product.ErrSlugTaken},
		{"sku taken by the second variant", product.Input{CategoryID: c.cats["kaos"], Slug: "kaos-baru", Name: "X", Status: product.StatusActive,
			Variants: []product.VariantInput{variant("NEW-2", "M", 1000, 1), variant("ADA-1", "L", 1000, 1)}}, product.ErrSKUTaken},
		{"unknown category", product.Input{CategoryID: unknownCategory, Slug: "kaos-tanpa-kategori", Name: "X", Status: product.StatusActive,
			Variants: []product.VariantInput{variant("NEW-3", "M", 1000, 1)}}, product.ErrUnknownCategory},
	}
	for _, tt := range creates {
		t.Run("create/"+tt.name, func(t *testing.T) {
			p0, v0 := count()
			_, err := c.repo.Create(t.Context(), tt.in)
			if !errors.Is(err, tt.want) {
				t.Fatalf("Create error = %v, want %v", err, tt.want)
			}
			if p1, v1 := count(); p1 != p0 || v1 != v0 {
				t.Errorf("a failed Create left rows: products %d→%d, variants %d→%d", p0, p1, v0, v1)
			}
		})
	}

	before := getAdmin(t, c, other)
	archived := func() int {
		return queryInt(t, db, `SELECT count(*) FROM product_variants WHERE archived_at IS NOT NULL`)
	}
	updates := []struct {
		name   string
		change func(in *product.Input)
		want   error
	}{
		{"slug taken", func(in *product.Input) { in.Slug = "kaos-ada" }, product.ErrSlugTaken},
		{"sku taken by a new variant", func(in *product.Input) {
			in.Variants = append(in.Variants, variant("ADA-1", "XL", 1000, 1))
		}, product.ErrSKUTaken},
		{"unknown category", func(in *product.Input) { in.CategoryID = unknownCategory }, product.ErrUnknownCategory},
		// The first variant is dropped, so it is archived first; the bad id
		// of the second fails later, and the archiving is rolled back too.
		{"variant of another product", func(in *product.Input) {
			adaVariant := getAdmin(t, c, existing).Variants[0]
			in.Variants = []product.VariantInput{in.Variants[1], {ID: adaVariant.ID, SKU: "ADA-1", Name: "M", Price: 1, Stock: 1, WeightGrams: 1}}
		}, product.ErrUnknownVariant},
		{"variant id that does not exist", func(in *product.Input) { in.Variants[0].ID = uuidx.NewV7() }, product.ErrUnknownVariant},
	}
	for _, tt := range updates {
		t.Run("update/"+tt.name, func(t *testing.T) {
			in := asInput(before)
			in.Name = "Changed"
			tt.change(&in)
			a0 := archived()
			err := c.repo.Update(t.Context(), other, in)
			if !errors.Is(err, tt.want) {
				t.Fatalf("Update error = %v, want %v", err, tt.want)
			}
			after := getAdmin(t, c, other)
			if after.Name != before.Name || after.Slug != before.Slug || !after.UpdatedAt.Equal(before.UpdatedAt) ||
				!slices.Equal(skus(after.Variants), skus(before.Variants)) || archived() != a0 {
				t.Errorf("a failed Update changed the product:\nbefore %+v\nafter  %+v", before, after)
			}
		})
	}

	t.Run("update of an unknown product", func(t *testing.T) {
		if err := c.repo.Update(t.Context(), uuidx.NewV7(), asInput(before)); !errors.Is(err, product.ErrNotFound) {
			t.Errorf("Update error = %v, want ErrNotFound", err)
		}
	})
}

// TestProductRepository_UpdateAndArchive checks what a successful Update
// and Archive change: updated_at advances, created_at does not, every
// variant update bumps version, and archiving is idempotent and keeps the
// variants as they are.
func TestProductRepository_UpdateAndArchive(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	ctx := t.Context()
	id := c.create(t, "kaos", "kaos-ubah", "Kaos Ubah", "", variant("UB-1", "M", 50000, 1))
	before := getAdmin(t, c, id)

	time.Sleep(5 * time.Millisecond) // now() must move on between the two transactions
	in := asInput(before)
	in.Name, in.Description, in.Variants[0].Stock = "Kaos Diubah", "Baru", 7
	if err := c.repo.Update(ctx, id, in); err != nil {
		t.Fatalf("Update: %v", err)
	}
	after := getAdmin(t, c, id)
	if after.Name != "Kaos Diubah" || after.Description != "Baru" || after.Variants[0].Stock != 7 {
		t.Errorf("Update did not save the fields: %+v", after)
	}
	if !after.UpdatedAt.After(before.UpdatedAt) || !after.CreatedAt.Equal(before.CreatedAt) {
		t.Errorf("updated_at %v → %v, created_at %v → %v; want updated_at later, created_at unchanged",
			before.UpdatedAt, after.UpdatedAt, before.CreatedAt, after.CreatedAt)
	}
	if v := queryInt(t, db, `SELECT version FROM product_variants WHERE sku = 'UB-1'`); v != 1 {
		t.Errorf("variant version = %d after one update, want 1", v)
	}

	time.Sleep(5 * time.Millisecond)
	if err := c.repo.Archive(ctx, id); err != nil {
		t.Fatalf("Archive: %v", err)
	}
	archived := getAdmin(t, c, id)
	if archived.Status != product.StatusArchived || !archived.UpdatedAt.After(after.UpdatedAt) {
		t.Errorf("after Archive: status %q, updated_at %v; want archived and later than %v", archived.Status, archived.UpdatedAt, after.UpdatedAt)
	}
	if got := skus(archived.Variants); !slices.Equal(got, []string{"UB-1"}) {
		t.Errorf("Archive changed the variants: %v", got)
	}
	if _, err := c.repo.GetBySlug(ctx, "kaos-ubah"); !errors.Is(err, product.ErrNotFound) {
		t.Errorf("GetBySlug of an archived product: error = %v, want ErrNotFound", err)
	}
	if err := c.repo.Archive(ctx, id); err != nil {
		t.Errorf("archiving again: %v, want nil (idempotent)", err)
	}
	if err := c.repo.Archive(ctx, uuidx.NewV7()); !errors.Is(err, product.ErrNotFound) {
		t.Errorf("Archive of an unknown product: error = %v, want ErrNotFound", err)
	}
}

// TestProductRepository_ConcurrentSaves runs many saves of one product at
// once, all from the same loaded version. LockProduct makes them take
// turns, and since Bab 12 the product's version lets exactly one through:
// the others are ErrVersionConflict and write nothing, so the stored
// variants are the winner's whole, and price_from matches them.
func TestProductRepository_ConcurrentSaves(t *testing.T) {
	_, db := newTestDB(t)
	c := newCatalog(t, db)
	ctx := t.Context()
	id := c.create(t, "kaos", "kaos-rebutan", "Kaos Rebutan", "", variant("RB-0", "M", 50000, 1))
	base := asInput(getAdmin(t, c, id))

	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Go(func() {
			in := base
			in.Name = fmt.Sprintf("Save %d", i)
			in.Variants = []product.VariantInput{
				variant(fmt.Sprintf("RB-%d-A", i), "A", int64(10000+i), 1),
				variant(fmt.Sprintf("RB-%d-B", i), "B", int64(20000+i), 1),
			}
			errs[i] = c.repo.Update(ctx, id, in)
		})
	}
	wg.Wait()
	won := -1
	for i, err := range errs {
		switch {
		case err == nil && won < 0:
			won = i
		case err == nil:
			t.Errorf("saves %d and %d both won", won, i)
		case !errors.Is(err, product.ErrVersionConflict):
			t.Errorf("save %d: %v, want ErrVersionConflict", i, err)
		}
	}

	p := getAdmin(t, c, id)
	var winner int
	if _, err := fmt.Sscanf(p.Name, "Save %d", &winner); err != nil || winner != won {
		t.Fatalf("name %q is not the winning save %d", p.Name, won)
	}
	want := []string{fmt.Sprintf("RB-%d-A", winner), fmt.Sprintf("RB-%d-B", winner)}
	if got := skus(p.Variants); !slices.Equal(got, want) {
		t.Errorf("variants %v are not those of the winning save %d (%v)", got, winner, want)
	}
	if p.PriceFrom == nil || *p.PriceFrom != int64(10000+winner) {
		t.Errorf("price_from %v does not match the winning save's variants", p.PriceFrom)
	}
}
