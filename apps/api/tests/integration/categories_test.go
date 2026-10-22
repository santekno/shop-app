//go:build integration

package integration_test

import (
	"bytes"
	"cmp"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// listedCategory is one decoded entry of GET /v1/categories.
type listedCategory struct {
	ID       string  `json:"id"`
	Slug     string  `json:"slug"`
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
}

// seededCategories is how many categories Bab 2's in-memory seed holds: four
// parents and nine children.
const (
	seededCategories = 13
	seededParents    = 4
)

// assertCategoryList checks a GET /v1/categories response against the
// contract (CategoryList and Category in api/openapi.yaml) and the listing
// rules, and returns the decoded categories. The stack test uses it too.
func assertCategoryList(t *testing.T, resp response) []listedCategory {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("GET /v1/categories = %d, want 200: %s", resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, "GET /v1/categories")

	listSchema := contractSchema(t, "CategoryList")
	categorySchema := contractSchema(t, "Category")

	outer := decodeObject(t, resp.Body)
	assertMatchesSchema(t, outer, listSchema, "CategoryList")

	var rawItems []json.RawMessage
	if err := json.Unmarshal(outer["data"], &rawItems); err != nil {
		t.Fatalf("data is not an array: %s", outer["data"])
	}

	cats := make([]listedCategory, 0, len(rawItems))
	for i, raw := range rawItems {
		item := decodeObject(t, raw)
		assertMatchesSchema(t, item, categorySchema, "data["+strconv.Itoa(i)+"]")

		// Types: id, slug and name are strings; parent_id is a string or
		// null, and it must be present even when null.
		for _, k := range []string{"id", "slug", "name"} {
			if len(item[k]) == 0 || item[k][0] != '"' {
				t.Errorf("data[%d].%s = %s, want a string", i, k, item[k])
			}
		}
		if p := item["parent_id"]; len(p) == 0 || (string(p) != "null" && p[0] != '"') {
			t.Errorf("data[%d].parent_id = %s, want a string or null", i, p)
		}

		var c listedCategory
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatalf("data[%d]: %v", i, err)
		}
		if !uuidPattern.MatchString(c.ID) {
			t.Errorf("data[%d].id = %q, want a lower-case UUID", i, c.ID)
		}
		if !slugPattern.MatchString(c.Slug) || len(c.Slug) > 100 {
			t.Errorf("data[%d].slug = %q, want the contract's slug pattern, at most 100 chars", i, c.Slug)
		}
		if strings.TrimSpace(c.Name) == "" {
			t.Errorf("data[%d].name is empty", i)
		}
		if c.ParentID != nil && !uuidPattern.MatchString(*c.ParentID) {
			t.Errorf("data[%d].parent_id = %q, want a UUID or null", i, *c.ParentID)
		}
		cats = append(cats, c)
	}
	return cats
}

func TestCategories_List(t *testing.T) {
	s := startServer(t, nil)
	resp := s.get(t, "/v1/categories")
	cats := assertCategoryList(t, resp)

	if len(cats) != seededCategories {
		t.Fatalf("got %d categories, want the %d seeded ones", len(cats), seededCategories)
	}

	// The contract: parents before children, each group sorted by name.
	topLevel := map[string]bool{}
	ids := map[string]bool{}
	slugs := map[string]bool{}
	for i, c := range cats {
		if ids[c.ID] || slugs[c.Slug] {
			t.Errorf("data[%d]: duplicate id %q or slug %q", i, c.ID, c.Slug)
		}
		ids[c.ID], slugs[c.Slug] = true, true

		if c.ParentID == nil {
			if i >= seededParents {
				t.Errorf("top-level %q at position %d, after a child", c.Slug, i)
			}
			topLevel[c.ID] = true
			continue
		}
		if i < seededParents {
			t.Errorf("child %q at position %d, before a top-level category", c.Slug, i)
		}
	}
	if len(topLevel) != seededParents {
		t.Errorf("got %d top-level categories (parent_id null), want %d", len(topLevel), seededParents)
	}
	for i, c := range cats {
		// Every parent_id points at a top-level category in the same list:
		// two levels, no dangling references.
		if c.ParentID != nil && !topLevel[*c.ParentID] {
			t.Errorf("data[%d] %q: parent_id %q is not a top-level category in the list", i, c.Slug, *c.ParentID)
		}
		if i > 0 && (cats[i-1].ParentID == nil) == (c.ParentID == nil) {
			prev := cats[i-1]
			if cmp.Or(
				strings.Compare(strings.ToLower(prev.Name), strings.ToLower(c.Name)),
				strings.Compare(prev.Slug, c.Slug),
			) > 0 {
				t.Errorf("not sorted by name: %q before %q", prev.Name, c.Name)
			}
		}
	}
	if cats[0].Slug != "elektronik" || cats[0].ParentID != nil {
		t.Errorf("first category = %q, want the top-level \"elektronik\"", cats[0].Slug)
	}

	// Names are written as they are: "Makanan & Minuman", not "&".
	if !bytes.Contains(resp.Body, []byte(`"Makanan & Minuman"`)) {
		t.Errorf("body does not contain the unescaped name \"Makanan & Minuman\":\n%s", resp.Body)
	}
}

// TestCategories_StableAndConcurrent sends many requests at once to the same
// server: every one succeeds with the very same body, so the in-memory
// repository is safe to share and a caller cannot change what the next one
// sees.
func TestCategories_StableAndConcurrent(t *testing.T) {
	s := startServer(t, nil)
	want := s.get(t, "/v1/categories").Body

	const n = 20
	var wg sync.WaitGroup
	errs := make([]error, n)
	results := make([]response, n)
	for i := range n {
		// t.Fatal must not be called from another goroutine, so these
		// requests report errors instead.
		wg.Go(func() { results[i], errs[i] = tryRequest(s.client, http.MethodGet, s.URL+"/v1/categories", nil) })
	}
	wg.Wait()
	for i, r := range results {
		if errs[i] != nil {
			t.Errorf("request %d: %v", i, errs[i])
			continue
		}
		if r.Status != http.StatusOK || !bytes.Equal(r.Body, want) {
			t.Errorf("request %d: status %d, body differs from the first response: %s", i, r.Status, r.Body)
		}
	}
}
