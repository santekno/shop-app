package order

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

const orderID2 = "0190c8a0-0000-7000-8000-0000000000d2"

// closeAccount runs AccountCloser on db at testTime, as the deletion's
// transaction would.
func closeAccount(t *testing.T, db *fakeSQL) error {
	t.Helper()
	return AccountCloser(func() time.Time { return testTime })(context.Background(), sqlc.New(db.open(t)), buyerID)
}

// pendingDB is a database where the buyer has the unpaid orders ids.
func pendingDB(ids ...string) *fakeSQL {
	var out [][]driver.Value
	for _, id := range ids {
		out = append(out, []driver.Value{id})
	}
	return newFakeSQL().
		on("LockPendingOrdersOfUser", fakeAnswer{rows: out}).
		on("GetOrder", orderAnswer(orderID1, StatusCancelled, func(row []driver.Value) { row[colCancelReason] = CancelBuyerCancelled }))
}

func TestAccountCloser_NoPendingOrders(t *testing.T) {
	db := pendingDB()
	testx.AssertNoError(t, closeAccount(t, db))
	testx.AssertEqual(t, strings.Join(db.names(), ","), "LockPendingOrdersOfUser,DeleteUserCart,DeleteUserIdempotencyKeys",
		"no lock, restore or cancel without an unpaid order")
	for _, name := range []string{"LockPendingOrdersOfUser", "DeleteUserCart", "DeleteUserIdempotencyKeys"} {
		c, _ := db.call(name)
		assertArgs(t, c.args, []driver.Value{buyerID}, name)
	}
}

// The orders are locked first (id order), then all their variants and all
// their vouchers (each in id order), then the stock and the voucher uses go
// back in ONE statement each, so no row is written twice; then each order
// is cancelled and records its event.
func TestAccountCloser_CancelsEveryUnpaidOrder(t *testing.T) {
	db := pendingDB(orderID1, orderID2)
	testx.AssertNoError(t, closeAccount(t, db))
	perOrder := "CancelOrder,GetOrder,InsertOutboxEvent"
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"LockPendingOrdersOfUser,LockOrdersVariants,LockOrdersVouchers,RestoreOrdersStock,ReleaseOrdersVouchers,"+
			perOrder+","+perOrder+",DeleteUserCart,DeleteUserIdempotencyKeys")
	for _, name := range []string{"RestoreOrderStock", "ReleaseVoucher", "LockOrderVariants"} {
		testx.AssertFalse(t, db.ran(name), "%s: the per-order give-back would write a row twice", name)
	}

	both := []driver.Value{pqArray(orderID1, orderID2)}
	for _, name := range []string{"LockOrdersVariants", "LockOrdersVouchers", "RestoreOrdersStock", "ReleaseOrdersVouchers"} {
		testx.AssertEqual(t, len(db.calledAll(name)), 1, "%s runs once for all the orders", name)
		c, _ := db.call(name)
		assertArgs(t, c.args, both, name)
	}
	assertSQL(t, db, "LockPendingOrdersOfUser", "status = 'pending_payment' ORDER BY id FOR UPDATE")
	assertSQL(t, db, "LockOrdersVariants", "ORDER BY v.id FOR NO KEY UPDATE OF v")
	assertSQL(t, db, "LockOrdersVouchers", "ORDER BY vo.id FOR NO KEY UPDATE OF vo")
	assertSQL(t, db, "RestoreOrdersStock", "sum(oi.quantity)", "GROUP BY oi.variant_id", "version = v.version + 1")
	assertSQL(t, db, "ReleaseOrdersVouchers", "count(*)", "GROUP BY o.voucher_id", "GREATEST(vo.used_count - s.uses, 0)")

	cancels := db.calledAll("CancelOrder")
	testx.AssertEqual(t, len(cancels), 2)
	assertArgs(t, cancels[0].args, []driver.Value{"buyer_cancelled", testTime, orderID1, pqArray("pending_payment"), buyerID},
		"only an unpaid order of this buyer")
	testx.AssertEqual(t, cancels[1].args[2], driver.Value(orderID2))

	events := db.calledAll("InsertOutboxEvent")
	testx.AssertEqual(t, len(events), 2, "one order.cancelled per order")
	testx.AssertEqual(t, events[0].args[3], driver.Value("order.cancelled"))
	var payload map[string]any
	testx.AssertNoError(t, json.Unmarshal(events[0].args[4].([]byte), &payload))
	testx.AssertEqual(t, payload["cancel_reason"], any("buyer_cancelled"))
}

// The stock is already back when a cancel changes nothing, so the deletion
// fails (and rolls back) rather than commit half a cancel.
func TestAccountCloser_RefusesACancelThatChangedNothing(t *testing.T) {
	db := pendingDB(orderID1, orderID2).on("CancelOrder", fakeAnswer{affected: 1}).on("CancelOrder", fakeAnswer{affected: 0})
	err := closeAccount(t, db)
	testx.AssertError(t, err)
	testx.AssertEqual(t, err.Error(), "cancel order "+orderID2+": no longer unpaid")
	testx.AssertFalse(t, db.ran("DeleteUserCart"))
	testx.AssertEqual(t, len(db.calledAll("InsertOutboxEvent")), 1)
}

func TestAccountCloser_Errors(t *testing.T) {
	tests := []struct {
		query string
		msg   string
	}{
		{"LockPendingOrdersOfUser", "lock unpaid orders: boom"},
		{"LockOrdersVariants", "lock unpaid orders' variants: boom"},
		{"LockOrdersVouchers", "lock unpaid orders' vouchers: boom"},
		{"RestoreOrdersStock", "restore stock: boom"},
		{"ReleaseOrdersVouchers", "release vouchers: boom"},
		{"CancelOrder", "cancel order " + orderID1 + ": boom"},
		{"GetOrder", "read cancelled order: boom"},
		{"InsertOutboxEvent", "record order.cancelled event: boom"},
		{"DeleteUserCart", "delete cart: boom"},
		{"DeleteUserIdempotencyKeys", "delete idempotency keys: boom"},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			db := pendingDB(orderID1).only(tt.query, failWith(errBoom))
			err := closeAccount(t, db)
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertEqual(t, err.Error(), tt.msg)
			names := db.names()
			testx.AssertEqual(t, names[len(names)-1], tt.query, "nothing runs after the failure")
		})
	}
}
