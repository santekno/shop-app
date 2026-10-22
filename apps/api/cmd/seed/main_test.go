package main

// The inserts run against PostgreSQL (make seed); here are the parts that
// need no database: the localhost guard, the guards in run, price_from, and
// the catalog itself.

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

func TestRequireLocal(t *testing.T) {
	const refusal = "only localhost, 127.0.0.1 or ::1, unless -allow-remote is given"
	tests := []struct {
		name        string
		url         string
		allowRemote bool
		wantErr     string // "" when allowed
	}{
		{name: "localhost", url: "postgres://user@localhost:5432/goshop?sslmode=disable"},
		{name: "localhost without a port", url: "postgres://localhost/goshop"},
		{name: "127.0.0.1", url: "postgres://user@127.0.0.1:5432/goshop"},
		{name: "::1", url: "postgres://user@[::1]:5432/goshop"},
		{name: "empty is left to run", url: ""},
		{name: "remote host", url: "postgres://user@db.example.com:5432/goshop", wantErr: `refusing to seed the database on "db.example.com": ` + refusal},
		{name: "Compose service name", url: "postgres://user@postgres:5432/goshop", wantErr: `refusing to seed the database on "postgres": ` + refusal},
		{name: "another loopback address", url: "postgres://user@127.0.0.2:5432/goshop", wantErr: `on "127.0.0.2"`},
		{name: "a name that starts with localhost", url: "postgres://user@localhost.example.com/goshop", wantErr: `on "localhost.example.com"`},
		{name: "local host= and hostaddr= values", url: "postgres://user@localhost/goshop?host=127.0.0.1,::1&hostaddr=127.0.0.1"},
		{name: "a Unix socket in host=", url: "postgres://user@localhost/goshop?host=/var/run/postgresql"},
		{name: "host= overrides the URL's host", url: "postgres://user@localhost/goshop?host=db.example.com", wantErr: `on "db.example.com"`},
		{name: "any remote entry in a host= list", url: "postgres://user@localhost/goshop?host=localhost,db.example.com", wantErr: `on "db.example.com"`},
		{name: "hostaddr= is checked too", url: "postgres://user@localhost/goshop?hostaddr=10.0.0.5", wantErr: `on "10.0.0.5"`},
		{name: "a relative path is not a socket", url: "postgres://user@localhost/goshop?host=var/run", wantErr: `on "var/run"`},
		{name: "remote with -allow-remote", url: "postgres://user@db.example.com:5432/goshop", allowRemote: true},
		{name: "remote host= with -allow-remote", url: "postgres://user@localhost/goshop?host=db.example.com", allowRemote: true},
		{name: "invalid URL", url: "postgres://user@db.example.com/%zz", wantErr: "DATABASE_URL is not a valid URL"},
		{name: "invalid URL with -allow-remote is left to run", url: "postgres://user@db.example.com/%zz", allowRemote: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := requireLocal(tt.url, tt.allowRemote)
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				return
			}
			if err == nil {
				t.Fatalf("requireLocal: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertFalse(t, strings.Contains(err.Error(), "user@"), "error repeats the login: %v", err)
		})
	}
}

func TestIsLocalHost(t *testing.T) {
	tests := []struct {
		host string
		want bool
	}{
		{"localhost", true},
		{"127.0.0.1", true},
		{"::1", true},
		{"/var/run/postgresql", true},
		{"/tmp", true},
		{"", false},
		{"LOCALHOST", false},
		{"127.0.0.2", false},
		{"[::1]", false},
		{"db.example.com", false},
		{"localhost.example.com", false},
		{"tmp/socket", false},
	}
	for _, tt := range tests {
		t.Run(tt.host, func(t *testing.T) {
			testx.AssertEqual(t, isLocalHost(tt.host), tt.want)
		})
	}
}

func TestRun_Guards(t *testing.T) {
	const url = "postgres://127.0.0.1:1/goshop?sslmode=disable"
	tests := []struct {
		name      string
		url       string
		generated int
		wantErr   string
	}{
		{name: "no DATABASE_URL", url: "", wantErr: "DATABASE_URL is not set (make seed sets it to the Compose postgres)"},
		{name: "negative -generated", url: url, generated: -1, wantErr: "-generated must be between 0 and 100000, got -1"},
		{name: "-generated above the cap", url: url, generated: 100_001, wantErr: "-generated must be between 0 and 100000, got 100001"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := run(context.Background(), tt.url, tt.generated)
			if err == nil {
				t.Fatalf("run: want error %q, got nil", tt.wantErr)
			}
			testx.AssertEqual(t, err.Error(), tt.wantErr)
		})
	}
}

func TestRun_DatabaseUnreachable(t *testing.T) {
	// Port 1 on loopback refuses at once; the guards passed, so the error
	// is the database's, and it does not repeat the URL.
	const url = "postgres://127.0.0.1:1/goshop?sslmode=disable"
	err := run(context.Background(), url, 100_000)
	if err == nil {
		t.Fatal("run: want error, got nil")
	}
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "err = %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), url), "error repeats the URL: %v", err)
}

func TestPriceFrom(t *testing.T) {
	tests := []struct {
		name     string
		variants []seedVariant
		want     sql.NullInt64
	}{
		{name: "no variants is NULL", variants: nil, want: sql.NullInt64{}},
		{name: "all archived is NULL", variants: []seedVariant{{price: 1000, archived: true}}, want: sql.NullInt64{}},
		{
			name:     "lowest price",
			variants: []seedVariant{{price: 99000}, {price: 89000}, {price: 109000}},
			want:     sql.NullInt64{Int64: 89000, Valid: true},
		},
		{
			name:     "archived variants do not count, however cheap",
			variants: []seedVariant{{price: 99000}, {price: 1000, archived: true}, {price: 89000}},
			want:     sql.NullInt64{Int64: 89000, Valid: true},
		},
		{
			name:     "the first sellable one counts even after an archived one",
			variants: []seedVariant{{price: 5000, archived: true}, {price: 70000}},
			want:     sql.NullInt64{Int64: 70000, Valid: true},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testx.AssertEqual(t, priceFrom(tt.variants), tt.want)
		})
	}
}

var (
	slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	skuPattern  = regexp.MustCompile(`^[A-Z0-9][A-Z0-9-]*$`)
)

// The catalog is what the articles and the storefront show, so it has to
// pass the same rules the API enforces on a write.
func TestCatalog(t *testing.T) {
	categories := map[string]bool{}
	for _, c := range category.SeedCategories() {
		categories[c.Slug] = true
	}

	testx.AssertTrue(t, len(catalog) >= 20, "catalog has %d products", len(catalog))
	slugs, skus := map[string]bool{}, map[string]bool{}
	var soldOut, archived int
	for _, p := range catalog {
		t.Run(p.slug, func(t *testing.T) {
			testx.AssertTrue(t, categories[p.category], "category %q is not in category.SeedCategories", p.category)
			testx.AssertTrue(t, slugPattern.MatchString(p.slug), "slug %q", p.slug)
			testx.AssertTrue(t, len(p.slug) <= 200, "slug longer than 200")
			testx.AssertTrue(t, p.name != "" && len(p.name) <= 200, "name %q", p.name)
			testx.AssertTrue(t, len(p.description) <= 5000, "description longer than 5000")
			testx.AssertTrue(t, len(p.variants) >= 1 && len(p.variants) <= 50, "%d variants", len(p.variants))
			testx.AssertTrue(t, priceFrom(p.variants).Valid, "no sellable variant: an active product needs a price_from")
			for _, v := range p.variants {
				testx.AssertTrue(t, skuPattern.MatchString(v.sku) && len(v.sku) <= 64, "SKU %q is not upper case", v.sku)
				testx.AssertTrue(t, v.name != "" && len(v.name) <= 100, "variant name %q", v.name)
				testx.AssertTrue(t, v.price >= 1 && v.price <= 1_000_000_000, "price %d of %s", v.price, v.sku)
				testx.AssertTrue(t, v.stock >= 0 && v.stock <= 1_000_000, "stock %d of %s", v.stock, v.sku)
				testx.AssertTrue(t, v.weight >= 1 && v.weight <= 100_000, "weight %d of %s", v.weight, v.sku)
			}
		})
		testx.AssertFalse(t, slugs[p.slug], "duplicate slug %s", p.slug)
		slugs[p.slug] = true
		inStock := false
		for _, v := range p.variants {
			testx.AssertFalse(t, skus[v.sku], "duplicate SKU %s", v.sku)
			skus[v.sku] = true
			if v.archived {
				archived++
			} else if v.stock > 0 {
				inStock = true
			}
		}
		if !inStock {
			soldOut++
		}
	}
	// The examples the articles use: a sold-out product and an archived
	// variant.
	testx.AssertTrue(t, soldOut >= 1, "no sold-out product to show in_stock=false")
	testx.AssertTrue(t, archived >= 1, "no archived variant to show it is left out")
}
