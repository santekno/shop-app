package category_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// fakeRepo returns a fixed result, so the service is tested without a store.
type fakeRepo struct {
	categories []category.Category
	err        error
}

func (f fakeRepo) IDsBySlug(_ context.Context, slug string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	for _, c := range f.categories {
		if c.Slug == slug {
			return []string{c.ID, c.ID + "-child"}, nil
		}
	}
	return nil, category.ErrNotFound
}

func (f fakeRepo) List(context.Context) ([]category.Category, error) {
	if f.err != nil {
		return nil, f.err
	}
	return append([]category.Category(nil), f.categories...), nil
}

func TestService_List_Order(t *testing.T) {
	p1, p2 := "p1", "p2"
	tests := []struct {
		name string
		in   []category.Category
		want []string // IDs in the expected order
	}{
		{name: "empty", in: nil, want: nil},
		{
			name: "top-level before children, whatever the input order",
			in: []category.Category{
				{ID: "c1", Slug: "aaa", Name: "Aaa", ParentID: &p1},
				{ID: "p1", Slug: "zzz", Name: "Zzz"},
			},
			want: []string{"p1", "c1"},
		},
		{
			name: "each group by name, ignoring case",
			in: []category.Category{
				{ID: "c-b", Slug: "b", Name: "beta", ParentID: &p1},
				{ID: "p-e", Slug: "e", Name: "elektronik"},
				{ID: "c-a", Slug: "a", Name: "Alpha", ParentID: &p2},
				{ID: "p-P", Slug: "p", Name: "Pakaian"},
				{ID: "p-a", Slug: "x", Name: "aksesoris"},
			},
			want: []string{"p-a", "p-e", "p-P", "c-a", "c-b"},
		},
		{
			name: "same name: by slug",
			in: []category.Category{
				{ID: "2", Slug: "kopi-b", Name: "Kopi"},
				{ID: "1", Slug: "kopi-a", Name: "kopi"},
			},
			want: []string{"1", "2"},
		},
		{
			name: "identical name and slug keep their input order",
			in: []category.Category{
				{ID: "first", Slug: "s", Name: "N"},
				{ID: "second", Slug: "s", Name: "N"},
				{ID: "third", Slug: "s", Name: "N"},
			},
			want: []string{"first", "second", "third"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := category.NewService(fakeRepo{categories: tt.in})
			got, err := svc.List(context.Background())
			if err != nil {
				t.Fatalf("List: %v", err)
			}
			testx.AssertEqual(t, len(got), len(tt.want))
			for i := range min(len(got), len(tt.want)) {
				testx.AssertEqual(t, got[i].ID, tt.want[i], "position %d", i)
			}
		})
	}
}

// TestService_List_StableForEqualKeys uses enough equal categories that an
// unstable sort (pdqsort switches from insertion sort above 12 elements)
// would reorder them.
func TestService_List_StableForEqualKeys(t *testing.T) {
	var in []category.Category
	for i := range 50 {
		name := "Sama"
		if i%3 == 0 {
			name = "Beda"
		}
		in = append(in, category.Category{ID: fmt.Sprintf("%02d", i), Slug: "s", Name: name})
	}
	got, err := category.NewService(fakeRepo{categories: in}).List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	testx.AssertEqual(t, len(got), len(in))
	last := map[string]string{}
	for _, c := range got {
		testx.AssertTrue(t, c.ID > last[c.Name], "%s %s came after %s: equal categories were reordered", c.Name, c.ID, last[c.Name])
		last[c.Name] = c.ID
	}
	testx.AssertEqual(t, got[0].Name, "Beda")
}

func TestService_List_Seed(t *testing.T) {
	svc := category.NewService(category.NewMemoryRepository(category.SeedCategories()))
	got, err := svc.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var slugs []string
	for _, c := range got {
		slugs = append(slugs, c.Slug)
	}
	want := []string{
		"elektronik", "makanan-minuman", "pakaian", "rumah-tangga",
		"aksesoris-ponsel", "camilan", "celana", "dekorasi-rumah", "kaos",
		"kemeja", "kopi-teh", "peralatan-dapur", "ponsel",
	}
	testx.AssertEqual(t, len(slugs), len(want))
	for i := range min(len(slugs), len(want)) {
		testx.AssertEqual(t, slugs[i], want[i], "position %d", i)
	}
}

func TestService_List_Error(t *testing.T) {
	boom := errors.New("connection refused")
	tests := []struct {
		name string
		err  error
	}{
		{name: "deadline", err: context.DeadlineExceeded},
		{name: "cancelled", err: context.Canceled},
		{name: "store failure", err: boom},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := category.NewService(fakeRepo{err: tt.err})
			got, err := svc.List(context.Background())
			testx.AssertTrue(t, got == nil, "no categories alongside an error")
			if err == nil {
				t.Fatal("List: want error, got nil")
			}
			testx.AssertTrue(t, errors.Is(err, tt.err), "errors.Is(%v, %v)", err, tt.err)
			testx.AssertContains(t, err.Error(), "list categories: ")
		})
	}
}
