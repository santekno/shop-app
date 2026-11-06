package wishlist

// PostgresRepository on the fake SQL driver (fakesql_test.go). The SQL
// itself, the lock and the cap under concurrency run against PostgreSQL in
// tests/integration.

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

const slug = "kaos-polos-hitam"

// open is a database where the user exists, the slug names an active
// product, and the user has saved items products (saved: whether this one
// is among them).
func addDB(saved bool, items int64) *fakeSQL {
	return newFakeSQL().
		on("LockUser", rows(user)).
		on("GetActiveProductIDBySlug", rows(pidA)).
		on("WishlistItemExists", rows(saved)).
		on("CountWishlistItems", rows(items))
}

func endsWith(t *testing.T, db *fakeSQL, last string) {
	t.Helper()
	names := db.names()
	testx.AssertEqual(t, names[len(names)-1], last, "statements: %v", names)
	other := "COMMIT"
	if last == "COMMIT" {
		other = "ROLLBACK"
	}
	testx.AssertFalse(t, strings.Contains(strings.Join(names, ","), other), "statements: %v", names)
}

func TestPostgresRepository_Add(t *testing.T) {
	t.Run("a new product is inserted in one transaction that locks the user first", func(t *testing.T) {
		db := addDB(false, 5)

		err := NewPostgresRepository(db.open(t)).Add(context.Background(), user, slug)

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(db.names(), ","),
			"BEGIN,LockUser,GetActiveProductIDBySlug,WishlistItemExists,CountWishlistItems,InsertWishlistItem,COMMIT")
		assertLockedFirst(t, db, "LockUser")
		call, _ := db.call("LockUser")
		assertArgs(t, call.args, []driver.Value{user})
		call, _ = db.call("GetActiveProductIDBySlug")
		assertArgs(t, call.args, []driver.Value{slug})
		call, _ = db.call("WishlistItemExists")
		assertArgs(t, call.args, []driver.Value{user, pidA})
		call, _ = db.call("CountWishlistItems")
		assertArgs(t, call.args, []driver.Value{user})
		call, _ = db.call("InsertWishlistItem")
		assertArgs(t, call.args, []driver.Value{user, pidA})
		assertSQL(t, db, "InsertWishlistItem", "ON CONFLICT (user_id, product_id) DO NOTHING")
		assertSQL(t, db, "LockUser", "FOR UPDATE", "anonymized_at IS NULL")
		assertSQL(t, db, "GetActiveProductIDBySlug", "status = 'active'")
		assertSQL(t, db, "CountWishlistItems", "p.status = 'active'")
		endsWith(t, db, "COMMIT")
	})
	t.Run("an already saved product is a success without a count or an insert, even at the cap", func(t *testing.T) {
		db := addDB(true, MaxItems)

		err := NewPostgresRepository(db.open(t)).Add(context.Background(), user, slug)

		testx.AssertNoError(t, err)
		testx.AssertFalse(t, db.ran("CountWishlistItems"))
		testx.AssertFalse(t, db.ran("InsertWishlistItem"))
		endsWith(t, db, "COMMIT")
	})
	t.Run("the cap", func(t *testing.T) {
		tests := []struct {
			items   int64
			wantErr error
		}{
			{items: 0},
			{items: MaxItems - 1},
			{items: MaxItems, wantErr: ErrLimitReached},
			{items: MaxItems + 5, wantErr: ErrLimitReached},
		}
		for _, tt := range tests {
			t.Run(fmt.Sprint(tt.items), func(t *testing.T) {
				db := addDB(false, tt.items)

				err := NewPostgresRepository(db.open(t)).Add(context.Background(), user, slug)

				if tt.wantErr == nil {
					testx.AssertNoError(t, err)
					testx.AssertTrue(t, db.ran("InsertWishlistItem"))
					endsWith(t, db, "COMMIT")
					return
				}
				testx.AssertTrue(t, err == tt.wantErr, "err = %v, want %v", err, tt.wantErr)
				testx.AssertFalse(t, db.ran("InsertWishlistItem"), "nothing is inserted at the cap")
				endsWith(t, db, "ROLLBACK")
			})
		}
	})
	t.Run("a deleted or anonymised account", func(t *testing.T) {
		db := newFakeSQL() // LockUser has no row

		err := NewPostgresRepository(db.open(t)).Add(context.Background(), user, slug)

		testx.AssertTrue(t, err == ErrNoUser, "err = %v", err)
		testx.AssertFalse(t, db.ran("GetActiveProductIDBySlug"))
		endsWith(t, db, "ROLLBACK")
	})
	t.Run("an unknown or non-active product", func(t *testing.T) {
		db := newFakeSQL().on("LockUser", rows(user)) // the slug query has no row

		err := NewPostgresRepository(db.open(t)).Add(context.Background(), user, slug)

		testx.AssertTrue(t, err == ErrProductNotFound, "err = %v", err)
		testx.AssertFalse(t, db.ran("InsertWishlistItem"))
		endsWith(t, db, "ROLLBACK")
	})
	t.Run("a database failure at each step is wrapped and rolls back", func(t *testing.T) {
		tests := []struct{ step, wantMsg string }{
			{"LockUser", "lock user: boom"},
			{"GetActiveProductIDBySlug", "query product: boom"},
			{"WishlistItemExists", "query wishlist item: boom"},
			{"CountWishlistItems", "count wishlist items: boom"},
			{"InsertWishlistItem", "insert wishlist item: boom"},
		}
		for _, tt := range tests {
			t.Run(tt.step, func(t *testing.T) {
				db := addDB(false, 1).on(tt.step, failWith(errBoom))
				// The earlier on() for the step answers first; replace it.
				db.answers[tt.step] = []fakeAnswer{failWith(errBoom)}

				err := NewPostgresRepository(db.open(t)).Add(context.Background(), user, slug)

				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertEqual(t, err.Error(), tt.wantMsg)
				endsWith(t, db, "ROLLBACK")
			})
		}
	})
}

func TestPostgresRepository_Remove(t *testing.T) {
	t.Run("deletes by user and slug", func(t *testing.T) {
		db := newFakeSQL()

		err := NewPostgresRepository(db.open(t)).Remove(context.Background(), user, slug)

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(db.names(), ","), "DeleteWishlistItem", "one statement, no transaction")
		call, _ := db.call("DeleteWishlistItem")
		assertArgs(t, call.args, []driver.Value{user, slug})
		assertSQL(t, db, "DeleteWishlistItem", "user_id = $1")
	})
	t.Run("nothing to delete is not an error", func(t *testing.T) {
		db := newFakeSQL().on("DeleteWishlistItem", fakeAnswer{affected: 0})

		testx.AssertNoError(t, NewPostgresRepository(db.open(t)).Remove(context.Background(), user, "tidak-ada"))
	})
	t.Run("a database failure is wrapped", func(t *testing.T) {
		db := newFakeSQL().on("DeleteWishlistItem", failWith(errBoom))

		err := NewPostgresRepository(db.open(t)).Remove(context.Background(), user, slug)

		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "delete wishlist item: boom")
	})
}

func TestPostgresRepository_List(t *testing.T) {
	t1 := time.Date(2026, 11, 1, 10, 0, 2, 0, time.UTC)
	t2 := time.Date(2026, 11, 1, 10, 0, 1, 0, time.UTC)

	t.Run("maps the rows in the order the database gave them", func(t *testing.T) {
		db := newFakeSQL().on("ListWishlistItems", fakeAnswer{rows: [][]driver.Value{{pidB, t1}, {pidA, t2}}})
		after := position{CreatedAt: t1.Add(time.Hour), ProductID: pidC}

		got, err := NewPostgresRepository(db.open(t)).List(context.Background(), user, after, 21)

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 2)
		testx.AssertEqual(t, got[0].ProductID, pidB)
		testx.AssertTrue(t, got[0].AddedAt.Equal(t1))
		testx.AssertEqual(t, got[1].ProductID, pidA)
		testx.AssertTrue(t, got[1].AddedAt.Equal(t2))
		call, _ := db.call("ListWishlistItems")
		assertArgs(t, call.args, []driver.Value{user, after.CreatedAt, pidC, int64(21)})
		assertSQL(t, db, "ListWishlistItems", "p.status = 'active'", "w.user_id = $1", "ORDER BY w.created_at DESC, w.product_id DESC")
	})
	t.Run("no rows is an empty, non-nil slice", func(t *testing.T) {
		got, err := NewPostgresRepository(newFakeSQL().open(t)).List(context.Background(), user, firstPage, 21)

		testx.AssertNoError(t, err)
		testx.AssertTrue(t, got != nil)
		testx.AssertEqual(t, len(got), 0)
	})
	t.Run("a database failure is wrapped", func(t *testing.T) {
		db := newFakeSQL().on("ListWishlistItems", failWith(errBoom))

		got, err := NewPostgresRepository(db.open(t)).List(context.Background(), user, firstPage, 21)

		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "query wishlist: boom")
		testx.AssertTrue(t, got == nil)
	})
}

// Account deletion clears the wishlist in the deletion's transaction: the
// hook runs on the queries it is given.
func TestAccountCloser(t *testing.T) {
	closer := AccountCloser()

	t.Run("deletes the user's rows", func(t *testing.T) {
		db := newFakeSQL()

		err := closer(context.Background(), sqlc.New(db.open(t)), user)

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(db.names(), ","), "DeleteUserWishlist")
		call, _ := db.call("DeleteUserWishlist")
		assertArgs(t, call.args, []driver.Value{user})
		assertSQL(t, db, "DeleteUserWishlist", "DELETE FROM wishlist_items WHERE user_id = $1")
	})
	t.Run("a failure is wrapped", func(t *testing.T) {
		db := newFakeSQL().on("DeleteUserWishlist", failWith(errBoom))

		err := closer(context.Background(), sqlc.New(db.open(t)), user)

		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "delete wishlist: boom")
	})
}
