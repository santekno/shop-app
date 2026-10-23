package order

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

func TestEventType(t *testing.T) {
	for status, want := range map[Status]string{
		StatusPendingPayment: "order.created",
		StatusPaid:           "order.paid",
		StatusProcessing:     "order.processing",
		StatusShipped:        "order.shipped",
		StatusCompleted:      "order.completed",
		StatusCancelled:      "order.cancelled",
	} {
		testx.AssertEqual(t, eventType(Order{Status: status}), want, "%s", status)
	}
}

func TestRecordEvent(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	o := Order{
		ID: orderID1, Code: "GS-20261023-ABC123", UserID: buyerID, Status: StatusPaid,
		Totals: Totals{Total: 117000}, UpdatedAt: time.Date(2026, 10, 23, 15, 30, 0, 0, wib),
	}
	db := newFakeSQL()
	testx.AssertNoError(t, recordEvent(context.Background(), sqlc.New(db.open(t)), o))
	c, _ := db.call("InsertOutboxEvent")
	testx.AssertTrue(t, uuidx.IsValidUUID(c.args[0].(string)), "each event has its own id, for at-least-once consumers")
	testx.AssertEqual(t, c.args[1], any("order"))
	testx.AssertEqual(t, c.args[2], any(orderID1))
	testx.AssertEqual(t, c.args[3], any("order.paid"))
	testx.AssertEqual(t, string(c.args[4].([]byte)),
		`{"order_id":"`+orderID1+`","code":"GS-20261023-ABC123","user_id":"`+buyerID+`","status":"paid","total":117000,"currency":"IDR","occurred_at":"2026-10-23T08:30:00Z"}`,
		"no cancel_reason unless cancelled; the time in UTC")

	reason := CancelPaymentExpired
	o.Status, o.CancelReason = StatusCancelled, &reason
	db = newFakeSQL()
	testx.AssertNoError(t, recordEvent(context.Background(), sqlc.New(db.open(t)), o))
	c, _ = db.call("InsertOutboxEvent")
	var payload map[string]any
	testx.AssertNoError(t, json.Unmarshal(c.args[4].([]byte), &payload))
	testx.AssertEqual(t, payload["cancel_reason"], any("payment_expired"))
	testx.AssertEqual(t, c.args[3], any("order.cancelled"))

	db = newFakeSQL().on("InsertOutboxEvent", failWith(errBoom))
	err := recordEvent(context.Background(), sqlc.New(db.open(t)), o)
	testx.AssertTrue(t, errors.Is(err, errBoom))
}
