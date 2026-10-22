package product

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

func newTestService(repo *fakeRepo) (*Service, *fakeCategories) {
	categories := &fakeCategories{ids: map[string][]string{"kaos": {"cat-kaos"}, "pakaian": {"cat-pakaian", "cat-kaos", "cat-kemeja"}}}
	return NewService(repo, categories), categories
}

func TestService_List_RejectsBadParams(t *testing.T) {
	tests := []struct {
		name    string
		params  ListParams
		wantErr string
	}{
		{name: "limit 0", params: ListParams{Sort: SortNewest, Limit: 0}, wantErr: "list products: limit 0 out of range"},
		{name: "limit 101", params: ListParams{Sort: SortNewest, Limit: 101}, wantErr: "list products: limit 101 out of range"},
		{name: "zero sort", params: ListParams{Limit: 20}, wantErr: `list products: unknown sort ""`},
		{name: "unknown sort", params: ListParams{Sort: "popular", Limit: 20}, wantErr: `list products: unknown sort "popular"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc, _ := newTestService(repo)

			page, err := svc.List(context.Background(), tt.params)

			if err == nil {
				t.Fatalf("List: want error %q, got nil", tt.wantErr)
			}
			testx.AssertEqual(t, err.Error(), tt.wantErr)
			// A programming mistake in the handler, not the client's: a
			// plain error (500), not ErrInvalidCursor.
			testx.AssertFalse(t, errors.Is(err, ErrInvalidCursor))
			testx.AssertEqual(t, len(page.Products), 0)
			testx.AssertEqual(t, len(repo.listQueries), 0, "the store is not asked")
		})
	}
}

func TestService_List_LimitBounds(t *testing.T) {
	for _, limit := range []int{1, MaxLimit} {
		repo := &fakeRepo{}
		svc, _ := newTestService(repo)
		_, err := svc.List(context.Background(), ListParams{Sort: SortNewest, Limit: limit})
		testx.AssertNoError(t, err, "limit %d", limit)
	}
	testx.AssertEqual(t, MaxLimit, 100)
}

func TestService_List_Query(t *testing.T) {
	tests := []struct {
		name         string
		params       ListParams
		wantCategory string // CategoryIDs joined with commas; "" for none
		wantSearch   string
	}{
		{name: "no filters", params: ListParams{Sort: SortNewest, Limit: 20}},
		{name: "category resolved to its ID", params: ListParams{Sort: SortPriceAsc, Category: "kaos", Limit: 5}, wantCategory: "cat-kaos"},
		{
			name:         "parent category resolved to itself and its children",
			params:       ListParams{Sort: SortNewest, Category: "pakaian", Limit: 5},
			wantCategory: "cat-pakaian,cat-kaos,cat-kemeja",
		},
		{name: "search is trimmed", params: ListParams{Sort: SortPriceDesc, Query: "  kaos hitam \t", Limit: 20}, wantSearch: "kaos hitam"},
		{name: "blank search is no search", params: ListParams{Sort: SortNewest, Query: "   ", Limit: 20}, wantSearch: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{}
			svc, categories := newTestService(repo)

			_, err := svc.List(context.Background(), tt.params)

			testx.AssertNoError(t, err)
			if len(repo.listQueries) != 1 {
				t.Fatalf("store asked %d times, want 1", len(repo.listQueries))
			}
			q := repo.listQueries[0]
			testx.AssertEqual(t, q.Limit, tt.params.Limit+1, "one more than asked, to know whether a next page exists")
			testx.AssertEqual(t, q.Sort, tt.params.Sort)
			testx.AssertEqual(t, q.Search, tt.wantSearch)
			testx.AssertEqual(t, q.After, startPosition(tt.params.Sort), "the first page starts at the start")
			testx.AssertEqual(t, strings.Join(q.CategoryIDs, ","), tt.wantCategory)
			if tt.wantCategory == "" {
				testx.AssertTrue(t, q.CategoryIDs == nil, "CategoryIDs = %v, want nil (every category)", q.CategoryIDs)
				testx.AssertEqual(t, len(categories.asked), 0, "no category lookup without a filter")
			} else {
				testx.AssertEqual(t, strings.Join(categories.asked, ","), tt.params.Category)
			}
		})
	}
}

// A cursor made for "kaos hitam" still fits a request whose search differs
// only in surrounding spaces: the search is trimmed before the fingerprint.
func TestService_List_TrimmedSearchKeepsTheCursor(t *testing.T) {
	products := testProducts(3)
	repo := &fakeRepo{listResult: products}
	svc, _ := newTestService(repo)

	first, err := svc.List(context.Background(), ListParams{Sort: SortNewest, Query: "kaos hitam", Limit: 2})
	testx.AssertNoError(t, err)

	_, err = svc.List(context.Background(), ListParams{Sort: SortNewest, Query: " kaos hitam ", Limit: 2, Cursor: first.NextCursor})
	testx.AssertNoError(t, err)
}

func TestService_List_Pages(t *testing.T) {
	tests := []struct {
		name       string
		returned   int // rows the store returns for limit 2 (asked for 3)
		wantLen    int
		wantCursor bool
	}{
		{name: "empty", returned: 0, wantLen: 0},
		{name: "short last page", returned: 1, wantLen: 1},
		{name: "exactly the limit is the last page", returned: 2, wantLen: 2},
		{name: "the extra row means a next page", returned: 3, wantLen: 2, wantCursor: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			products := testProducts(tt.returned)
			repo := &fakeRepo{listResult: products}
			svc, _ := newTestService(repo)
			params := ListParams{Sort: SortNewest, Limit: 2}

			page, err := svc.List(context.Background(), params)

			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(page.Products), tt.wantLen)
			testx.AssertEqual(t, page.NextCursor != "", tt.wantCursor, "NextCursor = %q", page.NextCursor)
			if !tt.wantCursor {
				return
			}
			// The cursor points after the last product shown, not the extra.
			testx.AssertEqual(t, page.NextCursor, encodeCursor(params, products[1]))
			params.Cursor = page.NextCursor
			_, err = svc.List(context.Background(), params)
			testx.AssertNoError(t, err)
			after := repo.listQueries[1].After
			testx.AssertEqual(t, after.ID, products[1].ID)
			testx.AssertTrue(t, after.CreatedAt.Equal(products[1].CreatedAt), "After.CreatedAt = %s", after.CreatedAt)
		})
	}
}

func TestService_List_Errors(t *testing.T) {
	boom := errors.New("connection refused")
	valid := encodeCursor(ListParams{Sort: SortNewest}, testProducts(1)[0])
	tests := []struct {
		name       string
		params     ListParams
		categories *fakeCategories
		repoErr    error
		wantIs     error
		wantExact  bool // the error is wantIs itself, not wrapped
		wantPrefix string
		wantStore  bool // the store was asked
	}{
		{
			name:   "bad cursor",
			params: ListParams{Sort: SortNewest, Limit: 20, Cursor: "%%%"},
			wantIs: ErrInvalidCursor,
		},
		{
			name:   "cursor for another sort",
			params: ListParams{Sort: SortPriceAsc, Limit: 20, Cursor: valid},
			wantIs: ErrInvalidCursor,
		},
		{
			name:      "unknown category",
			params:    ListParams{Sort: SortNewest, Limit: 20, Category: "kemeja"},
			wantIs:    ErrUnknownCategory,
			wantExact: true,
		},
		{
			name:       "category lookup fails",
			params:     ListParams{Sort: SortNewest, Limit: 20, Category: "kaos"},
			categories: &fakeCategories{err: boom},
			wantIs:     boom,
			wantPrefix: "list products: ",
		},
		{
			name:       "store fails",
			params:     ListParams{Sort: SortNewest, Limit: 20},
			repoErr:    boom,
			wantIs:     boom,
			wantPrefix: "list products: ",
			wantStore:  true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeRepo{listErr: tt.repoErr, listResult: testProducts(1)}
			svc, _ := newTestService(repo)
			if tt.categories != nil {
				svc = NewService(repo, tt.categories)
			}

			page, err := svc.List(context.Background(), tt.params)

			testx.AssertTrue(t, errors.Is(err, tt.wantIs), "err = %v, want %v", err, tt.wantIs)
			if tt.wantExact {
				testx.AssertEqual(t, err, tt.wantIs)
			}
			if errors.Is(tt.wantIs, boom) {
				testx.AssertFalse(t, errors.Is(err, ErrUnknownCategory), "a failing lookup is not an unknown category")
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.wantPrefix), "err = %v", err)
			testx.AssertEqual(t, len(page.Products), 0)
			testx.AssertEqual(t, page.NextCursor, "")
			testx.AssertEqual(t, len(repo.listQueries) == 1, tt.wantStore, "store asked %d times", len(repo.listQueries))
		})
	}
}

func TestService_Get(t *testing.T) {
	repo := &fakeRepo{}
	svc, _ := newTestService(repo)
	p, err := svc.Get(context.Background(), "kaos-polos-hitam")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, p.Slug, "kaos-polos-hitam")
	testx.AssertEqual(t, repo.getSlug, "kaos-polos-hitam")

	repo = &fakeRepo{getErr: ErrNotFound}
	svc, _ = newTestService(repo)
	_, err = svc.Get(context.Background(), "hilang")
	testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
	testx.AssertEqual(t, err.Error(), "get product hilang: product not found")
}

func TestService_GetAdmin(t *testing.T) {
	const id = "0190c8a0-0000-7000-8000-000000000001"
	repo := &fakeRepo{admin: AdminProduct{Slug: "kaos"}}
	svc, _ := newTestService(repo)
	p, err := svc.GetAdmin(context.Background(), id)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, p.ID, id)
	testx.AssertEqual(t, p.Slug, "kaos")

	repo = &fakeRepo{adminErr: ErrNotFound}
	svc, _ = newTestService(repo)
	_, err = svc.GetAdmin(context.Background(), id)
	testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
	testx.AssertEqual(t, err.Error(), "get product "+id+": product not found")
}

func TestService_Create(t *testing.T) {
	const newID = "0190c8a0-0000-7000-8000-0000000000aa"
	in := Input{Slug: "kaos", Variants: []VariantInput{{SKU: "A"}, {SKU: "B"}}}

	repo := &fakeRepo{createID: newID, admin: AdminProduct{Slug: "kaos"}}
	svc, _ := newTestService(repo)
	p, err := svc.Create(context.Background(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, p.ID, newID, "the stored product is read back by its new ID")
	testx.AssertEqual(t, len(repo.created), 1)
	testx.AssertEqual(t, len(repo.adminIDs), 1)
}

func TestService_Create_Errors(t *testing.T) {
	boom := errors.New("connection refused")
	tests := []struct {
		name       string
		in         Input
		repo       *fakeRepo
		wantIs     error
		wantExact  bool
		wantStored bool
	}{
		{
			name:      "a variant with an ID is refused before the store",
			in:        Input{Variants: []VariantInput{{SKU: "A"}, {ID: "0190c8a0-0000-7000-8000-000000000009", SKU: "B"}}},
			repo:      &fakeRepo{},
			wantIs:    ErrUnknownVariant,
			wantExact: true,
		},
		{name: "slug taken", in: Input{Variants: []VariantInput{{SKU: "A"}}}, repo: &fakeRepo{createErr: ErrSlugTaken}, wantIs: ErrSlugTaken, wantStored: true},
		{name: "store fails", in: Input{Variants: []VariantInput{{SKU: "A"}}}, repo: &fakeRepo{createErr: boom}, wantIs: boom, wantStored: true},
		{name: "read back fails", in: Input{Variants: []VariantInput{{SKU: "A"}}}, repo: &fakeRepo{createID: "x", adminErr: boom}, wantIs: boom, wantStored: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _ := newTestService(tt.repo)
			p, err := svc.Create(context.Background(), tt.in)
			testx.AssertTrue(t, errors.Is(err, tt.wantIs), "err = %v, want %v", err, tt.wantIs)
			if tt.wantExact {
				testx.AssertEqual(t, err, tt.wantIs)
			}
			testx.AssertEqual(t, p.ID, "")
			testx.AssertEqual(t, len(tt.repo.created) == 1, tt.wantStored)
		})
	}
}

func TestService_Update(t *testing.T) {
	const id = "0190c8a0-0000-7000-8000-000000000001"
	in := Input{Slug: "kaos-baru", Variants: []VariantInput{{ID: "0190c8a0-0000-7000-8000-000000000002", SKU: "A"}}}
	repo := &fakeRepo{admin: AdminProduct{Slug: "kaos-baru"}}
	svc, _ := newTestService(repo)

	p, err := svc.Update(context.Background(), id, in)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, p.ID, id)
	testx.AssertEqual(t, repo.updatedID, id)
	testx.AssertEqual(t, repo.updated.Slug, "kaos-baru")
	testx.AssertEqual(t, len(repo.adminIDs), 1, "read back after the save")
}

func TestService_Update_Errors(t *testing.T) {
	const id = "0190c8a0-0000-7000-8000-000000000001"
	for _, want := range []error{ErrNotFound, ErrUnknownVariant, ErrSKUTaken, ErrUnknownCategory} {
		t.Run(want.Error(), func(t *testing.T) {
			repo := &fakeRepo{updateErr: want}
			svc, _ := newTestService(repo)
			_, err := svc.Update(context.Background(), id, Input{})
			testx.AssertTrue(t, errors.Is(err, want), "err = %v", err)
			testx.AssertEqual(t, err.Error(), "update product "+id+": "+want.Error())
			testx.AssertEqual(t, len(repo.adminIDs), 0, "nothing is read back after a failed save")
		})
	}
}

func TestService_Archive(t *testing.T) {
	const id = "0190c8a0-0000-7000-8000-000000000001"
	repo := &fakeRepo{}
	svc, _ := newTestService(repo)
	testx.AssertNoError(t, svc.Archive(context.Background(), id))
	testx.AssertEqual(t, len(repo.archived), 1)
	testx.AssertEqual(t, repo.archived[0], id)

	repo = &fakeRepo{archiveErr: ErrNotFound}
	svc, _ = newTestService(repo)
	err := svc.Archive(context.Background(), id)
	testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
	testx.AssertEqual(t, err.Error(), "archive product "+id+": product not found")
}

func TestProduct_InStock(t *testing.T) {
	tests := []struct {
		name     string
		variants []Variant
		want     bool
	}{
		{name: "no variants", variants: nil, want: false},
		{name: "all sold out", variants: []Variant{{Stock: 0}, {Stock: 0}}, want: false},
		{name: "one in stock", variants: []Variant{{Stock: 0}, {Stock: 1}}, want: true},
		{name: "first in stock", variants: []Variant{{Stock: 5}, {Stock: 0}}, want: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testx.AssertEqual(t, Product{Variants: tt.variants}.InStock(), tt.want)
		})
	}
}

// The admin's variant order is what the repository stores as position: the
// service passes the list on as it came, on create and on update.
func TestService_KeepsTheVariantOrder(t *testing.T) {
	in := Input{Variants: []VariantInput{{SKU: "C"}, {SKU: "A"}, {SKU: "B"}}}
	repo := &fakeRepo{createID: "id"}
	svc, _ := newTestService(repo)

	_, err := svc.Create(context.Background(), in)
	testx.AssertNoError(t, err)
	_, err = svc.Update(context.Background(), "id", in)
	testx.AssertNoError(t, err)

	order := func(in Input) string {
		var skus []string
		for _, v := range in.Variants {
			skus = append(skus, v.SKU)
		}
		return strings.Join(skus, ",")
	}
	testx.AssertEqual(t, order(repo.created[0]), "C,A,B")
	testx.AssertEqual(t, order(repo.updated), "C,A,B")
}
