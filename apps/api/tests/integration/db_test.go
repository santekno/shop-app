//go:build integration

package integration_test

import (
	"context"
	"crypto/rand"
	"database/sql"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
)

// Every test that touches PostgreSQL gets a database of its own, created on
// the server POSTGRES_DSN points at and dropped when the test ends:
//
//	dsn, db := newTestDB(t) // it_<random>, migrated, empty
//
// The shared goshop database, which holds the developer's seed, is never
// written to, and no test can see another test's rows, so tests may count
// rows and assume empty tables. Creating a database takes a few tens of
// milliseconds.

// newDatabase creates an empty database (no tables) and returns its URL.
// It is dropped when the test ends, with any connection still open to it.
func newDatabase(t *testing.T) string {
	t.Helper()
	// testx skips the test when POSTGRES_DSN is unset; make test-integration
	// always sets it and fails on any skip.
	serverURL := testx.PostgresContainer(t)
	admin := openDB(t, serverURL)

	// Only letters and digits, so the name is safe to put in the SQL text
	// (CREATE DATABASE takes no parameters).
	name := "it_" + strings.ToLower(rand.Text())
	mustExec(t, admin, "CREATE DATABASE "+name)
	t.Cleanup(func() {
		// Registered first, so it runs last: after the test's own pools
		// and servers are closed. FORCE ends any connection left over.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := admin.ExecContext(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
			t.Errorf("drop test database %s: %v", name, err)
		}
	})

	u, err := url.Parse(serverURL)
	if err != nil {
		t.Fatalf("POSTGRES_DSN is not a URL: %v", err)
	}
	u.Path = "/" + name
	return u.String()
}

// newTestDB creates a database with the migrations applied and returns its
// URL and a pool on it. Both go away when the test ends.
func newTestDB(t *testing.T) (string, *sql.DB) {
	t.Helper()
	dsn := newDatabase(t)
	// Migrate takes over the pool it is given and closes it.
	if _, err := database.Migrate(openDB(t, dsn)); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	return dsn, openDB(t, dsn)
}

// openDB opens a small pool with database.Open, as the API does, and closes
// it when the test ends.
func openDB(t *testing.T, dsn string) *sql.DB {
	t.Helper()
	db, err := database.Open(t.Context(), config.Database{
		URL: dsn, MaxOpenConns: 4, MaxIdleConns: 2, ConnMaxLifetime: time.Minute,
	}, logx.Noop())
	if err != nil {
		t.Fatalf("open %s: %v", redact(dsn), err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// mustExec runs one statement and fails the test on error.
func mustExec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(t.Context(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

// redact hides the password of a database URL in test output.
func redact(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return "<invalid url>"
	}
	return u.Redacted()
}
