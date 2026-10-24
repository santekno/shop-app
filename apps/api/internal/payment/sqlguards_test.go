package payment

import (
	"testing"

	"github.com/santekno/sdk/testx"
)

// The money rules that live in SQL, not in Go: the fake driver answers by
// statement name, so only the statement text shows these guards. Each
// fragment below is what keeps a replayed, late or racing request from
// changing money twice (ADR 0007).
func TestPaymentSQLGuards(t *testing.T) {
	t.Run("a repeated status is recorded once", func(t *testing.T) {
		db := applyDB().on("GetOrder", orderRow("paid", nil))
		_, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), applyInputFor(settlement()))
		testx.AssertNoError(t, err)
		// payment_events_dedupe_key: the same (payment, dedupe key) inserts
		// nothing the second time, and InsertPaymentEvent's 0 rows is how
		// Apply tells a duplicate.
		assertSQL(t, db, "InsertPaymentEvent", "INSERT INTO payment_events",
			"ON CONFLICT (payment_id, dedupe_key) DO NOTHING")
		// The payment moves only from the statuses payment.From allows, and
		// paid_at keeps the first payment's time.
		assertSQL(t, db, "UpdatePaymentStatus", "WHERE id = $7 AND status = ANY($8::text[])",
			"paid_at = COALESCE(paid_at, $5)")
		// The order is paid only from the statuses order.From allows
		// (pending_payment): a cancelled or expired order is never revived.
		assertSQL(t, db, "MarkOrderPaid", "WHERE id = $2 AND status = ANY($3::text[])")
	})
	t.Run("a late payment is flagged, never the order", func(t *testing.T) {
		db := applyDB().on("MarkOrderPaid", affected(0))
		_, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), applyInputFor(settlement()))
		testx.AssertNoError(t, err)
		// Only a payment that really took money is flagged, and the first
		// flag time stays.
		assertSQL(t, db, "FlagPaymentForRefund", "UPDATE payments SET refund_required_at = COALESCE(refund_required_at, $1::timestamptz)",
			"WHERE id = $2 AND paid_at IS NOT NULL")
	})
	t.Run("two pay requests store one open payment", func(t *testing.T) {
		db := newFakeSQL()
		_, err := NewPostgresRepository(db.open(t)).Insert(t.Context(), testPayment())
		testx.AssertNoError(t, err)
		// The loser of a race inserts nothing (the partial unique index of
		// open payments), and the amount comes from the order row, only
		// while it still waits for that total.
		assertSQL(t, db, "InsertPayment", "ON CONFLICT (order_id) WHERE status IN ('pending', 'challenge') DO NOTHING",
			"o.status = 'pending_payment' AND o.total = $9", "SELECT $1, o.id")
	})
}
