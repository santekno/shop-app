package payment

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// The reconciler end to end on the PostgreSQL repository (fake driver):
// what it lists, what it applies, and what it marks checked.

// A payment GoShop closed with its order (cancelled, Midtrans never told)
// that the buyer paid anyway, with the notification lost: the reconciler's
// closed queue finds it, the money is recorded (cancelled → paid) and
// flagged for a refund, and the closed order is never revived.
func TestReconcile_ClosedPaymentThatSettledIsFlaggedForRefund(t *testing.T) {
	closed := testPayment()
	closed.Status = StatusCancelled
	db := applyDB().
		on("ListPaymentsToReconcile", fakeAnswer{rows: [][]driver.Value{reconcileRowValues(closed, nil, true)}}).
		on("MarkOrderPaid", affected(0)) // the order is cancelled
	gw := newFakeGateway() // Midtrans says: settlement
	svc := NewService(Deps{Repo: NewPostgresRepository(db.open(t)), Gateway: gw, Clock: func() time.Time { return testNow }})

	res, err := svc.Reconcile(t.Context())

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, res, ReconcileResult{Checked: 1, Changed: 1})
	testx.AssertEqual(t, strings.Join(gw.statusCalls, ","), providerOrderID)
	testx.AssertEqual(t, strings.Join(db.names(), ","), "ListPaymentsToReconcile,"+
		"BEGIN,LockPaymentOrder,UpdatePaymentStatus,MarkOrderPaid,FlagPaymentForRefund,InsertPaymentEvent,COMMIT,"+
		"MarkPaymentChecked")
	upd, _ := db.call("UpdatePaymentStatus")
	testx.AssertEqual(t, upd.args[0], driver.Value("paid"))
	testx.AssertContains(t, upd.args[7].(string), `"cancelled"`, "a closed payment may still be paid")
	testx.AssertFalse(t, db.ran("InsertOutboxEvent"), "no order.paid: the order stays cancelled")
	ev, _ := db.call("InsertPaymentEvent")
	testx.AssertEqual(t, ev.args[3], driver.Value(SourceReconcile))
	testx.AssertEqual(t, ev.args[10], driver.Value(string(OutcomeRefundRequired)))
	mark, _ := db.call("MarkPaymentChecked")
	assertArgs(t, mark.args, []driver.Value{testNow, true, paymentID}, "MarkPaymentChecked: a settlement is final")
}

// A closed payment whose Snap window has ended, still pending at Midtrans
// (a bank transfer not yet confirmed): checked, but not final, so it stays
// in the closed queue and is asked about again.
func TestReconcile_PendingAfterTheWindowIsNotFinal(t *testing.T) {
	closed := testPayment()
	closed.Status = StatusCancelled
	closed.ExpiresAt = testNow.Add(-time.Hour) // the window ended long ago
	db := applyDB().
		on("ListPaymentsToReconcile", fakeAnswer{rows: [][]driver.Value{reconcileRowValues(closed, nil, true)}}).
		on("UpdatePaymentStatus", affected(0)) // cancelled → pending is no move
	gw := newFakeGateway()
	gw.status = statusOf("pending", "")
	svc := NewService(Deps{Repo: NewPostgresRepository(db.open(t)), Gateway: gw, Clock: func() time.Time { return testNow }})

	res, err := svc.Reconcile(t.Context())

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, res, ReconcileResult{Checked: 1})
	testx.AssertFalse(t, db.ran("MarkOrderPaid"))
	mark, _ := db.call("MarkPaymentChecked")
	assertArgs(t, mark.args, []driver.Value{testNow, false, paymentID}, "MarkPaymentChecked: pending is not final")
}

// A check that failed (Midtrans did not answer, or applying failed) is not
// marked checked: the payment keeps its place at the front of its queue,
// and a closed one stays in the closed queue until a check succeeds.
func TestReconcile_FailedCheckIsNotMarkedChecked(t *testing.T) {
	gatewayDown := testPayment()
	gatewayDown.ID, gatewayDown.ProviderOrderID = "0192f0a0-0000-7000-8000-0000000000d1", orderCode+"-DOWN01"
	applyFails := testPayment()
	applyFails.ID, applyFails.ProviderOrderID, applyFails.Status = "0192f0a0-0000-7000-8000-0000000000d2", orderCode+"-APPLY1", StatusCancelled
	db := applyDB().
		on("ListPaymentsToReconcile", fakeAnswer{rows: [][]driver.Value{
			reconcileRowValues(gatewayDown, nil, false), reconcileRowValues(applyFails, nil, true),
		}}).
		on("UpdatePaymentStatus", failWith(errBoom))
	gw := newFakeGateway()
	gw.statusErrs = map[string]error{gatewayDown.ProviderOrderID: fmt.Errorf("%w: timeout", ErrGatewayUnavailable)}
	svc := NewService(Deps{Repo: NewPostgresRepository(db.open(t)), Gateway: gw, Clock: func() time.Time { return testNow }})

	res, err := svc.Reconcile(t.Context())

	testx.AssertNoError(t, err, "one failing payment does not fail the run")
	testx.AssertEqual(t, res, ReconcileResult{Checked: 2, Failed: 2})
	testx.AssertEqual(t, len(gw.statusCalls), 2, "both were asked about")
	testx.AssertFalse(t, db.ran("MarkPaymentChecked"), "a failed check leaves checked_at alone: %v", db.names())
	testx.AssertTrue(t, db.ran("ROLLBACK"), "the failed apply rolled back")
}

// A settlement whose gross_amount is not the payment's changes nothing and
// is logged; it is not a final answer either, so the closed payment stays
// in the queue and is asked about again rather than dropped on a mismatch.
func TestReconcile_AmountMismatchIsNotFinal(t *testing.T) {
	closed := testPayment()
	closed.Status = StatusCancelled
	closed.ExpiresAt = testNow.Add(-time.Hour)
	db := applyDB().
		on("ListPaymentsToReconcile", fakeAnswer{rows: [][]driver.Value{reconcileRowValues(closed, nil, true)}})
	gw := newFakeGateway()
	gw.status = settlement()
	gw.status.GrossAmount = "1000.00"
	svc := NewService(Deps{Repo: NewPostgresRepository(db.open(t)), Gateway: gw, Clock: func() time.Time { return testNow }})

	res, err := svc.Reconcile(t.Context())

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, res, ReconcileResult{Checked: 1})
	testx.AssertTrue(t, Final(gw.status), "a settlement on its own would be final")
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"ListPaymentsToReconcile,BEGIN,InsertPaymentEvent,COMMIT,MarkPaymentChecked", "nothing but the event is written")
	ev, _ := db.call("InsertPaymentEvent")
	testx.AssertEqual(t, ev.args[10], driver.Value(string(OutcomeAmountMismatch)))
	mark, _ := db.call("MarkPaymentChecked")
	assertArgs(t, mark.args, []driver.Value{testNow, false, paymentID}, "MarkPaymentChecked: a mismatch is not final")
}

// An order that closes closes its open payments, and each one enters the
// closed queue afresh: final_checked_at is reset, so no earlier answer
// about a payment keeps it out of the queue once GoShop has closed it.
// Here the reconciler expires an open payment Midtrans never started, and
// the order's open payments close in the same transaction.
func TestReconcile_ClosingAnOrderResetsTheFinalCheck(t *testing.T) {
	open := testPayment()
	open.ExpiresAt = testNow.Add(-time.Minute) // past expiry: a 404 is final
	db := applyDB().
		on("ListPaymentsToReconcile", fakeAnswer{rows: [][]driver.Value{reconcileRowValues(open, nil, false)}}).
		on("GetOrder", orderRow("cancelled", "payment_expired"))
	gw := newFakeGateway()
	gw.statusErr = ErrTransactionNotFound
	svc := NewService(Deps{Repo: NewPostgresRepository(db.open(t)), Gateway: gw, Clock: func() time.Time { return testNow }})

	res, err := svc.Reconcile(t.Context())

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, res, ReconcileResult{Checked: 1, Changed: 1})
	closedNow, _ := db.call("CancelOpenPaymentsOfOrders")
	assertArgs(t, closedNow.args, []driver.Value{testNow, pqArray(orderID)}, "CancelOpenPaymentsOfOrders")
	assertSQL(t, db, "CancelOpenPaymentsOfOrders",
		"UPDATE payments SET status = 'cancelled', final_checked_at = NULL, updated_at = $1::timestamptz",
		"WHERE order_id = ANY($2::uuid[]) AND status IN ('pending', 'challenge')")
	mark, _ := db.call("MarkPaymentChecked")
	assertArgs(t, mark.args, []driver.Value{testNow, true, paymentID}, "the synthesized expire is final")
}
