package order

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/adminevents"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
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

// The admin feed (adminevents) reads this package's event payload by its
// JSON names. A real event, as recordEvent writes it, must decode there
// with every field the feed copies: renaming a field of eventPayload
// fails here, not on the dashboard.
func TestRecordEvent_ReadByTheAdminFeed(t *testing.T) {
	o := Order{
		ID: orderID1, Code: "GS-20261023-ABC123", UserID: buyerID, Status: StatusProcessing,
		Totals: Totals{Total: 117000}, UpdatedAt: time.Date(2026, 10, 23, 8, 30, 0, 0, time.UTC),
	}
	db := newFakeSQL()
	testx.AssertNoError(t, recordEvent(context.Background(), sqlc.New(db.open(t)), o))
	c, _ := db.call("InsertOutboxEvent")

	msg, ok, err := adminevents.FromEvent(outbox.Event{
		ID: c.args[0].(string), AggregateType: c.args[1].(string), AggregateID: c.args[2].(string),
		Type: c.args[3].(string), Payload: c.args[4].([]byte),
	})

	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, msg.ID, c.args[0].(string))
	testx.AssertEqual(t, string(msg.Data),
		`{"type":"order.processing","order_id":"`+orderID1+`","code":"GS-20261023-ABC123","status":"processing",`+
			`"total":{"amount":117000,"currency":"IDR"},"occurred_at":"2026-10-23T08:30:00Z"}`)
}
