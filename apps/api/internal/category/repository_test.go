package category_test

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

func TestMemoryRepository_List(t *testing.T) {
	parent := "p1"
	seed := []category.Category{
		{ID: "p1", Slug: "pakaian", Name: "Pakaian"},
		{ID: "c1", Slug: "kaos", Name: "Kaos", ParentID: &parent},
	}

	tests := []struct {
		name string
		in   []category.Category
		want int
	}{
		{name: "seeded", in: seed, want: 2},
		{name: "empty", in: nil, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := category.NewMemoryRepository(tt.in)
			got, err := repo.List(context.Background())
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(got), tt.want)
			for i := range got {
				testx.AssertEqual(t, got[i].ID, tt.in[i].ID)
				testx.AssertEqual(t, got[i].Slug, tt.in[i].Slug)
			}
		})
	}
}

func TestMemoryRepository_KeepsItsOwnCopy(t *testing.T) {
	seed := []category.Category{{ID: "a", Slug: "a", Name: "A"}, {ID: "b", Slug: "b", Name: "B"}}
	repo := category.NewMemoryRepository(seed)

	// Changing the slice passed in must not reach the repository.
	seed[0].Name = "changed by caller"

	first, err := repo.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	testx.AssertEqual(t, first[0].Name, "A", "constructor must clone its input")

	// Nor may changing (or reordering) a result change the next result.
	first[0].Name = "changed by reader"
	first[0], first[1] = first[1], first[0]

	second, err := repo.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	testx.AssertEqual(t, second[0].ID, "a", "List must return a copy")
	testx.AssertEqual(t, second[0].Name, "A", "List must return a copy")
}

func TestMemoryRepository_ContextDone(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	expired, cancel2 := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel2()

	tests := []struct {
		name string
		ctx  context.Context
		want error
	}{
		{name: "cancelled", ctx: cancelled, want: context.Canceled},
		{name: "deadline exceeded", ctx: expired, want: context.DeadlineExceeded},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := category.NewMemoryRepository(category.SeedCategories())
			got, err := repo.List(tt.ctx)
			testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			testx.AssertEqual(t, len(got), 0)
			testx.AssertTrue(t, got == nil, "no categories alongside an error")
		})
	}
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

func TestSeedCategories(t *testing.T) {
	seed := category.SeedCategories()

	parents := map[string]category.Category{}
	var children []category.Category
	ids := map[string]bool{}
	slugs := map[string]bool{}
	for _, c := range seed {
		t.Run(c.Slug, func(t *testing.T) {
			testx.AssertEqual(t, len(c.ID), 36, "UUID length of %q", c.ID)
			if len(c.ID) == 36 {
				testx.AssertEqual(t, c.ID[14], byte('7'), "UUID version of %q", c.ID)
			}
			testx.AssertTrue(t, slugPattern.MatchString(c.Slug), "slug %q is lower-case kebab", c.Slug)
			testx.AssertNotEqual(t, c.Name, "")
		})
		testx.AssertFalse(t, ids[c.ID], "duplicate id %s", c.ID)
		testx.AssertFalse(t, slugs[c.Slug], "duplicate slug %s", c.Slug)
		ids[c.ID], slugs[c.Slug] = true, true
		if c.IsTopLevel() {
			parents[c.ID] = c
		} else {
			children = append(children, c)
		}
	}

	testx.AssertEqual(t, len(parents), 4, "top-level categories")
	testx.AssertEqual(t, len(children), 9, "child categories")
	for _, c := range children {
		_, ok := parents[*c.ParentID]
		testx.AssertTrue(t, ok, "child %s points at parent %s, which is not top-level", c.Slug, *c.ParentID)
	}

	// IDs are generated on every call, not fixed.
	again := category.SeedCategories()
	testx.AssertNotEqual(t, again[0].ID, seed[0].ID)
}

func TestCategory_IsTopLevel(t *testing.T) {
	parent := "p"
	testx.AssertTrue(t, category.Category{}.IsTopLevel())
	testx.AssertFalse(t, category.Category{ParentID: &parent}.IsTopLevel())
}

func TestMemoryRepository_IDsBySlug(t *testing.T) {
	pakaian, elektronik := "p1", "p2"
	repo := category.NewMemoryRepository([]category.Category{
		{ID: "p1", Slug: "pakaian", Name: "Pakaian"},
		{ID: "c1", Slug: "kaos", Name: "Kaos", ParentID: &pakaian},
		{ID: "p2", Slug: "elektronik", Name: "Elektronik"},
		{ID: "c2", Slug: "kemeja", Name: "Kemeja", ParentID: &pakaian},
		{ID: "c3", Slug: "ponsel", Name: "Ponsel", ParentID: &elektronik},
		{ID: "p3", Slug: "kosong", Name: "Kosong"},
	})
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()

	tests := []struct {
		name    string
		ctx     context.Context
		slug    string
		want    string // IDs joined with commas, the category first
		wantErr error
	}{
		{name: "top-level with its children, in stored order", ctx: context.Background(), slug: "pakaian", want: "p1,c1,c2"},
		{name: "other parent's children are not included", ctx: context.Background(), slug: "elektronik", want: "p2,c3"},
		{name: "top-level without children", ctx: context.Background(), slug: "kosong", want: "p3"},
		{name: "child alone", ctx: context.Background(), slug: "kaos", want: "c1"},
		{name: "unknown", ctx: context.Background(), slug: "sepatu", wantErr: category.ErrNotFound},
		{name: "slug match is exact", ctx: context.Background(), slug: "Kaos", wantErr: category.ErrNotFound},
		{name: "empty slug", ctx: context.Background(), slug: "", wantErr: category.ErrNotFound},
		{name: "cancelled context wins over a match", ctx: cancelled, slug: "kaos", wantErr: context.Canceled},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := repo.IDsBySlug(tt.ctx, tt.slug)
			testx.AssertEqual(t, strings.Join(got, ","), tt.want)
			if tt.wantErr == nil {
				testx.AssertNoError(t, err)
				return
			}
			testx.AssertTrue(t, got == nil, "no IDs alongside an error")
			testx.AssertTrue(t, errors.Is(err, tt.wantErr), "err = %v, want %v", err, tt.wantErr)
		})
	}
}

func TestMemoryRepository_IDsBySlug_Seed(t *testing.T) {
	seed := category.SeedCategories()
	repo := category.NewMemoryRepository(seed)
	children := map[string]int{}
	for _, c := range seed {
		if c.ParentID != nil {
			children[*c.ParentID]++
		}
	}
	for _, c := range seed {
		got, err := repo.IDsBySlug(context.Background(), c.Slug)
		testx.AssertNoError(t, err)
		if len(got) == 0 {
			t.Fatalf("slug %s: no IDs", c.Slug)
		}
		testx.AssertEqual(t, got[0], c.ID, "slug %s: the category itself comes first", c.Slug)
		testx.AssertEqual(t, len(got), 1+children[c.ID], "slug %s", c.Slug)
	}
}
