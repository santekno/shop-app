package cart

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql/driver"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

const userCartID = "0190c8a0-0000-7000-8000-0000000000b1"

// cartLineRow is a ListCartLines row in its column order.
func cartLineRow(variantID string, quantity, added, price, stock int64, sellable bool) []driver.Value {
	return []driver.Value{
		variantID, quantity, added, testTime, "SKU-1", "M", price, stock, int64(200), sellable,
		"0190c8a0-0000-7000-8000-0000000000p1", "kaos", "Kaos",
	}
}

// userCartDB is a database where the user's cart exists (for both the
// locking upsert and the plain read).
func userCartDB() *fakeSQL {
	return emptyCart(newFakeSQL().on("UpsertUserCart", rows(userCartID)).on("GetUserCartID", rows(userCartID)))
}

// emptyCart answers CountCartItems with 0 lines (queued after any count a
// test sets first).
func emptyCart(db *fakeSQL) *fakeSQL { return db.on("CountCartItems", rows(int64(0))) }

// sellable answers GetSellableVariant with price and stock.
func sellable(db *fakeSQL, price, stock int64) *fakeSQL {
	return db.on("GetSellableVariant", rows(v1, price, stock))
}

// guestToken is a token for guestCartID with secret(1), and the hash the
// row stores for it.
func guestTokenFor(b byte) (string, []byte) {
	sum := sha256.Sum256(secret(b))
	return guestCartID + "." + base64.RawURLEncoding.EncodeToString(secret(b)), sum[:]
}

func newRepo(t *testing.T, db *fakeSQL) *PostgresRepository {
	t.Helper()
	return NewPostgresRepository(db.open(t))
}

func TestPostgresRepository_Get(t *testing.T) {
	t.Run("a user's cart with its lines", func(t *testing.T) {
		db := userCartDB().on("ListCartLines", fakeAnswer{rows: [][]driver.Value{
			cartLineRow(v1, 2, 50000, 55000, 7, true),
			cartLineRow(v2, 1, 10000, 10000, 0, false),
		}})
		c, err := newRepo(t, db).Get(context.Background(), Owner{UserID: userID})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(db.names(), ","), "GetUserCartID,ListCartLines", "a read locks nothing and creates nothing")
		call, _ := db.call("GetUserCartID")
		testx.AssertEqual(t, call.args[0], driver.Value(userID))
		call, _ = db.call("ListCartLines")
		testx.AssertEqual(t, call.args[0], driver.Value(userCartID))
		testx.AssertEqual(t, len(c.Lines), 2)
		l := c.Lines[0]
		testx.AssertEqual(t, l.VariantID, v1)
		testx.AssertEqual(t, l.Quantity, int32(2))
		testx.AssertEqual(t, l.AddedPrice, int64(50000))
		testx.AssertEqual(t, l.Price, int64(55000))
		testx.AssertEqual(t, l.Stock, int32(7))
		testx.AssertEqual(t, l.WeightGrams, int32(200))
		testx.AssertEqual(t, l.SKU, "SKU-1")
		testx.AssertEqual(t, l.VariantName, "M")
		testx.AssertEqual(t, l.ProductSlug, "kaos")
		testx.AssertEqual(t, l.ProductName, "Kaos")
		testx.AssertTrue(t, l.CreatedAt.Equal(testTime))
		testx.AssertTrue(t, l.Sellable)
		testx.AssertFalse(t, c.Lines[1].Sellable)
	})
	t.Run("a user without a cart has an empty one", func(t *testing.T) {
		db := newFakeSQL()
		c, err := newRepo(t, db).Get(context.Background(), Owner{UserID: userID})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(c.Lines), 0)
		testx.AssertEqual(t, strings.Join(db.names(), ","), "GetUserCartID")
	})
	t.Run("a guest without a token has an empty cart, without a query", func(t *testing.T) {
		db := newFakeSQL()
		c, err := newRepo(t, db).Get(context.Background(), Owner{})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(c.Lines), 0)
		testx.AssertEqual(t, len(db.names()), 0)
	})
	t.Run("a guest's cart is read without a lock", func(t *testing.T) {
		token, hash := guestTokenFor(1)
		db := newFakeSQL().on("GetGuestCart", rows(hash))
		_, err := newRepo(t, db).Get(context.Background(), Owner{Token: token})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(db.names(), ","), "GetGuestCart,ListCartLines")
		call, _ := db.call("GetGuestCart")
		testx.AssertEqual(t, call.args[0], driver.Value(guestCartID))
	})
	errs := map[string]struct {
		db    *fakeSQL
		owner Owner
		want  string
	}{
		"user cart query": {db: newFakeSQL().on("GetUserCartID", failWith(errBoom)), owner: Owner{UserID: userID}, want: "query cart: boom"},
		"lines query":     {db: userCartDB().on("ListCartLines", failWith(errBoom)), owner: Owner{UserID: userID}, want: "query cart lines: boom"},
		"guest query":     {db: newFakeSQL().on("GetGuestCart", failWith(errBoom)), owner: Owner{Token: func() string { s, _ := guestTokenFor(1); return s }()}, want: "query guest cart: boom"},
	}
	for name, tt := range errs {
		t.Run(name+" fails", func(t *testing.T) {
			_, err := newRepo(t, tt.db).Get(context.Background(), tt.owner)
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertEqual(t, err.Error(), tt.want)
		})
	}
}

// A guest token that the API could not have issued, that names no guest
// cart, or whose secret does not match is CART_NOT_FOUND.
func TestPostgresRepository_BadGuestToken(t *testing.T) {
	token, hash := guestTokenFor(1)
	other, _ := guestTokenFor(2)
	tests := []struct {
		name  string
		db    *fakeSQL
		token string
		names string // statements run by Get
	}{
		{name: "malformed: no query", db: newFakeSQL(), token: "nope", names: ""},
		{name: "unknown cart", db: newFakeSQL(), token: token, names: "GetGuestCart"},
		{name: "wrong secret", db: newFakeSQL().on("GetGuestCart", rows(hash)), token: other, names: "GetGuestCart"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newRepo(t, tt.db)
			_, err := r.Get(context.Background(), Owner{Token: tt.token})
			testx.AssertTrue(t, errors.Is(err, ErrCartNotFound), "Get: %v", err)
			testx.AssertEqual(t, strings.Join(tt.db.names(), ","), tt.names)

			_, err = r.Add(context.Background(), Owner{Token: tt.token}, v1, 1)
			testx.AssertTrue(t, errors.Is(err, ErrCartNotFound), "Add: %v", err)
			testx.AssertFalse(t, tt.db.ran("InsertGuestCart"), "a bad token never gets a new cart")
			testx.AssertFalse(t, tt.db.ran("UpsertCartItem"))
			testx.AssertTrue(t, tt.db.ran("ROLLBACK"))

			testx.AssertTrue(t, errors.Is(r.SetQuantity(context.Background(), Owner{Token: tt.token}, v1, 1), ErrCartNotFound))
			testx.AssertTrue(t, errors.Is(r.Remove(context.Background(), Owner{Token: tt.token}, v1), ErrCartNotFound))
			testx.AssertFalse(t, tt.db.ran("DeleteCartItem"))
		})
	}
}

func TestPostgresRepository_Add(t *testing.T) {
	t.Run("a new line in a user's cart, at the current price", func(t *testing.T) {
		db := sellable(newFakeSQL().on("UpsertUserCart", rows(userCartID)).on("CountCartItems", rows(int64(3))), 89000, 10)
		token, err := newRepo(t, db).Add(context.Background(), Owner{UserID: userID}, v1, 2)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, token, "", "a user's cart has no token")
		assertLockedFirst(t, db, "UpsertUserCart")
		testx.AssertEqual(t, strings.Join(db.names(), ","),
			"BEGIN,UpsertUserCart,GetCartItemQuantity,CountCartItems,GetSellableVariant,UpsertCartItem,COMMIT")
		upsert, _ := db.call("UpsertUserCart")
		testx.AssertEqual(t, upsert.args[1], driver.Value(userID))
		write, _ := db.call("UpsertCartItem")
		assertArgs(t, write.args, []driver.Value{userCartID, v1, int64(2), int64(89000)})
	})
	t.Run("an existing line gets the sum, without counting lines", func(t *testing.T) {
		db := sellable(userCartDB().on("GetCartItemQuantity", rows(int64(3))), 89000, 10)
		_, err := newRepo(t, db).Add(context.Background(), Owner{UserID: userID}, v1, 4)
		testx.AssertNoError(t, err)
		testx.AssertFalse(t, db.ran("CountCartItems"), "adding to a line needs no free line")
		write, _ := db.call("UpsertCartItem")
		testx.AssertEqual(t, write.args[2], driver.Value(int64(7)))
	})
	t.Run("an existing line in a full cart still grows", func(t *testing.T) {
		db := sellable(newFakeSQL().on("UpsertUserCart", rows(userCartID)).on("GetCartItemQuantity", rows(int64(1))).on("CountCartItems", rows(int64(MaxLines))), 1000, 10)
		_, err := newRepo(t, db).Add(context.Background(), Owner{UserID: userID}, v1, 1)
		testx.AssertNoError(t, err)
	})
	t.Run("49 lines leave room for one more", func(t *testing.T) {
		db := sellable(newFakeSQL().on("UpsertUserCart", rows(userCartID)).on("CountCartItems", rows(int64(MaxLines-1))), 1000, 10)
		_, err := newRepo(t, db).Add(context.Background(), Owner{UserID: userID}, v1, 1)
		testx.AssertNoError(t, err)
	})
	t.Run("a guest's first add creates a guest cart and returns its token", func(t *testing.T) {
		db := sellable(emptyCart(newFakeSQL()), 5000, 10)
		r := newRepo(t, db)
		r.random = bytes.NewReader(secret(9))
		token, err := r.Add(context.Background(), Owner{}, v1, 1)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(db.names(), ","),
			"BEGIN,InsertGuestCart,GetCartItemQuantity,CountCartItems,GetSellableVariant,UpsertCartItem,COMMIT")
		insert, _ := db.call("InsertGuestCart")
		id, encoded, ok := strings.Cut(token, ".")
		testx.AssertTrue(t, ok)
		testx.AssertEqual(t, insert.args[0], driver.Value(id), "the token names the new row")
		testx.AssertEqual(t, encoded, base64.RawURLEncoding.EncodeToString(secret(9)))
		sum := sha256.Sum256(secret(9))
		testx.AssertTrue(t, bytes.Equal(insert.args[1].([]byte), sum[:]), "the row stores the hash of the secret")
		write, _ := db.call("UpsertCartItem")
		testx.AssertEqual(t, write.args[0], driver.Value(id))
	})
	t.Run("a guest with a token adds under the cart's lock", func(t *testing.T) {
		token, hash := guestTokenFor(1)
		db := sellable(emptyCart(newFakeSQL().on("LockGuestCart", rows(hash))), 5000, 10)
		got, err := newRepo(t, db).Add(context.Background(), Owner{Token: token}, v1, 1)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, got, "", "an existing cart's token is never sent again")
		assertLockedFirst(t, db, "LockGuestCart")
		testx.AssertFalse(t, db.ran("GetGuestCart"))
	})
	refusals := []struct {
		name  string
		db    *fakeSQL
		qty   int32
		check func(t *testing.T, err error)
	}{
		{name: "cart full", db: newFakeSQL().on("UpsertUserCart", rows(userCartID)).on("CountCartItems", rows(int64(MaxLines))), qty: 1,
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrCartFull), "err = %v", err) }},
		{name: "variant not sellable", db: userCartDB(), qty: 1,
			check: func(t *testing.T, err error) {
				testx.AssertTrue(t, errors.Is(err, ErrVariantUnavailable), "err = %v", err)
			}},
		{name: "sum over 99", db: sellable(userCartDB().on("GetCartItemQuantity", rows(int64(95))), 1000, 500), qty: 5,
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrQuantityLimit), "err = %v", err) }},
		{name: "more than the stock", db: sellable(userCartDB().on("GetCartItemQuantity", rows(int64(2))), 1000, 3), qty: 2,
			check: func(t *testing.T, err error) {
				var stock *InsufficientStockError
				testx.AssertTrue(t, errors.As(err, &stock), "err = %v", err)
				testx.AssertEqual(t, stock.Available, int32(3))
			}},
		{name: "count fails", db: newFakeSQL().on("UpsertUserCart", rows(userCartID)).on("CountCartItems", failWith(errBoom)), qty: 1,
			check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "count cart lines: boom") }},
		{name: "line query fails", db: userCartDB().on("GetCartItemQuantity", failWith(errBoom)), qty: 1,
			check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "query cart line: boom") }},
		{name: "variant query fails", db: userCartDB().on("GetSellableVariant", failWith(errBoom)), qty: 1,
			check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "query variant: boom") }},
		{name: "cart lock fails", db: newFakeSQL().on("UpsertUserCart", failWith(errBoom)), qty: 1,
			check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "lock cart: boom") }},
	}
	for _, tt := range refusals {
		t.Run(tt.name, func(t *testing.T) {
			_, err := newRepo(t, tt.db).Add(context.Background(), Owner{UserID: userID}, v1, tt.qty)
			tt.check(t, err)
			testx.AssertFalse(t, tt.db.ran("UpsertCartItem"), "nothing is written")
			testx.AssertTrue(t, tt.db.ran("ROLLBACK"))
			testx.AssertFalse(t, tt.db.ran("COMMIT"))
		})
	}
	t.Run("the line write fails", func(t *testing.T) {
		db := sellable(userCartDB(), 1000, 10).on("UpsertCartItem", failWith(errBoom))
		_, err := newRepo(t, db).Add(context.Background(), Owner{UserID: userID}, v1, 1)
		testx.AssertEqual(t, err.Error(), "write cart line: boom")
	})
	t.Run("a guest cart cannot be inserted", func(t *testing.T) {
		db := newFakeSQL().on("InsertGuestCart", failWith(errBoom))
		r := newRepo(t, db)
		r.random = bytes.NewReader(secret(1))
		token, err := r.Add(context.Background(), Owner{}, v1, 1)
		testx.AssertEqual(t, err.Error(), "insert guest cart: boom")
		testx.AssertEqual(t, token, "", "no token for a cart that was rolled back")
	})
	t.Run("random fails", func(t *testing.T) {
		db := newFakeSQL()
		r := newRepo(t, db)
		r.random = failingReader{}
		_, err := r.Add(context.Background(), Owner{}, v1, 1)
		testx.AssertEqual(t, err.Error(), "read random cart token: boom")
		testx.AssertFalse(t, db.ran("InsertGuestCart"))
	})
}

func TestPostgresRepository_SetQuantity(t *testing.T) {
	t.Run("replaces the quantity and takes today's price", func(t *testing.T) {
		db := sellable(userCartDB().on("GetCartItemQuantity", rows(int64(5))), 61000, 10)
		err := newRepo(t, db).SetQuantity(context.Background(), Owner{UserID: userID}, v1, 2)
		testx.AssertNoError(t, err)
		assertLockedFirst(t, db, "UpsertUserCart")
		testx.AssertFalse(t, db.ran("CountCartItems"))
		write, _ := db.call("UpsertCartItem")
		assertArgs(t, write.args, []driver.Value{userCartID, v1, int64(2), int64(61000)}, "not the sum")
	})
	t.Run("a line that is not in the cart", func(t *testing.T) {
		db := userCartDB()
		err := newRepo(t, db).SetQuantity(context.Background(), Owner{UserID: userID}, v1, 2)
		testx.AssertTrue(t, errors.Is(err, ErrLineNotFound), "err = %v", err)
		testx.AssertFalse(t, db.ran("UpsertCartItem"))
	})
	t.Run("a guest without a cart has no line", func(t *testing.T) {
		db := newFakeSQL()
		err := newRepo(t, db).SetQuantity(context.Background(), Owner{}, v1, 2)
		testx.AssertTrue(t, errors.Is(err, ErrLineNotFound), "err = %v", err)
		testx.AssertFalse(t, db.ran("InsertGuestCart"), "a PATCH never creates a cart")
	})
	t.Run("more than the stock", func(t *testing.T) {
		db := sellable(userCartDB().on("GetCartItemQuantity", rows(int64(1))), 1000, 4)
		err := newRepo(t, db).SetQuantity(context.Background(), Owner{UserID: userID}, v1, 5)
		var stock *InsufficientStockError
		testx.AssertTrue(t, errors.As(err, &stock), "err = %v", err)
		testx.AssertEqual(t, stock.Available, int32(4))
	})
	t.Run("the line query fails", func(t *testing.T) {
		db := userCartDB().on("GetCartItemQuantity", failWith(errBoom))
		err := newRepo(t, db).SetQuantity(context.Background(), Owner{UserID: userID}, v1, 5)
		testx.AssertEqual(t, err.Error(), "query cart line: boom")
	})
}

func TestPostgresRepository_Remove(t *testing.T) {
	db := userCartDB()
	err := newRepo(t, db).Remove(context.Background(), Owner{UserID: userID}, v1)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, strings.Join(db.names(), ","), "GetUserCartID,DeleteCartItem")
	del, _ := db.call("DeleteCartItem")
	assertArgs(t, del.args, []driver.Value{userCartID, v1})

	tests := map[string]struct {
		db   *fakeSQL
		want error
		msg  string
	}{
		"no such line":         {db: userCartDB().on("DeleteCartItem", fakeAnswer{affected: 0}), want: ErrLineNotFound},
		"a user without cart":  {db: newFakeSQL(), want: ErrLineNotFound},
		"the delete fails":     {db: userCartDB().on("DeleteCartItem", failWith(errBoom)), want: errBoom, msg: "delete cart line: boom"},
		"the cart query fails": {db: newFakeSQL().on("GetUserCartID", failWith(errBoom)), want: errBoom, msg: "query cart: boom"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			err := newRepo(t, tt.db).Remove(context.Background(), Owner{UserID: userID}, v1)
			testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v", err)
			if tt.msg != "" {
				testx.AssertEqual(t, err.Error(), tt.msg)
			}
		})
	}
}

func TestPostgresRepository_Merge(t *testing.T) {
	token, hash := guestTokenFor(1)
	mergeDB := func() *fakeSQL {
		return userCartDB().on("LockGuestCart", rows(hash)).
			on("ListCartLines", fakeAnswer{rows: [][]driver.Value{cartLineRow(v1, 2, 50000, 50000, 10, true)}}). // user
			on("ListCartLines", fakeAnswer{rows: [][]driver.Value{                                               // guest
				cartLineRow(v1, 3, 48000, 50000, 10, true),
				cartLineRow(v2, 1, 20000, 20000, 5, true),
				cartLineRow(v3, 1, 20000, 20000, 5, false),
			}})
	}

	db := mergeDB()
	err := newRepo(t, db).Merge(context.Background(), userID, token)
	testx.AssertNoError(t, err)
	// The user's cart is locked first, the guest's second (one lock order,
	// so two merges cannot deadlock).
	assertLockedFirst(t, db, "UpsertUserCart")
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,UpsertUserCart,LockGuestCart,ListCartLines,ListCartLines,UpsertCartItem,UpsertCartItem,DeleteCart,COMMIT")
	lists := db.calledAll("ListCartLines")
	testx.AssertEqual(t, lists[0].args[0], driver.Value(userCartID))
	testx.AssertEqual(t, lists[1].args[0], driver.Value(guestCartID))
	writes := db.calledAll("UpsertCartItem")
	assertArgs(t, writes[0].args, []driver.Value{userCartID, v1, int64(5), int64(50000)}, "the sum at the user's price")
	assertArgs(t, writes[1].args, []driver.Value{userCartID, v2, int64(1), int64(20000)}, "a new line at the guest's price")
	del, _ := db.call("DeleteCart")
	testx.AssertEqual(t, del.args[0], driver.Value(guestCartID), "the guest cart is gone, so the token merges once")

	refusals := map[string]struct {
		db    *fakeSQL
		token string
		want  error
		msg   string
	}{
		"guest cart gone (merged already)": {db: userCartDB(), token: token, want: ErrCartNotFound},
		"no token":                         {db: userCartDB(), token: "", want: ErrCartNotFound},
		"malformed token":                  {db: userCartDB(), token: "x.y", want: ErrCartNotFound},
		"user cart lock fails":             {db: newFakeSQL().on("UpsertUserCart", failWith(errBoom)), token: token, want: errBoom, msg: "lock cart: boom"},
		"guest lines fail": {db: userCartDB().on("LockGuestCart", rows(hash)).on("ListCartLines", fakeAnswer{}).on("ListCartLines", failWith(errBoom)),
			token: token, want: errBoom, msg: "query cart lines: boom"},
		"user lines fail": {db: userCartDB().on("LockGuestCart", rows(hash)).on("ListCartLines", failWith(errBoom)),
			token: token, want: errBoom, msg: "query cart lines: boom"},
		"a merged line cannot be written":  {db: mergeDB().on("UpsertCartItem", failWith(errBoom)), token: token, want: errBoom, msg: "write merged line: boom"},
		"the guest cart cannot be deleted": {db: mergeDB().on("DeleteCart", failWith(errBoom)), token: token, want: errBoom, msg: "delete guest cart: boom"},
	}
	for name, tt := range refusals {
		t.Run(name, func(t *testing.T) {
			err := newRepo(t, tt.db).Merge(context.Background(), userID, tt.token)
			testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v", err)
			if tt.msg != "" {
				testx.AssertEqual(t, err.Error(), tt.msg)
			}
			testx.AssertTrue(t, tt.db.ran("ROLLBACK"))
			testx.AssertFalse(t, tt.db.ran("COMMIT"))
		})
	}
}

// A user's cart is created and locked only for an account that exists: a
// cart write that meets an account deletion finds the account gone instead
// of giving it a cart again.
func TestPostgresRepository_AccountGone(t *testing.T) {
	ctx := context.Background()
	owner := Owner{UserID: userID}
	gone := func() *fakeSQL { return newFakeSQL() } // UpsertUserCart returns no row
	tests := map[string]func(r *PostgresRepository) error{
		"add": func(r *PostgresRepository) error {
			_, err := r.Add(ctx, owner, v1, 1)
			return err
		},
		"set quantity": func(r *PostgresRepository) error { return r.SetQuantity(ctx, owner, v1, 1) },
		"merge":        func(r *PostgresRepository) error { return r.Merge(ctx, userID, "x.y") },
	}
	for name, call := range tests {
		t.Run(name, func(t *testing.T) {
			db := gone()
			err := call(newRepo(t, db))
			testx.AssertTrue(t, errors.Is(err, ErrAccountGone), "err = %v", err)
			testx.AssertTrue(t, db.ran("ROLLBACK"))
			testx.AssertFalse(t, db.ran("UpsertCartItem"))
			testx.AssertFalse(t, db.ran("InsertGuestCart"), "a deleted user never becomes a guest")
		})
	}
	t.Run("the guard is in the SQL", func(t *testing.T) {
		db := sellable(userCartDB(), 1000, 5)
		_, err := newRepo(t, db).Add(ctx, owner, v1, 1)
		testx.AssertNoError(t, err)
		upsert, _ := db.call("UpsertUserCart")
		testx.AssertEqual(t, upsert.args[1], driver.Value(userID))
		assertSQL(t, db, "UpsertUserCart", "WHERE u.id = $2 AND u.anonymized_at IS NULL FOR KEY SHARE")
	})
	t.Run("a plain read of a deleted user's cart is empty, not an error", func(t *testing.T) {
		c, err := newRepo(t, newFakeSQL()).Get(ctx, owner)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(c.Lines), 0)
	})
}
