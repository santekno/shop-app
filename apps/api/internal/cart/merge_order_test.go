package cart

import (
	"context"
	"database/sql/driver"
	"testing"

	"github.com/santekno/sdk/testx"
)

// A merge writes its lines in variant_id order, whatever the order of the
// carts: each new line takes its variant FOR KEY SHARE, and an admin save
// holds the same variants FOR UPDATE in id order (ADR 0006, "Lock order").
func TestPostgresRepository_MergeWritesInVariantOrder(t *testing.T) {
	token, hash := guestTokenFor(1)
	db := userCartDB().on("LockGuestCart", rows(hash)).
		on("ListCartLines", fakeAnswer{rows: [][]driver.Value{cartLineRow(v2, 1, 20000, 20000, 10, true)}}). // user
		on("ListCartLines", fakeAnswer{rows: [][]driver.Value{                                               // guest, oldest first: not in id order
			cartLineRow(v3, 1, 30000, 30000, 5, true),
			cartLineRow(v1, 2, 10000, 10000, 5, true),
			cartLineRow(v2, 1, 20000, 20000, 10, true),
		}})
	testx.AssertNoError(t, newRepo(t, db).Merge(context.Background(), userID, token))
	writes := db.calledAll("UpsertCartItem")
	testx.AssertEqual(t, len(writes), 3)
	for i, want := range []string{v1, v2, v3} {
		testx.AssertEqual(t, writes[i].args[1], driver.Value(want), "write %d", i)
	}
	assertArgs(t, writes[0].args, []driver.Value{userCartID, v1, int64(2), int64(10000)})
	assertArgs(t, writes[1].args, []driver.Value{userCartID, v2, int64(2), int64(20000)}, "the shared line keeps the user's price")
}
