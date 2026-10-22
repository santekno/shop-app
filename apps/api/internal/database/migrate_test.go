package database

import (
	"context"
	"fmt"
	"io/fs"
	"regexp"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/migrations"
)

// Migrate takes over the pool: when it cannot prepare, it still closes it.
// Applying the migrations needs PostgreSQL and is tested in
// tests/integration.
func TestMigrate_ClosesThePoolOnError(t *testing.T) {
	fake := &fakeDB{}
	db := fake.open(t)

	version, err := Migrate(db)

	testx.AssertEqual(t, version, uint(0))
	if err == nil {
		t.Fatal("Migrate: want error, got nil")
	}
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "prepare migrations: "), "err = %v", err)
	pingErr := db.PingContext(context.Background())
	if pingErr == nil {
		t.Fatal("pool is still open after Migrate returned")
	}
	testx.AssertContains(t, pingErr.Error(), "database is closed")
}

// The embedded migrations are what `api migrate` applies: each version has
// an up and a down file, versions are numbered 1, 2, 3, ... without gaps,
// and nothing else is embedded.
func TestMigrations_Embedded(t *testing.T) {
	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	name := regexp.MustCompile(`^(\d{6})_[a-z0-9_]+\.(up|down)\.sql$`)
	files := map[string]map[string]bool{}
	for _, e := range entries {
		m := name.FindStringSubmatch(e.Name())
		if m == nil {
			t.Errorf("embedded file %q is not NNNNNN_name.(up|down).sql", e.Name())
			continue
		}
		if files[m[1]] == nil {
			files[m[1]] = map[string]bool{}
		}
		files[m[1]][m[2]] = true

		body, err := fs.ReadFile(migrations.FS, e.Name())
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, len(strings.TrimSpace(string(body))) > 0, "%s is empty", e.Name())
	}
	testx.AssertTrue(t, len(files) >= 1, "at least one migration is embedded")
	for i := 1; i <= len(files); i++ {
		v := fmt.Sprintf("%06d", i)
		testx.AssertTrue(t, files[v]["up"], "version %s has no up file", v)
		testx.AssertTrue(t, files[v]["down"], "version %s has no down file", v)
	}
}
