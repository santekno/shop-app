package wishlist

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/product"
)

var errBoom = errors.New("boom")

// fakeRepo is a Repository that keeps per-user wishlists in memory and
// enforces the same rules PostgresRepository does (unknown or non-active
// slug, size limit for new products only), so Service is tested against its
// contract. Calls and arguments are recorded.
type fakeRepo struct {
	// active maps slug to product ID; a slug not here is not an active product.
	active map[string]string
	// lists holds each user's entries, newest saved first.
	lists  map[string][]Entry
	noUser map[string]bool

	addErr, removeErr, listErr error

	adds, removes []string // "user slug"
	lastAfter     position
	lastLimit     int
	listCalls     int
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{active: map[string]string{}, lists: map[string][]Entry{}, noUser: map[string]bool{}}
}

func (f *fakeRepo) Add(_ context.Context, userID, slug string) error {
	f.adds = append(f.adds, userID+" "+slug)
	if f.addErr != nil {
		return f.addErr
	}
	if f.noUser[userID] {
		return ErrNoUser
	}
	id, ok := f.active[slug]
	if !ok {
		return ErrProductNotFound
	}
	for _, e := range f.lists[userID] {
		if e.ProductID == id {
			return nil
		}
	}
	if len(f.lists[userID]) >= MaxItems {
		return ErrLimitReached
	}
	f.lists[userID] = append([]Entry{{ProductID: id, AddedAt: time.Now()}}, f.lists[userID]...)
	return nil
}

func (f *fakeRepo) Remove(_ context.Context, userID, slug string) error {
	f.removes = append(f.removes, userID+" "+slug)
	if f.removeErr != nil {
		return f.removeErr
	}
	id := f.active[slug]
	kept := f.lists[userID][:0:0]
	for _, e := range f.lists[userID] {
		if e.ProductID != id {
			kept = append(kept, e)
		}
	}
	f.lists[userID] = kept
	return nil
}

func (f *fakeRepo) List(_ context.Context, userID string, after position, limit int) ([]Entry, error) {
	f.listCalls++
	f.lastAfter, f.lastLimit = after, limit
	if f.listErr != nil {
		return nil, f.listErr
	}
	var out []Entry
	for _, e := range f.lists[userID] {
		before := e.AddedAt.Before(after.CreatedAt) || (e.AddedAt.Equal(after.CreatedAt) && e.ProductID < after.ProductID)
		if before && len(out) < limit {
			out = append(out, e)
		}
	}
	return out, nil
}

// fakeProducts answers ListActiveByIDs from the products it holds, in
// reverse id order (the contract says "no particular order").
type fakeProducts struct {
	byID  map[string]product.Product
	err   error
	asked [][]string
}

func (f *fakeProducts) ListActiveByIDs(_ context.Context, ids []string) ([]product.Product, error) {
	f.asked = append(f.asked, ids)
	if f.err != nil {
		return nil, f.err
	}
	var out []product.Product
	for i := len(ids) - 1; i >= 0; i-- {
		if p, ok := f.byID[ids[i]]; ok {
			out = append(out, p)
		}
	}
	return out, nil
}

func pid(n int) string { return fmt.Sprintf("0190c8a0-0000-7000-8000-%012d", n) }

func slugOf(n int) string { return fmt.Sprintf("produk-%d", n) }

// seeded returns a repo whose catalog has n active products (1..n) and a
// service on it. products holds all of them.
func seeded(n int) (*Service, *fakeRepo, *fakeProducts) {
	repo := newFakeRepo()
	products := &fakeProducts{byID: map[string]product.Product{}}
	for i := 1; i <= n; i++ {
		repo.active[slugOf(i)] = pid(i)
		products.byID[pid(i)] = product.Product{ID: pid(i), Slug: slugOf(i)}
	}
	return NewService(repo, products), repo, products
}

// save puts product n on user's list, saved at base+n seconds, so a larger
// n is saved later (and listed earlier).
func save(repo *fakeRepo, userID string, ns ...int) {
	base := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	for _, n := range ns {
		repo.lists[userID] = append([]Entry{{ProductID: pid(n), AddedAt: base.Add(time.Duration(n) * time.Second)}}, repo.lists[userID]...)
	}
}

func slugs(page Page) string {
	out := make([]string, 0, len(page.Products))
	for _, p := range page.Products {
		out = append(out, p.Slug)
	}
	return strings.Join(out, ",")
}

func TestService_Add(t *testing.T) {
	fullList := func(r *fakeRepo) {
		for i := 1; i <= MaxItems; i++ {
			r.lists[user] = append(r.lists[user], Entry{ProductID: pid(1000 + i), AddedAt: time.Unix(int64(i), 0)})
		}
	}
	tests := []struct {
		name     string
		setup    func(*fakeRepo)
		userID   string
		slug     string
		wantErr  error
		wantSize int
	}{
		{name: "saves an active product", userID: user, slug: slugOf(1), wantSize: 1},
		{name: "saving it again is a success that changes nothing", setup: func(r *fakeRepo) { save(r, user, 1) }, userID: user, slug: slugOf(1), wantSize: 1},
		{
			name:  "already saved at the cap is still a success",
			setup: func(r *fakeRepo) { fullList(r); r.lists[user][0].ProductID = pid(1) }, userID: user, slug: slugOf(1), wantSize: MaxItems,
		},
		{name: "one below the cap still accepts a new product", setup: func(r *fakeRepo) {
			fullList(r)
			r.lists[user] = r.lists[user][1:]
		}, userID: user, slug: slugOf(1), wantSize: MaxItems},
		{name: "a new product at the cap is refused", setup: fullList, userID: user, slug: slugOf(1), wantErr: ErrLimitReached, wantSize: MaxItems},
		{name: "an unknown slug", userID: user, slug: "tidak-ada", wantErr: ErrProductNotFound},
		{
			name:  "a non-active product is an unknown one",
			setup: func(r *fakeRepo) { delete(r.active, slugOf(2)) }, userID: user, slug: slugOf(2), wantErr: ErrProductNotFound,
		},
		{name: "a deleted account", setup: func(r *fakeRepo) { r.noUser[user] = true }, userID: user, slug: slugOf(1), wantErr: ErrNoUser},
		{name: "another user's list does not count against this one", setup: func(r *fakeRepo) {
			r.lists["other"] = make([]Entry, MaxItems)
		}, userID: user, slug: slugOf(1), wantSize: 1},
		{name: "a storage failure passes through", setup: func(r *fakeRepo) { r.addErr = errBoom }, userID: user, slug: slugOf(1), wantErr: errBoom},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, repo, _ := seeded(3)
			if tt.setup != nil {
				tt.setup(repo)
			}

			err := svc.Add(context.Background(), tt.userID, tt.slug)

			if tt.wantErr != nil {
				testx.AssertTrue(t, errors.Is(err, tt.wantErr), "err = %v, want %v", err, tt.wantErr)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), "add to wishlist: "), "err = %v", err)
			} else {
				testx.AssertNoError(t, err)
			}
			testx.AssertEqual(t, len(repo.lists[tt.userID]), tt.wantSize)
			testx.AssertEqual(t, strings.Join(repo.adds, ","), tt.userID+" "+tt.slug, "the caller and the slug reach the repository")
		})
	}
}

func TestService_Remove(t *testing.T) {
	tests := []struct {
		name     string
		slug     string
		wantKept string // product numbers left, joined
		wantErr  error
	}{
		{name: "removes a saved product", slug: slugOf(1), wantKept: "2"},
		{name: "a product that is not saved is not an error", slug: slugOf(3), wantKept: "1,2"},
		{name: "an unknown slug is not an error", slug: "tidak-ada", wantKept: "1,2"},
		{name: "a storage failure passes through", slug: slugOf(1), wantErr: errBoom},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, repo, _ := seeded(3)
			save(repo, user, 1, 2)
			save(repo, "other", 1)
			if tt.wantErr != nil {
				repo.removeErr = tt.wantErr
			}

			err := svc.Remove(context.Background(), user, tt.slug)

			if tt.wantErr != nil {
				testx.AssertTrue(t, errors.Is(err, tt.wantErr), "err = %v", err)
				testx.AssertEqual(t, err.Error(), "remove from wishlist: boom")
				return
			}
			testx.AssertNoError(t, err)
			var kept []string
			for _, e := range repo.lists[user] {
				kept = append(kept, strings.TrimLeft(e.ProductID[len(e.ProductID)-12:], "0"))
			}
			sort.Strings(kept)
			testx.AssertEqual(t, strings.Join(kept, ","), tt.wantKept)
			testx.AssertEqual(t, len(repo.lists["other"]), 1, "another user's list is untouched")
			testx.AssertEqual(t, strings.Join(repo.removes, ","), user+" "+tt.slug)
		})
	}
}

func TestService_List_LimitBounds(t *testing.T) {
	tests := []struct {
		limit   int
		wantErr string
	}{
		{limit: 0, wantErr: "list wishlist: limit 0 out of range"},
		{limit: -1, wantErr: "list wishlist: limit -1 out of range"},
		{limit: MaxLimit + 1, wantErr: "list wishlist: limit 101 out of range"},
		{limit: 1},
		{limit: MaxLimit},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprint(tt.limit), func(t *testing.T) {
			svc, repo, _ := seeded(1)

			_, err := svc.List(context.Background(), user, "", tt.limit)

			if tt.wantErr != "" {
				testx.AssertEqual(t, err.Error(), tt.wantErr)
				testx.AssertEqual(t, repo.listCalls, 0, "the store is not asked")
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, repo.lastLimit, tt.limit+1, "one more than asked, to know whether a next page exists")
		})
	}
}

func TestService_List_Pages(t *testing.T) {
	tests := []struct {
		name       string
		saved      int // products 1..saved, product n saved at second n
		limit      int
		wantSlugs  string
		wantCursor bool
	}{
		{name: "empty", saved: 0, limit: 2, wantSlugs: ""},
		{name: "short last page", saved: 1, limit: 2, wantSlugs: "produk-1"},
		{name: "exactly the limit is the last page", saved: 2, limit: 2, wantSlugs: "produk-2,produk-1"},
		{name: "the extra row means a next page", saved: 3, limit: 2, wantSlugs: "produk-3,produk-2", wantCursor: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, repo, _ := seeded(5)
			for n := 1; n <= tt.saved; n++ {
				save(repo, user, n)
			}

			page, err := svc.List(context.Background(), user, "", tt.limit)

			testx.AssertNoError(t, err)
			testx.AssertTrue(t, page.Products != nil, "an empty page is [], not nil")
			testx.AssertEqual(t, slugs(page), tt.wantSlugs, "newest saved first, even though the products come back in reverse")
			testx.AssertEqual(t, page.NextCursor != "", tt.wantCursor, "NextCursor = %q", page.NextCursor)
			testx.AssertEqual(t, repo.lastAfter, firstPage, "the first page starts at the start")
			testx.AssertEqual(t, repo.lastLimit, tt.limit+1)
		})
	}
}

// Walking every page gives every saved product once, newest saved first,
// and the cursor always points after the last product shown (not the extra).
func TestService_List_WalksAllPages(t *testing.T) {
	svc, repo, _ := seeded(5)
	save(repo, user, 1, 2, 3, 4, 5)

	var got []string
	cursor := ""
	for i := 0; i < 5; i++ {
		page, err := svc.List(context.Background(), user, cursor, 2)
		testx.AssertNoError(t, err)
		got = append(got, slugs(page))
		if page.NextCursor == "" {
			break
		}
		last := page.Products[len(page.Products)-1]
		pos, err := decodeCursor(page.NextCursor)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, pos.ProductID, last.ID, "the cursor is the last product shown")
		cursor = page.NextCursor
	}

	testx.AssertEqual(t, strings.Join(got, "|"), "produk-5,produk-4|produk-3,produk-2|produk-1")
}

func TestService_List_OnlyTheCallersEntries(t *testing.T) {
	svc, repo, _ := seeded(3)
	save(repo, user, 1)
	save(repo, "other", 2, 3)

	page, err := svc.List(context.Background(), user, "", 10)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, slugs(page), "produk-1")
}

func TestService_List_AsksForExactlyThePageProducts(t *testing.T) {
	svc, repo, products := seeded(3)
	save(repo, user, 1, 2, 3)

	_, err := svc.List(context.Background(), user, "", 2)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(products.asked), 1, "one product query per page")
	testx.AssertEqual(t, strings.Join(products.asked[0], ","), pid(3)+","+pid(2), "the page's ids in order, without the extra row")
}

func TestService_List_EmptyPageAsksForNoProducts(t *testing.T) {
	svc, _, products := seeded(3)

	page, err := svc.List(context.Background(), user, "", 20)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(page.Products), 0)
	testx.AssertEqual(t, len(products.asked), 0)
}

// A product archived between the two reads leaves the page, in place.
func TestService_List_DropsProductsNoLongerActive(t *testing.T) {
	svc, repo, products := seeded(4)
	save(repo, user, 1, 2, 3, 4)
	delete(products.byID, pid(3))

	page, err := svc.List(context.Background(), user, "", 3)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, slugs(page), "produk-4,produk-2", "produk-3 is gone, the others keep their order")
	testx.AssertTrue(t, page.NextCursor != "", "the next page is still reachable")

	t.Run("every product of the page gone is an empty page", func(t *testing.T) {
		delete(products.byID, pid(4))
		delete(products.byID, pid(2))
		page, err := svc.List(context.Background(), user, "", 3)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(page.Products), 0)
		testx.AssertTrue(t, page.Products != nil)
	})
}

func TestService_List_Errors(t *testing.T) {
	tests := []struct {
		name    string
		cursor  string
		setup   func(*fakeRepo, *fakeProducts)
		wantErr error
		wantMsg string
	}{
		{name: "garbage cursor", cursor: "not*base64", wantErr: ErrInvalidCursor, wantMsg: "invalid cursor: not base64url"},
		{
			name:    "a cursor of another list",
			cursor:  rawCursor(t, cursorJSON{List: "orders", CreatedAt: time.Now(), ID: pid(1)}),
			wantErr: ErrInvalidCursor, wantMsg: "invalid cursor: made for another list",
		},
		{
			name:    "the entries query fails",
			setup:   func(r *fakeRepo, _ *fakeProducts) { r.listErr = errBoom },
			wantErr: errBoom, wantMsg: "list wishlist: boom",
		},
		{
			name: "the products query fails",
			setup: func(r *fakeRepo, p *fakeProducts) {
				save(r, user, 1)
				p.err = errBoom
			},
			wantErr: errBoom, wantMsg: "list wishlist: boom",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, repo, products := seeded(2)
			if tt.setup != nil {
				tt.setup(repo, products)
			}

			page, err := svc.List(context.Background(), user, tt.cursor, 5)

			testx.AssertTrue(t, errors.Is(err, tt.wantErr), "err = %v", err)
			testx.AssertEqual(t, err.Error(), tt.wantMsg)
			testx.AssertEqual(t, len(page.Products), 0)
			testx.AssertEqual(t, page.NextCursor, "")
			if tt.cursor != "" {
				testx.AssertEqual(t, repo.listCalls, 0, "a refused cursor never reaches the store")
			}
		})
	}
}

// A cursor made by one page decodes to the position the store is asked for.
func TestService_List_CursorBecomesThePosition(t *testing.T) {
	svc, repo, _ := seeded(4)
	save(repo, user, 1, 2, 3, 4)
	first, err := svc.List(context.Background(), user, "", 2)
	testx.AssertNoError(t, err)

	_, err = svc.List(context.Background(), user, first.NextCursor, 2)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, repo.lastAfter.ProductID, pid(3))
	testx.AssertTrue(t, repo.lastAfter.CreatedAt.Equal(repo.lists[user][1].AddedAt), "CreatedAt = %s", repo.lastAfter.CreatedAt)
}
