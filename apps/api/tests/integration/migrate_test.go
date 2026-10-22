//go:build integration

package integration_test

import (
	"database/sql"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/migrations"
)

// catalogTables are the tables migration 000001 creates.
var catalogTables = []string{"categories", "products", "product_variants"}

// assertSchema checks that db has the catalog schema at version want, or no
// catalog tables at all when want is 0.
func assertSchema(t *testing.T, db *sql.DB, want int) {
	t.Helper()
	tables := queryInt(t, db, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`, catalogTables)
	if want == 0 {
		if tables != 0 {
			t.Errorf("%d catalog tables exist, want none", tables)
		}
		return
	}
	if tables != len(catalogTables) {
		t.Errorf("%d of the catalog tables exist, want %d", tables, len(catalogTables))
	}
	if v := queryInt(t, db, `SELECT version FROM schema_migrations WHERE NOT dirty`); v != want {
		t.Errorf("schema_migrations version = %d, want %d (and not dirty)", v, want)
	}
	// Spot checks that the whole file ran, not just its first statement.
	indexes := queryInt(t, db, `SELECT count(*) FROM pg_indexes WHERE indexname IN
		('products_active_newest_idx', 'products_active_category_newest_idx', 'products_active_price_idx',
		 'products_search_idx', 'product_variants_product_id_idx')`)
	if indexes != 5 {
		t.Errorf("%d of the 5 catalog indexes exist", indexes)
	}
	if n := queryInt(t, db, `SELECT attstattarget FROM pg_attribute
		WHERE attrelid = 'products'::regclass AND attname = 'search'`); n != 1000 {
		t.Errorf("statistics target of products.search = %d, want 1000", n)
	}
}

// TestMigrate applies the embedded migrations to an empty database, runs
// them again (nothing to do), and runs them from several processes at once.
func TestMigrate(t *testing.T) {
	t.Run("fresh database, then again", func(t *testing.T) {
		dsn := newDatabase(t)
		check := openDB(t, dsn)
		assertSchema(t, check, 0)

		v, err := database.Migrate(openDB(t, dsn))
		if err != nil || v != 1 {
			t.Fatalf("Migrate = %d, %v; want version 1", v, err)
		}
		assertSchema(t, check, 1)

		// No new migration: no error, same version, one row in
		// schema_migrations.
		v, err = database.Migrate(openDB(t, dsn))
		if err != nil || v != 1 {
			t.Fatalf("second Migrate = %d, %v; want version 1 and no error", v, err)
		}
		if n := queryInt(t, check, `SELECT count(*) FROM schema_migrations`); n != 1 {
			t.Errorf("schema_migrations has %d rows, want 1", n)
		}
	})

	t.Run("concurrent runs take turns", func(t *testing.T) {
		dsn := newDatabase(t)
		const n = 4
		pools := make([]*sql.DB, n)
		for i := range pools {
			pools[i] = openDB(t, dsn)
		}
		versions, errs := make([]uint, n), make([]error, n)
		var wg sync.WaitGroup
		for i := range n {
			wg.Go(func() { versions[i], errs[i] = database.Migrate(pools[i]) })
		}
		wg.Wait()
		for i := range n {
			if errs[i] != nil || versions[i] != 1 {
				t.Errorf("Migrate %d = %d, %v; want version 1 (the advisory lock serialises them)", i, versions[i], errs[i])
			}
		}
		assertSchema(t, openDB(t, dsn), 1)
	})

	t.Run("down migration reverses up", func(t *testing.T) {
		dsn := newDatabase(t)
		check := openDB(t, dsn)
		if _, err := database.Migrate(openDB(t, dsn)); err != nil {
			t.Fatalf("Migrate: %v", err)
		}

		// make migrate-down runs the same files with the migrate CLI; this
		// is the library behind it, on the embedded copy.
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
		if err := m.Down(); err != nil {
			t.Fatalf("down: %v", err)
		}
		if _, _, err := m.Version(); !errors.Is(err, migrate.ErrNilVersion) {
			t.Errorf("version after down: %v, want ErrNilVersion", err)
		}
		_, _ = m.Close()
		assertSchema(t, check, 0)

		if v, err := database.Migrate(openDB(t, dsn)); err != nil || v != 1 {
			t.Fatalf("Migrate after down = %d, %v; want version 1", v, err)
		}
		assertSchema(t, check, 1)
	})
}

// TestRun_Migrate runs `api migrate` through app.Run: it applies the
// migrations to DATABASE_URL, logs the version and exits, twice in a row.
func TestRun_Migrate(t *testing.T) {
	dsn := newDatabase(t)
	setEnv(t, map[string]string{"APP_ENV": config.EnvProduction, "DATABASE_URL": dsn})

	for _, run := range []string{"first", "second"} {
		var out syncBuffer
		if err := app.Run(t.Context(), []string{"migrate"}, &out); err != nil {
			t.Fatalf("%s `api migrate`: %v\n%s", run, err, out.String())
		}
		var logged bool
		for _, line := range out.jsonLines() {
			if line["msg"] == "database migrated" && line["version"] == float64(1) {
				logged = true
			}
		}
		if !logged {
			t.Errorf("%s run: no 'database migrated' log line with version 1:\n%s", run, out.String())
		}
	}
	assertSchema(t, openDB(t, dsn), 1)
}

// TestRun_MigrateUnreachable checks that `api migrate` fails, without the
// password in the error, when the database cannot be reached.
func TestRun_MigrateUnreachable(t *testing.T) {
	const password = "not-a-real-password-0451"
	setEnv(t, map[string]string{
		"APP_ENV":      config.EnvProduction,
		"DATABASE_URL": "postgres://goshop:" + password + "@" + closedAddr(t) + "/goshop?sslmode=disable",
	})
	err := app.Run(t.Context(), []string{"migrate"}, &syncBuffer{})
	if err == nil {
		t.Fatal("`api migrate` against a closed port succeeded")
	}
	if strings.Contains(err.Error(), password) {
		t.Errorf("the error shows the database password: %v", err)
	}
}

// closedAddr returns a 127.0.0.1 address nothing listens on: it was free a
// moment ago and was closed again.
func closedAddr(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return addr
}
