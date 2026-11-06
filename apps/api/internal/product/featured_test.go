package product

// Bab 14 artikel-01: the featured filter in the cursor, the service and
// PostgresRepository (on the fake SQL driver; the SQL itself runs against
// PostgreSQL in tests/integration).

import (
	"context"
	"database/sql/driver"
	"errors"
	"testing"

	"github.com/santekno/sdk/testx"
)

var allSorts = []Sort{SortNewest, SortPriceAsc, SortPriceDesc}

// pinnedKaosHitam is the first 8 bytes of SHA-256("kaos\nhitam"), hex: the
// fingerprint of category "kaos" + search "hitam" as Bab 3 computed it.
const pinnedKaosHitam = "b631956d2af94bdd"

// Cursors handed out before the featured filter existed must keep working:
// their fingerprint is pinned here as a literal, so changing the key of a
// request without featured breaks this test.
func TestFilterKey_FeaturedKeepsOldKeysValid(t *testing.T) {
	testx.AssertEqual(t, filterKey(ListParams{Category: "kaos", Query: "hitam"}), pinnedKaosHitam,
		"without featured the key is what it was in Bab 3")
	testx.AssertNotEqual(t, filterKey(ListParams{Category: "kaos", Query: "hitam", Featured: true}), pinnedKaosHitam)
	testx.AssertNotEqual(t, filterKey(ListParams{Featured: true}), filterKey(ListParams{}))
	testx.AssertEqual(t, len(filterKey(ListParams{Featured: true})), 16)
	testx.AssertEqual(t, filterKey(ListParams{Featured: true, Sort: SortPriceAsc, Limit: 5, Cursor: "x"}), filterKey(ListParams{Featured: true}),
		"only the filters count")
	// "featured" as a search text must not collide with the flag.
	testx.AssertNotEqual(t, filterKey(ListParams{Query: "featured"}), filterKey(ListParams{Featured: true}))
}

func TestCursor_Featured(t *testing.T) {
	p := testProducts(1)[0]
	for _, sort := range allSorts {
		t.Run(string(sort), func(t *testing.T) {
			featured := ListParams{Sort: sort, Featured: true}
			plain := ListParams{Sort: sort}

			t.Run("a featured cursor decodes on a featured query", func(t *testing.T) {
				next := featured
				next.Cursor = encodeCursor(featured, p)
				got, err := decodeCursor(next)
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, got.ID, p.ID)
			})
			t.Run("a featured cursor is refused on a non-featured query", func(t *testing.T) {
				next := plain
				next.Cursor = encodeCursor(featured, p)
				_, err := decodeCursor(next)
				testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor), "err = %v", err)
				testx.AssertEqual(t, err.Error(), "invalid cursor: made for another sort or other filters")
			})
			t.Run("a non-featured cursor is refused on a featured query", func(t *testing.T) {
				next := featured
				next.Cursor = encodeCursor(plain, p)
				_, err := decodeCursor(next)
				testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor), "err = %v", err)
			})
			t.Run("an old cursor (made before the filter) still decodes", func(t *testing.T) {
				old := ListParams{Sort: sort, Category: "kaos", Query: "hitam"}
				cursor := rawCursor(t, cursorJSON{
					Sort: sort, Filter: pinnedKaosHitam, Price: 100, ID: p.ID, CreatedAt: p.CreatedAt,
				})
				old.Cursor = cursor
				got, err := decodeCursor(old)
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, got.ID, p.ID)
			})
		})
	}
}

func TestService_List_Featured(t *testing.T) {
	for _, sort := range allSorts {
		for _, featured := range []bool{false, true} {
			name := string(sort) + "/featured=" + map[bool]string{false: "false", true: "true"}[featured]
			t.Run(name, func(t *testing.T) {
				repo := &fakeRepo{}
				svc, _ := newTestService(repo)

				_, err := svc.List(context.Background(), ListParams{Sort: sort, Featured: featured, Limit: 5})

				testx.AssertNoError(t, err)
				testx.AssertEqual(t, len(repo.listQueries), 1)
				testx.AssertEqual(t, repo.listQueries[0].Featured, featured)
			})
		}
	}
}

func TestService_List_FeaturedCursorIsBoundToTheFilter(t *testing.T) {
	for _, sort := range allSorts {
		t.Run(string(sort), func(t *testing.T) {
			repo := &fakeRepo{listResult: testProducts(3)}
			svc, _ := newTestService(repo)
			first, err := svc.List(context.Background(), ListParams{Sort: sort, Featured: true, Limit: 2})
			testx.AssertNoError(t, err)
			testx.AssertTrue(t, first.NextCursor != "", "three rows for limit 2 means a next page")

			// The same filter continues from the cursor.
			_, err = svc.List(context.Background(), ListParams{Sort: sort, Featured: true, Limit: 2, Cursor: first.NextCursor})
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, repo.listQueries[1].After.ID, first.Products[1].ID)
			testx.AssertTrue(t, repo.listQueries[1].Featured, "the next page is still featured")

			// Dropping the filter does not.
			before := len(repo.listQueries)
			_, err = svc.List(context.Background(), ListParams{Sort: sort, Limit: 2, Cursor: first.NextCursor})
			testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor), "err = %v", err)
			testx.AssertEqual(t, len(repo.listQueries), before, "the store is not asked with a foreign cursor")
		})
	}
}

// featured goes to the SQL of every sort, as the third argument.
func TestPostgresRepository_List_PassesFeatured(t *testing.T) {
	queries := map[Sort]string{
		SortNewest: "ListProductsNewest", SortPriceAsc: "ListProductsPriceAsc", SortPriceDesc: "ListProductsPriceDesc",
	}
	for _, sort := range allSorts {
		for _, featured := range []bool{true, false} {
			t.Run(string(sort), func(t *testing.T) {
				db := newFakeSQL()

				_, err := NewPostgresRepository(db.open(t)).List(context.Background(), ListQuery{Sort: sort, Featured: featured, Limit: 21})

				testx.AssertNoError(t, err)
				call, ok := db.call(queries[sort])
				testx.AssertTrue(t, ok, "%s did not run: %v", queries[sort], db.names())
				testx.AssertEqual(t, call.args[2], driver.Value(featured), "featured is the third argument")
				assertSQL(t, db, queries[sort], "NOT $3::boolean OR p.is_featured")
			})
		}
	}
}
