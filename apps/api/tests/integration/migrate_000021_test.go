//go:build integration

package integration_test

import (
	"database/sql"
	"strings"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/migrations"
)

// migrator is the migrate library (what make migrate-up and migrate-down
// run) on the embedded migrations and dsn.
func migrator(t *testing.T, dsn string) *migrate.Migrate {
	t.Helper()
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	driver, err := pgxmigrate.WithInstance(openDB(t, dsn), &pgxmigrate.Config{})
	if err != nil {
		t.Fatalf("migrate driver: %v", err)
	}
	m, err := migrate.NewWithInstance("iofs", src, "pgx5", driver)
	if err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _, _ = m.Close() })
	return m
}

// hasColumn reports whether table has column.
func hasColumn(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	return queryInt(t, db, `SELECT count(*) FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, table, column) == 1
}

// TestMigrate_000021ProductVersion: on a database with products, 000021
// gives every existing product version 0 (the constant default, no
// rewrite), refuses a negative version, goes down without losing a
// product, and comes back up with 0 again.
func TestMigrate_000021ProductVersion(t *testing.T) {
	dsn := newDatabase(t)
	db := openDB(t, dsn)
	m := migrator(t, dsn)
	if err := m.Migrate(20); err != nil {
		t.Fatalf("migrate to 20: %v", err)
	}
	if hasColumn(t, db, "products", "version") {
		t.Fatal("products.version exists before 000021")
	}
	cat := uuidx.NewV7()
	mustExec(t, db, `INSERT INTO categories (id, level, name, slug) VALUES ($1, 1, 'Kaos', 'kaos')`, cat)
	ids := []string{uuidx.NewV7(), uuidx.NewV7()}
	for i, id := range ids {
		mustExec(t, db, `INSERT INTO products (id, category_id, name, slug, status) VALUES ($1, $2, $3, $4, 'draft')`,
			id, cat, "Produk lama", "produk-lama-"+string(rune('a'+i)))
	}

	if err := m.Steps(1); err != nil {
		t.Fatalf("up 000021: %v", err)
	}
	if v, dirty, err := m.Version(); err != nil || v != 21 || dirty {
		t.Fatalf("version = %d dirty %v, %v; want 21", v, dirty, err)
	}
	if n := queryInt(t, db, `SELECT count(*) FROM products WHERE version = 0`); n != len(ids) {
		t.Errorf("%d of %d existing products got version 0", n, len(ids))
	}
	_, err := db.ExecContext(t.Context(), `UPDATE products SET version = -1 WHERE id = $1`, ids[0])
	if err == nil || !strings.Contains(err.Error(), "products_version_check") {
		t.Errorf("a negative version = %v, want the products_version_check violation", err)
	}
	if _, err := db.ExecContext(t.Context(), `UPDATE products SET version = NULL WHERE id = $1`, ids[0]); err == nil {
		t.Error("a NULL version was accepted")
	}
	mustExec(t, db, `UPDATE products SET version = version + 1 WHERE id = $1`, ids[0])

	// Down: the column and its constraint go, the products stay.
	if err := m.Steps(-1); err != nil {
		t.Fatalf("down 000021: %v", err)
	}
	if hasColumn(t, db, "products", "version") {
		t.Error("products.version is still there after the down migration")
	}
	if n := queryInt(t, db, `SELECT count(*) FROM pg_constraint WHERE conname = 'products_version_check'`); n != 0 {
		t.Error("products_version_check is still there after the down migration")
	}
	if n := queryInt(t, db, `SELECT count(*) FROM products`); n != len(ids) {
		t.Errorf("%d products after the down migration, want %d", n, len(ids))
	}

	// And up again, as on a fresh deploy.
	if err := m.Up(); err != nil {
		t.Fatalf("up again: %v", err)
	}
	if n := queryInt(t, db, `SELECT count(*) FROM products WHERE version = 0`); n != len(ids) {
		t.Errorf("%d of %d products have version 0 after up again", n, len(ids))
	}
}
