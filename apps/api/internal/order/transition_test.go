package order

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

func transition(t *testing.T, db *fakeSQL, c Change) error {
	t.Helper()
	return NewPostgresRepository(db.open(t)).Transition(context.Background(), c)
}

// changedDB is a database where the order reads back in status after the
// change.
func changedDB(status Status) *fakeSQL {
	return newFakeSQL().on("GetOrder", orderAnswer(orderID1, status, nil))
}

// Each move is one conditional UPDATE whose from-statuses come from the
// transition table, so the SQL refuses what the table refuses, even under
// a race.
func TestPostgresRepository_TransitionStatements(t *testing.T) {
	buyer := buyerID
	tests := []struct {
		name  string
		c     Change
		query string
		args  []driver.Value
	}{
		{name: "paid", c: Change{OrderID: orderID1, To: StatusPaid, Now: testTime},
			query: "MarkOrderPaid", args: []driver.Value{testTime, orderID1, pqArray("pending_payment")}},
		{name: "processing", c: Change{OrderID: orderID1, To: StatusProcessing, Now: testTime},
			query: "StartProcessingOrder", args: []driver.Value{testTime, orderID1, pqArray("paid")}},
		{name: "shipped", c: Change{OrderID: orderID1, To: StatusShipped, Now: testTime, TrackingNumber: "JNE123456"},
			query: "ShipOrder", args: []driver.Value{"JNE123456", testTime, orderID1, pqArray("processing")}},
		{name: "completed by staff", c: Change{OrderID: orderID1, To: StatusCompleted, Now: testTime},
			query: "CompleteOrder", args: []driver.Value{testTime, orderID1, pqArray("shipped"), nil}},
		{name: "completed by the buyer", c: Change{OrderID: orderID1, To: StatusCompleted, Now: testTime, BuyerID: buyer},
			query: "CompleteOrder", args: []driver.Value{testTime, orderID1, pqArray("shipped"), buyer}},
		{name: "cancelled by the seller: before shipping", c: Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelSellerCancelled},
			query: "CancelOrder", args: []driver.Value{"seller_cancelled", testTime, orderID1, pqArray("pending_payment", "paid", "processing"), nil}},
		{name: "cancelled by the buyer: only unpaid", c: Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelBuyerCancelled, BuyerID: buyer},
			query: "CancelOrder", args: []driver.Value{"buyer_cancelled", testTime, orderID1, pqArray("pending_payment"), buyer}},
		{name: "expired", c: Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelPaymentExpired},
			query: "ExpireOrder", args: []driver.Value{testTime, orderID1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := changedDB(tt.c.To)
			testx.AssertNoError(t, transition(t, db, tt.c))
			assertLockedFirst(t, db, tt.query)
			call, _ := db.call(tt.query)
			assertArgs(t, call.args, tt.args)
			// updated_at comes from the API's clock (the @now argument),
			// like the status's own time, never the database's now().
			testx.AssertFalse(t, strings.Contains(db.sqlOf(tt.query), "now()"), "%s: %s", tt.query, db.sqlOf(tt.query))
			testx.AssertContains(t, db.sqlOf(tt.query), "updated_at = $")
			testx.AssertTrue(t, db.ran("COMMIT"))
			cancels := tt.c.To == StatusCancelled
			for _, name := range []string{"LockOrderVariants", "RestoreOrderStock", "ReleaseVoucher", "CancelOpenPaymentsOfOrders"} {
				testx.AssertEqual(t, db.ran(name), cancels, "%s runs only for a cancel", name)
			}
			ev, _ := db.call("InsertOutboxEvent")
			testx.AssertEqual(t, ev.args[3], driver.Value("order."+string(tt.c.To)), "the event of the change, in its transaction")
		})
	}
}

// A cancel gives the stock and the voucher use back in the same
// transaction, after the guarded UPDATE: order row, then the variants in
// id order, then the voucher.
func TestPostgresRepository_CancelGivesBack(t *testing.T) {
	reason := CancelBuyerCancelled
	db := newFakeSQL().
		on("LockOrderVariants", fakeAnswer{rows: [][]driver.Value{{v1}, {v3}}}).
		on("GetOrder", orderAnswer(orderID1, StatusCancelled, func(row []driver.Value) { row[colCancelReason] = reason }))
	err := transition(t, db, Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: reason, BuyerID: buyerID})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,CancelOrder,LockOrderVariants,RestoreOrderStock,ReleaseVoucher,CancelOpenPaymentsOfOrders,GetOrder,InsertOutboxEvent,COMMIT")
	assertSQL(t, db, "CancelOrder", "WHERE id = $3 AND status = ANY($4::text[])")
	// Bab 6 (ADR 0007): the order's open payment closes in the same
	// transaction, after the order row, so its Snap page takes no money.
	closed, _ := db.call("CancelOpenPaymentsOfOrders")
	assertArgs(t, closed.args, []driver.Value{testTime, pqArray(orderID1)}, "CancelOpenPaymentsOfOrders")
	assertSQL(t, db, "CancelOpenPaymentsOfOrders", "UPDATE payments SET status = 'cancelled'",
		"WHERE order_id = ANY($2::uuid[]) AND status IN ('pending', 'challenge')")
	assertSQL(t, db, "LockOrderVariants", "ORDER BY v.id FOR NO KEY UPDATE OF v")
	for _, name := range []string{"LockOrderVariants", "RestoreOrderStock", "ReleaseVoucher"} {
		c, _ := db.call(name)
		assertArgs(t, c.args, []driver.Value{orderID1}, name)
	}
	ev, _ := db.call("InsertOutboxEvent")
	var payload map[string]any
	testx.AssertNoError(t, json.Unmarshal(ev.args[4].([]byte), &payload))
	testx.AssertEqual(t, payload["status"], any("cancelled"))
	testx.AssertEqual(t, payload["cancel_reason"], any("buyer_cancelled"))
}

// Zero rows changed: the order is not there (for this buyer), or another
// request moved it first. Nothing is given back twice, and no event is
// recorded.
func TestPostgresRepository_TransitionUnchanged(t *testing.T) {
	t.Run("already moved", func(t *testing.T) {
		db := newFakeSQL().on("CancelOrder", fakeAnswer{affected: 0}).on("GetOrderStatus", rows("shipped"))
		err := transition(t, db, Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelSellerCancelled})
		var te *TransitionError
		if !errors.As(err, &te) {
			t.Fatalf("want *TransitionError, got %v", err)
		}
		testx.AssertEqual(t, *te, TransitionError{Current: StatusShipped, To: StatusCancelled})
		testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,CancelOrder,GetOrderStatus,ROLLBACK")
		status, _ := db.call("GetOrderStatus")
		assertArgs(t, status.args, []driver.Value{orderID1, nil})
	})
	t.Run("a retried cancel restores nothing", func(t *testing.T) {
		db := newFakeSQL().on("CancelOrder", fakeAnswer{affected: 0}).on("GetOrderStatus", rows("cancelled"))
		err := transition(t, db, Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelBuyerCancelled, BuyerID: buyerID})
		var te *TransitionError
		testx.AssertTrue(t, errors.As(err, &te))
		testx.AssertEqual(t, te.Current, StatusCancelled)
		testx.AssertFalse(t, db.ran("RestoreOrderStock"))
		testx.AssertFalse(t, db.ran("ReleaseVoucher"))
		testx.AssertFalse(t, db.ran("InsertOutboxEvent"))
		status, _ := db.call("GetOrderStatus")
		assertArgs(t, status.args, []driver.Value{orderID1, buyerID}, "scoped like the UPDATE")
	})
	t.Run("an expiry racing a payment", func(t *testing.T) {
		db := newFakeSQL().on("ExpireOrder", fakeAnswer{affected: 0}).on("GetOrderStatus", rows("paid"))
		err := transition(t, db, Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelPaymentExpired})
		var te *TransitionError
		testx.AssertTrue(t, errors.As(err, &te))
		testx.AssertEqual(t, te.Current, StatusPaid)
		testx.AssertFalse(t, db.ran("RestoreOrderStock"))
	})
	t.Run("not found (or another buyer's)", func(t *testing.T) {
		db := newFakeSQL().on("CompleteOrder", fakeAnswer{affected: 0})
		err := transition(t, db, Change{OrderID: orderID1, To: StatusCompleted, Now: testTime, BuyerID: buyerID})
		testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
		testx.AssertTrue(t, db.ran("ROLLBACK"))
	})
	t.Run("a status the machine has no move to", func(t *testing.T) {
		db := newFakeSQL()
		err := transition(t, db, Change{OrderID: orderID1, To: StatusPendingPayment, Now: testTime})
		testx.AssertError(t, err)
		testx.AssertEqual(t, err.Error(), `order status change to "pending_payment" is not supported`)
		testx.AssertTrue(t, db.ran("ROLLBACK"))
	})
}

func TestPostgresRepository_TransitionErrors(t *testing.T) {
	cancel := Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelSellerCancelled}
	tests := []struct {
		query string
		db    *fakeSQL
		msg   string
	}{
		{query: "CancelOrder", db: newFakeSQL().on("CancelOrder", failWith(errBoom)), msg: "boom"},
		{query: "GetOrderStatus", db: newFakeSQL().on("CancelOrder", fakeAnswer{affected: 0}).on("GetOrderStatus", failWith(errBoom)), msg: "query order status: boom"},
		{query: "LockOrderVariants", db: changedDB(StatusCancelled).on("LockOrderVariants", failWith(errBoom)), msg: "lock order variants: boom"},
		{query: "RestoreOrderStock", db: changedDB(StatusCancelled).on("RestoreOrderStock", failWith(errBoom)), msg: "restore stock: boom"},
		{query: "ReleaseVoucher", db: changedDB(StatusCancelled).on("ReleaseVoucher", failWith(errBoom)), msg: "release voucher: boom"},
		{query: "CancelOpenPaymentsOfOrders", db: changedDB(StatusCancelled).on("CancelOpenPaymentsOfOrders", failWith(errBoom)), msg: "close open payments: boom"},
		{query: "GetOrder", db: newFakeSQL().on("GetOrder", failWith(errBoom)), msg: "read changed order: boom"},
		{query: "InsertOutboxEvent", db: changedDB(StatusCancelled).on("InsertOutboxEvent", failWith(errBoom)), msg: "record order.cancelled event: boom"},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			err := transition(t, tt.db, cancel)
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertEqual(t, err.Error(), tt.msg)
			testx.AssertTrue(t, tt.db.ran("ROLLBACK"))
			testx.AssertFalse(t, tt.db.ran("COMMIT"))
		})
	}
}
