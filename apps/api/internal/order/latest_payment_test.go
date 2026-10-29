package order

// Bab 11 artikel-05: an order carries its newest payment, so the buyer's
// order page can say why a pending_payment order still waits.

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// latestPaymentRow is a GetLatestPaymentOfOrder row: status, expires_at,
// updated_at.
func latestPaymentRow(status string, expiresAt, updatedAt time.Time) fakeAnswer {
	return fakeAnswer{rows: [][]driver.Value{{status, expiresAt, updatedAt}}}
}

func TestPostgresRepository_LatestPayment(t *testing.T) {
	expires := testTime.Add(24 * time.Hour)
	updated := testTime.Add(5 * time.Minute)
	reads := []struct {
		name, query string
		read        func(*PostgresRepository) (Order, error)
	}{
		{name: "Get", query: "GetOrderForUser", read: func(r *PostgresRepository) (Order, error) {
			return r.Get(context.Background(), buyerID, orderID1)
		}},
		{name: "GetAny", query: "GetOrder", read: func(r *PostgresRepository) (Order, error) {
			return r.GetAny(context.Background(), orderID1)
		}},
	}
	for _, rd := range reads {
		t.Run(rd.name+" with a payment", func(t *testing.T) {
			db := newFakeSQL().
				on(rd.query, orderAnswer(orderID1, StatusPendingPayment, nil)).
				on("GetLatestPaymentOfOrder", latestPaymentRow("denied", expires, updated))

			o, err := rd.read(newOrderRepo(t, db))

			testx.AssertNoError(t, err)
			call, ok := db.call("GetLatestPaymentOfOrder")
			testx.AssertTrue(t, ok, "the newest payment is read")
			assertArgs(t, call.args, []driver.Value{orderID1})
			if o.LatestPayment == nil {
				t.Fatal("LatestPayment is nil, want the denied payment")
			}
			testx.AssertEqual(t, o.LatestPayment.Status, "denied")
			testx.AssertTrue(t, o.LatestPayment.ExpiresAt.Equal(expires), "expires_at %v", o.LatestPayment.ExpiresAt)
			testx.AssertTrue(t, o.LatestPayment.UpdatedAt.Equal(updated), "updated_at %v", o.LatestPayment.UpdatedAt)
		})
		t.Run(rd.name+" without a payment", func(t *testing.T) {
			db := newFakeSQL().on(rd.query, orderAnswer(orderID1, StatusPendingPayment, nil))

			o, err := rd.read(newOrderRepo(t, db))

			testx.AssertNoError(t, err)
			testx.AssertTrue(t, db.ran("GetLatestPaymentOfOrder"))
			testx.AssertTrue(t, o.LatestPayment == nil, "LatestPayment %+v, want nil", o.LatestPayment)
		})
		t.Run(rd.name+" error", func(t *testing.T) {
			db := newFakeSQL().
				on(rd.query, orderAnswer(orderID1, StatusPendingPayment, nil)).
				on("GetLatestPaymentOfOrder", failWith(errBoom))

			_, err := rd.read(newOrderRepo(t, db))

			if err == nil {
				t.Fatal("want the payment read's error, got nil")
			}
			testx.AssertEqual(t, err.Error(), "query latest payment: boom")
		})
	}

	t.Run("an order that is not found reads no payment", func(t *testing.T) {
		db := newFakeSQL()
		_, err := newOrderRepo(t, db).Get(context.Background(), buyerID, orderID1)
		testx.AssertError(t, err)
		testx.AssertFalse(t, db.ran("GetLatestPaymentOfOrder"), "someone else's order must not reach the payments")
	})
}

func TestToOrderJSON_LatestPayment(t *testing.T) {
	wib := time.FixedZone("WIB", 7*60*60)
	t.Run("set: status and times in UTC, nothing else", func(t *testing.T) {
		o := Order{ID: orderID1, LatestPayment: &LatestPayment{
			Status:    "expired",
			ExpiresAt: time.Date(2026, 10, 24, 15, 0, 0, 0, wib),
			UpdatedAt: time.Date(2026, 10, 24, 15, 1, 0, 0, wib),
		}}
		raw, err := json.Marshal(toOrderJSON(o))
		testx.AssertNoError(t, err)
		var got struct {
			LatestPayment map[string]any `json:"latest_payment"`
		}
		testx.AssertNoError(t, json.Unmarshal(raw, &got))
		testx.AssertEqual(t, len(got.LatestPayment), 3, "latest_payment %v", got.LatestPayment)
		testx.AssertEqual(t, got.LatestPayment["status"], any("expired"))
		testx.AssertEqual(t, got.LatestPayment["expires_at"], any("2026-10-24T08:00:00Z"))
		testx.AssertEqual(t, got.LatestPayment["updated_at"], any("2026-10-24T08:01:00Z"))
	})
	t.Run("nil is null, never left out", func(t *testing.T) {
		raw, err := json.Marshal(toOrderJSON(Order{ID: orderID1}))
		testx.AssertNoError(t, err)
		var got map[string]json.RawMessage
		testx.AssertNoError(t, json.Unmarshal(raw, &got))
		v, present := got["latest_payment"]
		testx.AssertTrue(t, present, "latest_payment is required by the contract")
		testx.AssertEqual(t, string(v), "null")
	})
}
