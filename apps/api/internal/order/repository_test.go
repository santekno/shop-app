package order

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func newOrderRepo(t *testing.T, db *fakeSQL) *PostgresRepository {
	t.Helper()
	return NewPostgresRepository(db.open(t))
}

func TestPostgresRepository_VoucherByCode(t *testing.T) {
	v := hemat10()
	db := newFakeSQL().on("GetVoucherByCode", voucherRow(v, int64(25000), int64(1000)))
	got, err := newOrderRepo(t, db).VoucherByCode(context.Background(), "HEMAT10")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got, v)
	call, _ := db.call("GetVoucherByCode")
	assertArgs(t, call.args, []driver.Value{"HEMAT10"})

	t.Run("NULL cap and limit are 0: none", func(t *testing.T) {
		db := newFakeSQL().on("GetVoucherByCode", voucherRow(v, nil, nil))
		got, err := newOrderRepo(t, db).VoucherByCode(context.Background(), "HEMAT10")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, got.MaxDiscount, int64(0))
		testx.AssertEqual(t, got.UsageLimit, int32(0))
	})
	t.Run("unknown code", func(t *testing.T) {
		_, err := newOrderRepo(t, newFakeSQL()).VoucherByCode(context.Background(), "NOPE")
		var ve *VoucherError
		testx.AssertTrue(t, errors.As(err, &ve), "err = %v", err)
		testx.AssertEqual(t, *ve, VoucherError{Code: "NOPE", Reason: VoucherNotFound})
	})
	t.Run("query fails", func(t *testing.T) {
		_, err := newOrderRepo(t, newFakeSQL().on("GetVoucherByCode", failWith(errBoom))).VoucherByCode(context.Background(), "X")
		testx.AssertEqual(t, err.Error(), "query voucher: boom")
	})
}

func TestPostgresRepository_VoucherUses(t *testing.T) {
	db := newFakeSQL().on("CountVoucherUses", rows(int64(2)))
	n, err := newOrderRepo(t, db).VoucherUses(context.Background(), voucherID, buyerID)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, n, int64(2))
	call, _ := db.call("CountVoucherUses")
	assertArgs(t, call.args, []driver.Value{voucherID, buyerID})

	_, err = newOrderRepo(t, newFakeSQL().on("CountVoucherUses", failWith(errBoom))).VoucherUses(context.Background(), voucherID, buyerID)
	testx.AssertEqual(t, err.Error(), "count voucher uses: boom")
}

func TestPostgresRepository_Get(t *testing.T) {
	paid := testTime.Add(30 * time.Minute)
	db := newFakeSQL().
		on("GetOrderForUser", orderAnswer(orderID1, StatusShipped, func(row []driver.Value) {
			row[colTracking], row[colPaidAt] = "JNE123456", paid
		})).
		on("ListOrderItems", fakeAnswer{rows: [][]driver.Value{itemRow("i1", v1, 60000, 2)}})
	o, err := newOrderRepo(t, db).Get(context.Background(), buyerID, orderID1)
	testx.AssertNoError(t, err)
	call, _ := db.call("GetOrderForUser")
	assertArgs(t, call.args, []driver.Value{orderID1, buyerID}, "scoped by the buyer")
	items, _ := db.call("ListOrderItems")
	assertArgs(t, items.args, []driver.Value{orderID1})

	testx.AssertEqual(t, o.ID, orderID1)
	testx.AssertEqual(t, o.Code, "GS-20261023-ABC123")
	testx.AssertEqual(t, o.UserID, buyerID)
	testx.AssertEqual(t, o.Status, StatusShipped)
	testx.AssertTrue(t, o.CancelReason == nil)
	testx.AssertEqual(t, o.Totals, Totals{Subtotal: 120000, Discount: 12000, ShippingFee: 9000, Total: 117000, WeightGrams: 500})
	testx.AssertEqual(t, *o.VoucherCode, "HEMAT10")
	testx.AssertEqual(t, *o.TrackingNumber, "JNE123456")
	testx.AssertEqual(t, o.Courier, "sicepat")
	testx.AssertEqual(t, o.CourierService, "REG")
	testx.AssertEqual(t, o.Address, ShippingAddress{Recipient: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1", City: "Bandung", Province: "Jawa Barat", PostalCode: "40111"})
	testx.AssertTrue(t, o.PaymentExpiresAt.Equal(testTime.Add(time.Hour)))
	testx.AssertTrue(t, o.PaidAt != nil && o.PaidAt.Equal(paid))
	testx.AssertTrue(t, o.ShippedAt == nil && o.CompletedAt == nil && o.CancelledAt == nil)
	testx.AssertTrue(t, o.CreatedAt.Equal(testTime) && o.UpdatedAt.Equal(testTime))
	testx.AssertEqual(t, len(o.Items), 1)
	testx.AssertEqual(t, o.Items[0], Item{ID: "i1", VariantID: v1, ProductName: "Kaos", VariantName: "M", SKU: "SKU-1", UnitPrice: 60000, Quantity: 2, LineTotal: 120000})

	t.Run("another user's order is not found", func(t *testing.T) {
		db := newFakeSQL()
		_, err := newOrderRepo(t, db).Get(context.Background(), buyerID, orderID1)
		testx.AssertTrue(t, errors.Is(err, ErrNotFound))
		testx.AssertFalse(t, db.ran("ListOrderItems"))
	})
	t.Run("errors", func(t *testing.T) {
		_, err := newOrderRepo(t, newFakeSQL().on("GetOrderForUser", failWith(errBoom))).Get(context.Background(), buyerID, orderID1)
		testx.AssertEqual(t, err.Error(), "query order: boom")
		db := newFakeSQL().on("GetOrderForUser", orderAnswer(orderID1, StatusPaid, nil)).on("ListOrderItems", failWith(errBoom))
		_, err = newOrderRepo(t, db).Get(context.Background(), buyerID, orderID1)
		testx.AssertEqual(t, err.Error(), "query order items: boom")
	})
}

func TestPostgresRepository_GetAny(t *testing.T) {
	reason := CancelSellerCancelled
	db := newFakeSQL().
		on("GetOrder", orderAnswer(orderID1, StatusCancelled, func(row []driver.Value) {
			row[colCancelReason], row[colCancelledAt] = reason, testTime
		}))
	o, err := newOrderRepo(t, db).GetAny(context.Background(), orderID1)
	testx.AssertNoError(t, err)
	call, _ := db.call("GetOrder")
	assertArgs(t, call.args, []driver.Value{orderID1}, "any buyer's order")
	testx.AssertEqual(t, *o.CancelReason, reason)
	testx.AssertTrue(t, o.CancelledAt.Equal(testTime))
	testx.AssertEqual(t, len(o.Items), 0)

	_, err = newOrderRepo(t, newFakeSQL()).GetAny(context.Background(), orderID1)
	testx.AssertTrue(t, errors.Is(err, ErrNotFound))
	_, err = newOrderRepo(t, newFakeSQL().on("GetOrder", failWith(errBoom))).GetAny(context.Background(), orderID1)
	testx.AssertEqual(t, err.Error(), "query order: boom")
	db = newFakeSQL().on("GetOrder", orderAnswer(orderID1, StatusPaid, nil)).on("ListOrderItems", failWith(errBoom))
	_, err = newOrderRepo(t, db).GetAny(context.Background(), orderID1)
	testx.AssertEqual(t, err.Error(), "query order items: boom")
}

func TestPostgresRepository_Lists(t *testing.T) {
	two := fakeAnswer{rows: [][]driver.Value{orderRowValues(orderID1, StatusPaid), orderRowValues(v1, StatusPaid)}}
	after := position{CreatedAt: testTime, ID: orderID1}

	db := newFakeSQL().on("ListOrdersByStatus", two)
	got, err := newOrderRepo(t, db).ListByStatus(context.Background(), StatusQuery{Status: StatusPaid, After: after, Limit: 21})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 2)
	testx.AssertEqual(t, got[1].ID, v1)
	testx.AssertEqual(t, len(got[0].Items), 0, "a list reads no items")
	testx.AssertFalse(t, db.ran("ListOrderItems"))
	call, _ := db.call("ListOrdersByStatus")
	assertArgs(t, call.args, []driver.Value{"paid", testTime, orderID1, int64(21)})

	db = newFakeSQL().on("ListOrdersForUser", two)
	got, err = newOrderRepo(t, db).ListForUser(context.Background(), HistoryQuery{UserID: buyerID, After: firstPage, Limit: 6})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 2)
	call, _ = db.call("ListOrdersForUser")
	assertArgs(t, call.args, []driver.Value{buyerID, firstPage.CreatedAt, firstPage.ID, int64(6)})

	_, err = newOrderRepo(t, newFakeSQL().on("ListOrdersByStatus", failWith(errBoom))).ListByStatus(context.Background(), StatusQuery{Limit: 1})
	testx.AssertEqual(t, err.Error(), "query orders: boom")
	_, err = newOrderRepo(t, newFakeSQL().on("ListOrdersForUser", failWith(errBoom))).ListForUser(context.Background(), HistoryQuery{Limit: 1})
	testx.AssertEqual(t, err.Error(), "query orders: boom")

	empty, err := newOrderRepo(t, newFakeSQL()).ListForUser(context.Background(), HistoryQuery{Limit: 1})
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, empty != nil && len(empty) == 0, "an empty page, not nil")
}

func TestPostgresRepository_ExpiredOrderIDs(t *testing.T) {
	db := newFakeSQL().on("ListExpiredOrderIDs", fakeAnswer{rows: [][]driver.Value{{orderID1}, {v1}}})
	ids, err := newOrderRepo(t, db).ExpiredOrderIDs(context.Background(), testTime, 100)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, strings.Join(ids, ","), orderID1+","+v1)
	call, _ := db.call("ListExpiredOrderIDs")
	assertArgs(t, call.args, []driver.Value{testTime, int64(100)})

	_, err = newOrderRepo(t, newFakeSQL().on("ListExpiredOrderIDs", failWith(errBoom))).ExpiredOrderIDs(context.Background(), testTime, 1)
	testx.AssertEqual(t, err.Error(), "query expired orders: boom")
}
