//go:build integration

package integration_test

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// The Bab 14 banner carousel: GET /v1/banners is public, lists the active
// banners in carousel order and nothing else. Banners have no endpoint that
// writes them (the seed or SQL does), so the tests insert rows the same way.

// bannerOut is Banner in api/openapi.yaml.
type bannerOut struct {
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	Subtitle         *string `json:"subtitle"`
	CTALabel         *string `json:"cta_label"`
	LinkCategorySlug *string `json:"link_category_slug"`
	BackgroundColor  string  `json:"background_color"`
}

// insertBanner stores a banner and returns its ID. Empty subtitle, cta and
// slug are stored as NULL.
func insertBanner(t *testing.T, db *sql.DB, id, title, subtitle, cta, slug, color string, position int, active bool) string {
	t.Helper()
	if id == "" {
		id = uuidx.NewV7()
	}
	null := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	mustExec(t, db, `INSERT INTO banners (id, title, subtitle, cta_label, link_category_slug, background_color, position, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, title, null(subtitle), null(cta), null(slug), color, position, active)
	return id
}

// assertBannerList checks a 200 GET /v1/banners response against BannerList
// and Banner, and returns the banners.
func assertBannerList(t *testing.T, resp response) []bannerOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("GET /v1/banners = %d, want 200: %s", resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, "GET /v1/banners")
	outer := object(t, resp.Body, "BannerList", "BannerList")
	if got := strings.TrimSpace(string(outer["data"])); got == "null" {
		t.Fatal("data is null, the contract wants an array")
	}
	var out []bannerOut
	for i, raw := range array(t, outer["data"], "data") {
		obj := object(t, raw, "Banner", fmt.Sprintf("data[%d]", i))
		// Nullable fields are present as null, never left out.
		for _, k := range []string{"subtitle", "cta_label", "link_category_slug"} {
			if _, ok := obj[k]; !ok {
				t.Errorf("banner %d has no %q key; the contract wants null", i, k)
			}
		}
		var b bannerOut
		if err := json.Unmarshal(raw, &b); err != nil {
			t.Fatalf("decode banner: %v", err)
		}
		if !uuidPattern.MatchString(b.ID) {
			t.Errorf("banner id %q is not a UUID", b.ID)
		}
		out = append(out, b)
	}
	return out
}

func bannerTitles(bs []bannerOut) []string {
	out := make([]string, 0, len(bs))
	for _, b := range bs {
		out = append(out, b.Title)
	}
	return out
}

// TestBanners_Empty: no banners is 200 with data [] (not null), public.
func TestBanners_Empty(t *testing.T) {
	s := startServer(t, nil)
	resp := s.get(t, "/v1/banners")
	if got := assertBannerList(t, resp); len(got) != 0 {
		t.Errorf("banners = %v, want none", got)
	}
	if body := strings.ReplaceAll(string(resp.Body), " ", ""); strings.TrimSpace(body) != `{"data":[]}` {
		t.Errorf("body = %s, want {\"data\":[]}", resp.Body)
	}
	assertNoErrorLog(t, s)
}

// TestBanners_ActiveInOrder: only active banners, by position, equal
// positions by id; the inactive one stays hidden; optional fields are null;
// no token is needed; flipping is_active shows in the next response.
func TestBanners_ActiveInOrder(t *testing.T) {
	s := startServer(t, nil)
	// Inserted out of order on purpose.
	insertBanner(t, s.db, "", "Ketiga", "Sub tiga", "Lihat", "kopi-teh", "#9A3412", 2, true)
	hidden := insertBanner(t, s.db, "", "Tersembunyi", "Tidak tampil", "x", "kaos", "#000000", 0, false)
	insertBanner(t, s.db, "", "Pertama", "Sub satu", "Lihat kaos", "kaos", "#1E40AF", 0, true)
	insertBanner(t, s.db, "", "Kedua", "", "", "", "#0f766e", 1, true) // nothing optional, lower-case hex
	// Two with the same position: the smaller id comes first.
	idA, idB := "0192f3c0-0000-7000-8000-00000000000a", "0192f3c0-0000-7000-8000-00000000000b"
	insertBanner(t, s.db, idB, "Kembar B", "", "", "", "#111111", 5, true)
	insertBanner(t, s.db, idA, "Kembar A", "", "", "", "#222222", 5, true)

	got := assertBannerList(t, s.get(t, "/v1/banners")) // no token
	want := []string{"Pertama", "Kedua", "Ketiga", "Kembar A", "Kembar B"}
	if titles := bannerTitles(got); strings.Join(titles, ",") != strings.Join(want, ",") {
		t.Fatalf("titles = %v, want %v", titles, want)
	}
	for _, b := range got {
		if b.ID == hidden {
			t.Error("the inactive banner is listed")
		}
	}

	first, second := got[0], got[1]
	if first.Subtitle == nil || *first.Subtitle != "Sub satu" || first.CTALabel == nil || *first.CTALabel != "Lihat kaos" ||
		first.LinkCategorySlug == nil || *first.LinkCategorySlug != "kaos" || first.BackgroundColor != "#1E40AF" {
		t.Errorf("first banner = %+v", first)
	}
	if second.Subtitle != nil || second.CTALabel != nil || second.LinkCategorySlug != nil || second.BackgroundColor != "#0f766e" {
		t.Errorf("second banner = %+v, want null subtitle, cta and link, and the colour as stored", second)
	}

	// Takes effect at once: no cache in front of the list.
	mustExec(t, s.db, `UPDATE banners SET is_active = true WHERE id = $1`, hidden)
	mustExec(t, s.db, `UPDATE banners SET is_active = false WHERE title = 'Pertama'`)
	got = assertBannerList(t, s.get(t, "/v1/banners"))
	if titles := bannerTitles(got); strings.Join(titles, ",") != "Tersembunyi,Kedua,Ketiga,Kembar A,Kembar B" {
		t.Errorf("after flipping is_active: %v", titles)
	}

	// A bad token on a public route does not matter, and a body-less POST is not a route.
	if r := s.call(t, http.MethodGet, "/v1/banners", nil, "garbage"); r.Status != http.StatusOK && r.Status != http.StatusUnauthorized {
		t.Errorf("GET /v1/banners with a garbage token = %d", r.Status)
	}
	if r := s.call(t, http.MethodPost, "/v1/banners", map[string]string{"title": "x"}, ""); r.Status < 400 || r.Status >= 500 {
		t.Errorf("POST /v1/banners = %d, want a 4xx (the API only reads banners)", r.Status)
	}
	assertNoErrorLog(t, s)
}

// TestBanners_ColumnChecks: the database refuses what the contract forbids,
// so a hand-written row cannot break the app's carousel.
func TestBanners_ColumnChecks(t *testing.T) {
	s := startServer(t, nil)
	tests := []struct{ name, title, color, slug string }{
		{"empty title", "", "#112233", ""},
		{"colour without #", "T", "112233", ""},
		{"short colour", "T", "#123", ""},
		{"named colour", "T", "red", ""},
		{"slug in upper case", "T", "#112233", "Kaos"},
		{"title over 100 characters", strings.Repeat("a", 101), "#112233", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var slug any
			if tt.slug != "" {
				slug = tt.slug
			}
			_, err := s.db.ExecContext(t.Context(), `INSERT INTO banners (id, title, link_category_slug, background_color, position)
				VALUES ($1, $2, $3, $4, 0)`, uuidx.NewV7(), tt.title, slug, tt.color)
			if err == nil {
				t.Error("the insert was accepted, want a CHECK violation")
			}
		})
	}
	if n := s.count(t, `SELECT count(*) FROM banners`); n != 0 {
		t.Errorf("%d rows were stored", n)
	}
}
