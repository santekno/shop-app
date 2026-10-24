package outbox

// Bab 6 artikel 11: the daily cleanup of published events and their
// delivery records, and the delivery records themselves.

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func affected(n int64) fakeAnswer { return fakeAnswer{affected: n} }

func TestCleanup(t *testing.T) {
	testx.AssertEqual(t, Retention, 7*24*time.Hour)
	before := testTime.Add(-7 * 24 * time.Hour)

	t.Run("events, then deliveries, each in batches until a short one", func(t *testing.T) {
		db := newFakeSQL().
			on("DeletePublishedEvents", affected(1000)).on("DeletePublishedEvents", affected(1000)).on("DeletePublishedEvents", affected(3)).
			on("DeleteOldDeliveries", affected(1000)).on("DeleteOldDeliveries", affected(7))
		n, err := Cleanup(t.Context(), db.open(t), testTime)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, int64(2003), "the events deleted")
		testx.AssertEqual(t, strings.Join(db.names(), ","),
			"DeletePublishedEvents,DeletePublishedEvents,DeletePublishedEvents,DeleteOldDeliveries,DeleteOldDeliveries")
		for _, c := range append(db.calledAll("DeletePublishedEvents"), db.calledAll("DeleteOldDeliveries")...) {
			assertArgs(t, c.args, []driver.Value{before, int64(1000)}, c.name)
			testx.AssertEqual(t, c.tx, 0, "no transaction: each batch commits on its own")
		}
	})
	t.Run("nothing to delete", func(t *testing.T) {
		db := newFakeSQL().on("DeletePublishedEvents", affected(0)).on("DeleteOldDeliveries", affected(0))
		n, err := Cleanup(t.Context(), db.open(t), testTime)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, int64(0))
		testx.AssertEqual(t, strings.Join(db.names(), ","), "DeletePublishedEvents,DeleteOldDeliveries")
	})
	t.Run("deleting events fails: the count so far", func(t *testing.T) {
		db := newFakeSQL().on("DeletePublishedEvents", affected(1000)).on("DeletePublishedEvents", failWith(errBoom))
		n, err := Cleanup(t.Context(), db.open(t), testTime)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "delete published events: boom")
		testx.AssertEqual(t, n, int64(1000))
		testx.AssertFalse(t, db.ran("DeleteOldDeliveries"))
	})
	t.Run("deleting deliveries fails: the events still count", func(t *testing.T) {
		db := newFakeSQL().on("DeletePublishedEvents", affected(5)).
			on("DeleteOldDeliveries", affected(1000)).on("DeleteOldDeliveries", failWith(errBoom))
		n, err := Cleanup(t.Context(), db.open(t), testTime)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "delete old deliveries: boom")
		testx.AssertEqual(t, n, int64(5))
		testx.AssertEqual(t, len(db.calledAll("DeleteOldDeliveries")), 2)
	})
}

func TestDeliveries_Delivered(t *testing.T) {
	tests := []struct {
		name   string
		answer fakeAnswer
		want   bool
		err    string
	}{
		{name: "delivered", answer: fakeAnswer{rows: [][]driver.Value{{true}}}, want: true},
		{name: "not yet", answer: fakeAnswer{rows: [][]driver.Value{{false}}}, want: false},
		{name: "query fails", answer: failWith(errBoom), err: "query event delivery: boom"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on("EventDelivered", tt.answer)
			got, err := NewDeliveries(db.open(t)).Delivered(t.Context(), "e-1", "email:payment-received")
			if tt.err != "" {
				testx.AssertTrue(t, errors.Is(err, errBoom))
				testx.AssertEqual(t, err.Error(), tt.err)
			} else {
				testx.AssertNoError(t, err)
			}
			testx.AssertEqual(t, got, tt.want)
			c, _ := db.call("EventDelivered")
			assertArgs(t, c.args, []driver.Value{"e-1", "email:payment-received"})
		})
	}
}

func TestDeliveries_MarkDelivered(t *testing.T) {
	db := newFakeSQL()
	testx.AssertNoError(t, NewDeliveries(db.open(t)).MarkDelivered(t.Context(), "e-1", "telegram:paid-order"))
	c, _ := db.call("MarkEventDelivered")
	assertArgs(t, c.args, []driver.Value{"e-1", "telegram:paid-order"})

	t.Run("the insert fails", func(t *testing.T) {
		db := newFakeSQL().on("MarkEventDelivered", failWith(errBoom))
		err := NewDeliveries(db.open(t)).MarkDelivered(t.Context(), "e-1", "telegram:paid-order")
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "record event delivery: boom")
	})
}
