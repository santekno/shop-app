package cart

import (
	"context"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// Bab 6 artikel 07: a guest cart's lock is an UPDATE of updated_at, not a
// SELECT … FOR UPDATE. The hourly cleanup deletes guest carts untouched
// for 30 days with SKIP LOCKED; PostgreSQL re-checks its WHERE only on a
// row that really changed while it waited, so a cart write must change the
// row, or the cleanup could delete a cart with a line just added to it.
func TestGuestCartLockTouchesTheRow(t *testing.T) {
	token, hash := guestTokenFor(1)
	db := sellable(emptyCart(newFakeSQL().on("LockGuestCart", rows(hash))), 5000, 10)
	_, err := newRepo(t, db).Add(context.Background(), Owner{Token: token}, v1, 1)
	testx.AssertNoError(t, err)
	assertLockedFirst(t, db, "LockGuestCart")
	assertSQL(t, db, "LockGuestCart", "UPDATE carts SET updated_at = now()",
		"WHERE id = $1 AND user_id IS NULL", "RETURNING token_hash")
	lock := db.sqlOf("LockGuestCart")
	testx.AssertFalse(t, strings.Contains(lock, "SELECT"), "a locking read does not change the row: %s", lock)
	testx.AssertFalse(t, strings.Contains(lock, "FOR UPDATE"), "a locking read does not change the row: %s", lock)
}

// The cleanup's own guards: only guest carts, untouched (cart and lines)
// since the cutoff, skipping a cart someone holds right now.
func TestDeleteAbandonedGuestCarts_SQL(t *testing.T) {
	db := newFakeSQL().on("DeleteAbandonedGuestCarts", fakeAnswer{affected: 0})
	_, err := newRepo(t, db).DeleteAbandonedGuestCarts(context.Background(), testTime)
	testx.AssertNoError(t, err)
	assertSQL(t, db, "DeleteAbandonedGuestCarts", "c.user_id IS NULL AND c.updated_at < $1",
		"NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id AND ci.updated_at >= $1)",
		"LIMIT $2", "FOR UPDATE SKIP LOCKED")
}
