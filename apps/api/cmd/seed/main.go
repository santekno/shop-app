// Command seed fills a development database with the example catalog:
// the categories from category.SeedCategories and the products in
// catalog.go. It is safe to run again: rows whose slug or SKU already exists
// are left as they are.
//
//	DATABASE_URL=postgres://… go run ./cmd/seed               # make seed
//	DATABASE_URL=postgres://… go run ./cmd/seed -generated 10000 # make seed-large
//
// It refuses a DATABASE_URL whose host is not localhost, 127.0.0.1 or ::1,
// unless -allow-remote is given: dummy products must never reach a real
// shop because a production URL was left in the shell.
//
// -generated adds that many machine-made products on top, enough for EXPLAIN
// ANALYZE to show the indexes at work (docs/explain/catalog.md).
//
// -admin creates or promotes one admin account instead of seeding the
// catalog, with the password in SEED_ADMIN_PASSWORD (make seed-admin):
//
//	SEED_ADMIN_PASSWORD=… DATABASE_URL=postgres://… go run ./cmd/seed -admin admin@goshop.local
//
// -loadtest N seeds N verified buyers with addresses and a load-test
// product for the k6 checkout test, and resets the run's stock (make
// seed-loadtest; password in SEED_LOADTEST_PASSWORD):
//
//	SEED_LOADTEST_PASSWORD=… DATABASE_URL=postgres://… go run ./cmd/seed -loadtest 50
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
)

func main() {
	generated := flag.Int("generated", 0, "also insert this many generated products (for EXPLAIN on a larger catalog)")
	allowRemote := flag.Bool("allow-remote", false, "seed a database that is not on this machine")
	admin := flag.String("admin", "", "create or promote this admin account (password in "+adminPasswordEnv+"; promoting revokes its sessions) instead of seeding the catalog")
	loadTest := flag.Int("loadtest", 0, "seed this many load-test buyers and the load-test product (password in "+loadTestPasswordEnv+") and reset its stock, instead of seeding the catalog")
	flag.Parse()

	databaseURL := os.Getenv("DATABASE_URL")
	err := requireLocal(databaseURL, *allowRemote)
	if err == nil {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
		switch {
		case *admin != "":
			err = runAdmin(ctx, databaseURL, *admin, os.Getenv(adminPasswordEnv))
		case *loadTest != 0:
			err = runLoadTest(ctx, databaseURL, *loadTest, os.Getenv(loadTestPasswordEnv))
		default:
			err = run(ctx, databaseURL, *generated)
		}
		stop()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, databaseURL string, generated int) error {
	if databaseURL == "" {
		return errors.New("DATABASE_URL is not set (make seed sets it to the Compose postgres)")
	}
	if generated < 0 || generated > 100_000 {
		return fmt.Errorf("-generated must be between 0 and 100000, got %d", generated)
	}
	db, err := database.Open(ctx, config.Database{URL: databaseURL}, logx.Noop())
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	categoryIDs, err := seedCategories(ctx, db)
	if err != nil {
		return fmt.Errorf("categories (did you run make migrate-up?): %w", err)
	}
	fmt.Printf("categories: %d\n", len(categoryIDs))

	added, err := seedProducts(ctx, db, categoryIDs, catalog)
	if err != nil {
		return err
	}
	fmt.Printf("products: %d added, %d already there\n", added, len(catalog)-added)

	addedVouchers, err := seedVouchers(ctx, db)
	if err != nil {
		return err
	}
	fmt.Printf("vouchers: %d added, %d already there\n", addedVouchers, len(vouchers)-addedVouchers)

	if generated > 0 {
		return seedGenerated(ctx, db, categoryIDs, generated)
	}
	return nil
}

func runAdmin(ctx context.Context, databaseURL, email, password string) error {
	if databaseURL == "" {
		return errors.New("DATABASE_URL is not set (make seed-admin sets it to the Compose postgres)")
	}
	db, err := database.Open(ctx, config.Database{URL: databaseURL}, logx.Noop())
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	created, err := seedAdmin(ctx, db, email, password)
	if err != nil {
		return err
	}
	if created {
		fmt.Printf("admin %s created\n", auth.NormalizeEmail(email))
	} else {
		fmt.Printf("admin %s: existing account promoted, password replaced; its sessions are revoked "+
			"(access tokens already issued work until they expire, 15 minutes by default)\n", auth.NormalizeEmail(email))
	}
	return nil
}

// requireLocal refuses a databaseURL whose host is not this machine, unless
// allowRemote. An empty URL passes: run reports it with a better message.
func requireLocal(databaseURL string, allowRemote bool) error {
	if allowRemote || databaseURL == "" {
		return nil
	}
	u, err := url.Parse(databaseURL)
	if err != nil {
		return errors.New("DATABASE_URL is not a valid URL") // url's error would repeat the password
	}
	// pgx lets a host= or hostaddr= parameter (a comma-separated list)
	// override the host in the URL, so every one of them must be local too.
	var hosts []string
	for _, key := range []string{"host", "hostaddr"} {
		for h := range strings.SplitSeq(u.Query().Get(key), ",") {
			if h != "" {
				hosts = append(hosts, h)
			}
		}
	}
	// A socket-only URL such as postgres:///goshop?host=/var/run/postgresql
	// has no host of its own: the parameters above say where it connects.
	// Without them an empty host is still refused, because pgx then falls
	// back to PGHOST, which may name any machine.
	if u.Hostname() != "" || len(hosts) == 0 {
		hosts = append(hosts, u.Hostname())
	}
	for _, h := range hosts {
		if !isLocalHost(h) {
			return fmt.Errorf("refusing to seed the database on %q: only localhost, 127.0.0.1 or ::1, unless -allow-remote is given", h)
		}
	}
	return nil
}

// isLocalHost reports whether h names this machine: a loopback name or
// address, or a Unix socket directory.
func isLocalHost(h string) bool {
	switch h {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	return strings.HasPrefix(h, "/")
}

// seedProducts inserts each product with its variants and reports how many
// were new.
func seedProducts(ctx context.Context, db *sql.DB, categoryIDs map[string]string, products []seedProduct) (int, error) {
	added := 0
	for _, p := range products {
		categoryID, ok := categoryIDs[p.category]
		if !ok {
			return added, fmt.Errorf("product %s: unknown category %q", p.slug, p.category)
		}
		inserted, err := insertProduct(ctx, db, categoryID, p, "active", time.Time{})
		if err != nil {
			return added, fmt.Errorf("product %s: %w", p.slug, err)
		}
		if inserted {
			added++
		}
	}
	return added, nil
}
