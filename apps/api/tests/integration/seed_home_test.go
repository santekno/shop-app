//go:build integration

package integration_test

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
	"time"
)

// makeSeed runs `make seed` against dsn, exactly as a developer does, and
// returns its combined output.
func makeSeed(t *testing.T, dsn string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Minute)
	defer cancel()
	//nolint:gosec // G204: make with the test's own arguments, not user input
	cmd := exec.CommandContext(ctx, "make", "--no-print-directory", "-C", repoRoot, "seed", "DATABASE_URL="+dsn)
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("make seed = %v:\n%s", err, out)
	}
	return string(out)
}

// TestSeedHome_Idempotent: make seed (Bab 14) features four example
// products and adds three banners; a second run adds and changes nothing,
// and leaves alone a banner switched off and a title edited by hand. The API
// then serves them.
func TestSeedHome_Idempotent(t *testing.T) {
	s := startServer(t, nil)

	first := makeSeed(t, s.dbURL)
	if !strings.Contains(first, "featured products: 4 marked, 0 already featured") ||
		!strings.Contains(first, "banners: 3 added, 0 already there") {
		t.Errorf("first run output:\n%s", first)
	}
	snapshot := func() (featured []string, banners []string) {
		rows, err := s.db.QueryContext(t.Context(), `SELECT slug FROM products WHERE is_featured ORDER BY slug`)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				t.Fatal(err)
			}
			featured = append(featured, v)
		}
		_ = rows.Close()
		rows, err = s.db.QueryContext(t.Context(), `SELECT id || '|' || title || '|' || position || '|' || is_active || '|' || updated_at FROM banners ORDER BY position`)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var v string
			if err := rows.Scan(&v); err != nil {
				t.Fatal(err)
			}
			banners = append(banners, v)
		}
		_ = rows.Close()
		return featured, banners
	}
	featured1, banners1 := snapshot()
	if len(featured1) != 4 || len(banners1) != 3 {
		t.Fatalf("after the first seed: %d featured, %d banners; want 4 and 3", len(featured1), len(banners1))
	}

	second := makeSeed(t, s.dbURL)
	if !strings.Contains(second, "featured products: 0 marked, 4 already featured") ||
		!strings.Contains(second, "banners: 0 added, 3 already there") {
		t.Errorf("second run output:\n%s", second)
	}
	featured2, banners2 := snapshot()
	if !slices.Equal(featured1, featured2) || !slices.Equal(banners1, banners2) {
		t.Errorf("a second seed changed rows:\nfeatured %v -> %v\nbanners %v -> %v", featured1, featured2, banners1, banners2)
	}

	// Hand edits survive a third run.
	mustExec(t, s.db, `UPDATE banners SET is_active = false WHERE position = 1`)
	mustExec(t, s.db, `UPDATE products SET is_featured = false WHERE slug = 'kaos-polos-hitam'`)
	third := makeSeed(t, s.dbURL)
	if !strings.Contains(third, "banners: 0 added, 3 already there") || !strings.Contains(third, "featured products: 1 marked, 3 already featured") {
		t.Errorf("third run output:\n%s", third)
	}
	if n := s.count(t, `SELECT count(*) FROM banners`); n != 3 {
		t.Errorf("%d banners after the third run, want 3", n)
	}
	if n := s.count(t, `SELECT count(*) FROM banners WHERE position = 1 AND NOT is_active`); n != 1 {
		t.Error("the seed switched a banner back on")
	}

	// The API serves what the seed made.
	titles := bannerTitles(assertBannerList(t, s.get(t, "/v1/banners")))
	if want := []string{"Kaos Baru Musim Ini", "Kopi Nusantara"}; !slices.Equal(titles, want) {
		t.Errorf("banners = %v, want %v", titles, want)
	}
	products, _ := assertProductList(t, s.get(t, "/v1/products?featured=true&limit=100"))
	if len(products) != 4 {
		t.Errorf("featured products = %v, want the four example ones", productSlugs(products))
	}
	for _, p := range products {
		if !uuidPattern.MatchString(p.ID) || p.Slug == "" {
			t.Errorf("bad product %+v", p)
		}
	}
	if r := s.get(t, "/v1/banners"); r.Status != http.StatusOK {
		t.Errorf("GET /v1/banners = %d", r.Status)
	}
}
