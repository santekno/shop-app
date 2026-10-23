//go:build integration

package integration_test

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"slices"
	"strconv"
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

// catalogTables are the tables migration 000001 creates, and authTables
// those of 000002 to 000006 (Bab 4).
var (
	catalogTables = []string{"categories", "products", "product_variants"}
	authTables    = []string{"users", "refresh_tokens", "user_tokens", "user_identities", "addresses"}
)

// latestMigration is the version of the newest embedded migration, read
// from the files, so a new migration does not need this test changed.
var latestMigration = func() int {
	ups, err := fs.Glob(migrations.FS, "*.up.sql")
	if err != nil || len(ups) == 0 {
		panic(fmt.Sprintf("read the embedded migrations: %v", err))
	}
	slices.Sort(ups)
	v, err := strconv.Atoi(strings.SplitN(ups[len(ups)-1], "_", 2)[0])
	if err != nil {
		panic(fmt.Sprintf("version of %s: %v", ups[len(ups)-1], err))
	}
	return v
}()

// assertSchema checks that db has the whole schema at version want, or no
// tables of it at all when want is 0.
func assertSchema(t *testing.T, db *sql.DB, want int) {
	t.Helper()
	all := slices.Concat(catalogTables, authTables)
	tables := queryInt(t, db, `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`, all)
	if want == 0 {
		if tables != 0 {
			t.Errorf("%d schema tables exist, want none", tables)
		}
		return
	}
	if tables != len(all) {
		t.Errorf("%d of the %d schema tables exist (%v)", tables, len(all), all)
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
	authIndexes := queryInt(t, db, `SELECT count(*) FROM pg_indexes WHERE indexname IN
		('users_email_key', 'refresh_tokens_family_idx', 'refresh_tokens_user_active_idx',
		 'user_tokens_user_purpose_idx', 'user_identities_provider_subject_key',
		 'addresses_user_id_idx', 'addresses_one_default_idx')`)
	if authIndexes != 7 {
		t.Errorf("%d of the 7 auth indexes exist", authIndexes)
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
		if err != nil || v != uint(latestMigration) {
			t.Fatalf("Migrate = %d, %v; want version %d", v, err, latestMigration)
		}
		assertSchema(t, check, latestMigration)

		// No new migration: no error, same version, one row in
		// schema_migrations.
		v, err = database.Migrate(openDB(t, dsn))
		if err != nil || v != uint(latestMigration) {
			t.Fatalf("second Migrate = %d, %v; want version %d and no error", v, err, latestMigration)
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
			if errs[i] != nil || versions[i] != uint(latestMigration) {
				t.Errorf("Migrate %d = %d, %v; want version %d (the advisory lock serialises them)", i, versions[i], errs[i], latestMigration)
			}
		}
		assertSchema(t, openDB(t, dsn), latestMigration)
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

		if v, err := database.Migrate(openDB(t, dsn)); err != nil || v != uint(latestMigration) {
			t.Fatalf("Migrate after down = %d, %v; want version %d", v, err, latestMigration)
		}
		assertSchema(t, check, latestMigration)
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
			if line["msg"] == "database migrated" && line["version"] == float64(latestMigration) {
				logged = true
			}
		}
		if !logged {
			t.Errorf("%s run: no 'database migrated' log line with version %d:\n%s", run, latestMigration, out.String())
		}
	}
	assertSchema(t, openDB(t, dsn), latestMigration)
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
