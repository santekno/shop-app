package payment

import (
	"database/sql/driver"
	"errors"
	"testing"

	"github.com/santekno/sdk/testx"
)

// applyInputFor is what Service.Apply hands the repository for st about
// testPayment.
func applyInputFor(st TransactionStatus) ApplyInput {
	to, known := StatusOf(st.TransactionStatus, st.FraudStatus)
	amount, ok := wholeRupiah(st.GrossAmount)
	return ApplyInput{
		Payment: testPayment(), To: to, Known: known, Gateway: st,
		Amount: amount, AmountOK: ok, AmountMatches: ok && amount == testPayment().Amount,
		Source: SourceWebhook, DedupeKey: DedupeKey(st), Now: testNow,
	}
}

// applyDB is a fake database for Apply: LockPaymentOrder, its first
// statement, finds the payment's order (the foreign key guarantees one).
func applyDB() *fakeSQL {
	return newFakeSQL().on("LockPaymentOrder", rows("pending_payment"))
}

// assertOrderLockedFirst checks the lock order of ADR 0007 for every path
// that moves a payment: the order first, then the payment row, both in the
// one transaction, so a close of the order (order, then its open payment)
// and a notification never wait on each other in a circle.
func assertOrderLockedFirst(t *testing.T, db *fakeSQL) {
	t.Helper()
	assertLockedFirst(t, db, "LockPaymentOrder")
	names := db.names()
	testx.AssertEqual(t, names[2], "UpdatePaymentStatus", "the payment row right after its order: %v", names)
	lock, _ := db.call("LockPaymentOrder")
	assertArgs(t, lock.args, []driver.Value{orderID}, "LockPaymentOrder")
	assertSQL(t, db, "LockPaymentOrder", "FROM orders WHERE id = $1 FOR NO KEY UPDATE")
}

func statusOf(transactionStatus, fraud string) TransactionStatus {
	st := settlement()
	st.TransactionStatus, st.FraudStatus = transactionStatus, fraud
	return st
}

// eventArgs is the InsertPaymentEvent arguments after its generated id.
func eventArgs(in ApplyInput, outcome Outcome) []driver.Value {
	var fraud, gross driver.Value
	if in.Gateway.FraudStatus != "" {
		fraud = in.Gateway.FraudStatus
	}
	if in.AmountOK {
		gross = in.Amount
	}
	var txID, paymentType driver.Value
	if in.Gateway.TransactionID != "" {
		txID = in.Gateway.TransactionID
	}
	if in.Gateway.PaymentType != "" {
		paymentType = in.Gateway.PaymentType
	}
	return []driver.Value{
		paymentID, in.DedupeKey, in.Source, in.Gateway.TransactionStatus, fraud, in.Gateway.StatusCode,
		txID, paymentType, gross, string(outcome), testNow,
	}
}

func assertEvent(t *testing.T, db *fakeSQL, in ApplyInput, outcome Outcome) {
	t.Helper()
	c, ok := db.call("InsertPaymentEvent")
	if !ok {
		t.Fatalf("no payment event: %v", db.names())
	}
	testx.AssertEqual(t, len(c.args), 12)
	assertArgs(t, c.args[1:], eventArgs(in, outcome), "InsertPaymentEvent")
}

// Settlement and an accepted capture: the order locked, then the payment
// row, then the order paid, its outbox event, the payment event, in one
// transaction.
func TestPostgresRepository_Apply_Paid(t *testing.T) {
	for _, st := range []TransactionStatus{settlement(), statusOf("capture", "accept"), statusOf("capture", "")} {
		t.Run(st.TransactionStatus+"/"+st.FraudStatus, func(t *testing.T) {
			db := applyDB().on("GetOrder", orderRow("paid", nil))
			in := applyInputFor(st)
			outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, OutcomePaid)

			assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid", "GetOrder", "InsertOutboxEvent", "InsertPaymentEvent", "COMMIT")
			assertOrderLockedFirst(t, db)
			assertNoUsers(t, db)

			upd, _ := db.call("UpdatePaymentStatus")
			assertArgs(t, upd.args, []driver.Value{
				"paid", st.TransactionStatus, "tx-1", "bank_transfer", testNow, testNow, paymentID, pqArray("pending", "challenge", "cancelled", "expired"),
			}, "UpdatePaymentStatus")
			assertSQL(t, db, "UpdatePaymentStatus", "UPDATE payments", "WHERE id = $7 AND status = ANY($8::text[])")

			paid, _ := db.call("MarkOrderPaid")
			assertArgs(t, paid.args, []driver.Value{testNow, orderID, pqArray("pending_payment")}, "MarkOrderPaid")

			ev, _ := db.call("InsertOutboxEvent")
			assertArgs(t, ev.args[1:4], []driver.Value{"order", orderID, "order.paid"}, "InsertOutboxEvent")

			assertEvent(t, db, in, OutcomePaid)
		})
	}
}

// Expired: the order locked, the payment row, the order cancelled, its
// variants, voucher and open payments, outbox, payment event.
func TestPostgresRepository_Apply_Expired(t *testing.T) {
	db := applyDB().on("GetOrder", orderRow("cancelled", "payment_expired"))
	st := TransactionStatus{OrderID: providerOrderID, StatusCode: "407", TransactionID: "tx-1", TransactionStatus: "expire", GrossAmount: "117000.00"}
	in := applyInputFor(st)
	outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeOrderCancelled)

	assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "CancelOrder", "LockOrderVariants", "RestoreOrderStock",
		"ReleaseVoucher", "CancelOpenPaymentsOfOrders", "GetOrder", "InsertOutboxEvent", "InsertPaymentEvent", "COMMIT")
	assertOrderLockedFirst(t, db)
	assertNoUsers(t, db)

	upd, _ := db.call("UpdatePaymentStatus")
	assertArgs(t, upd.args, []driver.Value{
		"expired", "expire", "tx-1", nil, nil, testNow, paymentID, pqArray("pending", "challenge"),
	}, "UpdatePaymentStatus: no paid_at")
	cancel, _ := db.call("CancelOrder")
	assertArgs(t, cancel.args, []driver.Value{"payment_expired", testNow, orderID, pqArray("pending_payment"), nil}, "CancelOrder")
	closed, _ := db.call("CancelOpenPaymentsOfOrders")
	assertArgs(t, closed.args, []driver.Value{testNow, pqArray(orderID)}, "CancelOpenPaymentsOfOrders")
	ev, _ := db.call("InsertOutboxEvent")
	assertArgs(t, ev.args[1:4], []driver.Value{"order", orderID, "order.cancelled"}, "InsertOutboxEvent")
	assertEvent(t, db, in, OutcomeOrderCancelled)
}

// The payment expired, but the order had moved on already: only recorded.
func TestPostgresRepository_Apply_ExpiredOrderGone(t *testing.T) {
	db := applyDB().on("CancelOrder", affected(0))
	in := applyInputFor(statusOf("expire", ""))
	outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeRecorded)
	assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "CancelOrder", "InsertPaymentEvent", "COMMIT")
	assertEvent(t, db, in, OutcomeRecorded)
}

// Statuses that change only the payment never touch the order.
func TestPostgresRepository_Apply_PaymentOnly(t *testing.T) {
	tests := []struct {
		tx, fraud string
		to        string
		from      driver.Value
	}{
		{"deny", "", "denied", pqArray("pending", "challenge")},
		{"capture", "deny", "denied", pqArray("pending", "challenge")},
		{"cancel", "", "cancelled", pqArray("pending", "challenge")},
		{"failure", "", "failed", pqArray("pending", "challenge")},
		{"pending", "", "pending", nil},
		{"capture", "challenge", "challenge", pqArray("pending")},
		{"refund", "", "refunded", pqArray("paid", "partially_refunded")},
		{"partial_refund", "", "partially_refunded", pqArray("paid", "partially_refunded")},
	}
	for _, tc := range tests {
		t.Run(tc.tx+"/"+tc.fraud, func(t *testing.T) {
			db := applyDB()
			in := applyInputFor(statusOf(tc.tx, tc.fraud))
			outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, OutcomeRecorded)
			assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "InsertPaymentEvent", "COMMIT")
			assertOrderLockedFirst(t, db)
			upd, _ := db.call("UpdatePaymentStatus")
			testx.AssertEqual(t, upd.args[0], driver.Value(tc.to))
			testx.AssertEqual(t, upd.args[4], driver.Value(nil), "paid_at only for paid")
			testx.AssertEqual(t, upd.args[7], tc.from, "@from_statuses")
			assertEvent(t, db, in, OutcomeRecorded)
		})
	}
}

// Money for an order that no longer waits for it: the payment is flagged
// for a refund, and the order is never revived.
func TestPostgresRepository_Apply_LatePaymentFlagsRefund(t *testing.T) {
	db := applyDB().on("MarkOrderPaid", affected(0))
	in := applyInputFor(settlement())
	outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeRefundRequired)

	assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid", "FlagPaymentForRefund", "InsertPaymentEvent", "COMMIT")
	assertOrderLockedFirst(t, db)
	testx.AssertFalse(t, db.ran("GetOrder"))
	testx.AssertFalse(t, db.ran("InsertOutboxEvent"), "no order event")
	flag, _ := db.call("FlagPaymentForRefund")
	assertArgs(t, flag.args, []driver.Value{testNow, paymentID}, "FlagPaymentForRefund")
	assertSQL(t, db, "FlagPaymentForRefund", "UPDATE payments SET refund_required_at")
	assertEvent(t, db, in, OutcomeRefundRequired)
}

// Money for a payment GoShop closed because its order closed (cancelled
// by the buyer, the seller, the expiry job) is recorded, never lost: the
// payment may still move to paid, and the order, which no longer waits for
// payment, is flagged for a refund instead of revived.
func TestPostgresRepository_Apply_ClosedPaymentStillTakesMoney(t *testing.T) {
	for _, closed := range []Status{StatusCancelled, StatusExpired} {
		t.Run(string(closed), func(t *testing.T) {
			db := applyDB().on("MarkOrderPaid", affected(0))
			in := applyInputFor(settlement())
			in.Payment.Status = closed
			outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, OutcomeRefundRequired)
			assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid", "FlagPaymentForRefund", "InsertPaymentEvent", "COMMIT")
			upd, _ := db.call("UpdatePaymentStatus")
			testx.AssertContains(t, upd.args[7].(string), `"`+string(closed)+`"`, "@from_statuses lets a closed payment be paid")
			testx.AssertFalse(t, db.ran("InsertOutboxEvent"), "the order is not paid")
		})
	}
}

// An amount that is not the payment's changes nothing; it is only
// recorded.
func TestPostgresRepository_Apply_AmountMismatch(t *testing.T) {
	tests := []struct {
		name  string
		gross string
	}{
		{"less", "1000.00"},
		{"more", "117001.00"},
		{"not whole rupiah", "117000.50"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := settlement()
			st.GrossAmount = tc.gross
			in := applyInputFor(st)
			testx.AssertFalse(t, in.AmountMatches)
			db := applyDB()
			outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, OutcomeAmountMismatch)
			assertNames(t, db, "BEGIN", "InsertPaymentEvent", "COMMIT")
			assertEvent(t, db, in, OutcomeAmountMismatch)
		})
	}
	// AmountMatches is what decides, even with a parsed amount.
	in := applyInputFor(settlement())
	in.AmountMatches = false
	db := applyDB()
	outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeAmountMismatch)
	testx.AssertFalse(t, db.ran("UpdatePaymentStatus"))
	testx.AssertFalse(t, db.ran("MarkOrderPaid"))

	// A repeated mismatch stays a mismatch.
	db = applyDB().on("InsertPaymentEvent", affected(0))
	outcome, err = NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeAmountMismatch)
}

// A status GoShop does not know is only recorded.
func TestPostgresRepository_Apply_UnknownStatus(t *testing.T) {
	in := applyInputFor(statusOf("authorize", ""))
	testx.AssertFalse(t, in.Known)
	db := applyDB()
	outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeRecorded)
	assertNames(t, db, "BEGIN", "InsertPaymentEvent", "COMMIT")
	assertEvent(t, db, in, OutcomeRecorded)

	db = applyDB().on("InsertPaymentEvent", affected(0))
	outcome, err = NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeDuplicate)
}

// A status handled before changes nothing, however often it arrives.
func TestPostgresRepository_Apply_Duplicate(t *testing.T) {
	for _, st := range []TransactionStatus{settlement(), statusOf("deny", ""), statusOf("expire", "")} {
		t.Run(st.TransactionStatus, func(t *testing.T) {
			db := applyDB().on("UpdatePaymentStatus", affected(0)).on("InsertPaymentEvent", affected(0))
			outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), applyInputFor(st))
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, outcome, OutcomeDuplicate)
			assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "InsertPaymentEvent", "COMMIT")
			testx.AssertFalse(t, db.ran("MarkOrderPaid"), "a paid payment never pays its order again")
			testx.AssertFalse(t, db.ran("CancelOrder"))
		})
	}
}

// A status the payment may not move to (a late settlement of a paid
// payment, under another transaction) is recorded, and the order is not
// touched.
func TestPostgresRepository_Apply_NotMovable(t *testing.T) {
	db := applyDB().on("UpdatePaymentStatus", affected(0))
	in := applyInputFor(settlement())
	outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeRecorded)
	assertNames(t, db, "BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "InsertPaymentEvent", "COMMIT")
	assertEvent(t, db, in, OutcomeRecorded)
}

// A failing statement rolls the whole transaction back.
func TestPostgresRepository_Apply_Errors(t *testing.T) {
	expire := statusOf("expire", "")
	tests := []struct {
		name   string
		st     TransactionStatus
		setup  func(db *fakeSQL)
		msg    string
		before []string // statements run before ROLLBACK
	}{
		{"lock order", settlement(), func(db *fakeSQL) {
			db.mu.Lock()
			db.answers["LockPaymentOrder"] = []fakeAnswer{failWith(errBoom)}
			db.mu.Unlock()
		}, "lock payment's order", []string{"BEGIN", "LockPaymentOrder"}},
		{"update payment", settlement(), func(db *fakeSQL) { db.on("UpdatePaymentStatus", failWith(errBoom)) },
			"update payment status", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus"}},
		{"mark order paid", settlement(), func(db *fakeSQL) { db.on("MarkOrderPaid", failWith(errBoom)) },
			"boom", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid"}},
		{"read paid order", settlement(), func(db *fakeSQL) { db.on("GetOrder", failWith(errBoom)) },
			"read changed order", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid", "GetOrder"}},
		{"record order event", settlement(), func(db *fakeSQL) {
			db.on("GetOrder", orderRow("paid", nil)).on("InsertOutboxEvent", failWith(errBoom))
		}, "record order.paid event", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid", "GetOrder", "InsertOutboxEvent"}},
		{"flag refund", settlement(), func(db *fakeSQL) {
			db.on("MarkOrderPaid", affected(0)).on("FlagPaymentForRefund", failWith(errBoom))
		}, "flag payment for refund", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid", "FlagPaymentForRefund"}},
		{"payment event", settlement(), func(db *fakeSQL) {
			db.on("GetOrder", orderRow("paid", nil)).on("InsertPaymentEvent", failWith(errBoom))
		}, "insert payment event", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "MarkOrderPaid", "GetOrder", "InsertOutboxEvent", "InsertPaymentEvent"}},
		{"cancel order", expire, func(db *fakeSQL) { db.on("CancelOrder", failWith(errBoom)) },
			"expire unpaid order", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "CancelOrder"}},
		{"lock variants", expire, func(db *fakeSQL) { db.on("LockOrderVariants", failWith(errBoom)) },
			"lock order variants", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "CancelOrder", "LockOrderVariants"}},
		{"restore stock", expire, func(db *fakeSQL) { db.on("RestoreOrderStock", failWith(errBoom)) },
			"restore stock", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "CancelOrder", "LockOrderVariants", "RestoreOrderStock"}},
		{"release voucher", expire, func(db *fakeSQL) { db.on("ReleaseVoucher", failWith(errBoom)) },
			"release voucher", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "CancelOrder", "LockOrderVariants", "RestoreOrderStock", "ReleaseVoucher"}},
		{"close open payments", expire, func(db *fakeSQL) { db.on("CancelOpenPaymentsOfOrders", failWith(errBoom)) },
			"close open payments", []string{"BEGIN", "LockPaymentOrder", "UpdatePaymentStatus", "CancelOrder", "LockOrderVariants",
				"RestoreOrderStock", "ReleaseVoucher", "CancelOpenPaymentsOfOrders"}},
		{"unknown status event", statusOf("authorize", ""), func(db *fakeSQL) { db.on("InsertPaymentEvent", failWith(errBoom)) },
			"insert payment event", []string{"BEGIN", "InsertPaymentEvent"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			db := applyDB()
			tc.setup(db)
			_, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), applyInputFor(tc.st))
			testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
			testx.AssertContains(t, err.Error(), tc.msg)
			assertNames(t, db, append(tc.before, "ROLLBACK")...)
			testx.AssertFalse(t, db.ran("COMMIT"))
		})
	}

	t.Run("begin", func(t *testing.T) {
		db := applyDB().on("BEGIN", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), applyInputFor(settlement()))
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "begin transaction")
		testx.AssertFalse(t, db.ran("UpdatePaymentStatus"))
	})
	t.Run("commit", func(t *testing.T) {
		db := applyDB().on("GetOrder", orderRow("paid", nil)).on("COMMIT", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), applyInputFor(settlement()))
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "commit")
	})
}

// The payment event stores the dedupe key, the source, and the amount
// only when it parsed.
func TestPostgresRepository_Apply_EventArgs(t *testing.T) {
	st := statusOf("capture", "challenge")
	st.TransactionID, st.PaymentType, st.GrossAmount = "", "", "abc"
	in := applyInputFor(st)
	in.Source = SourceReconcile
	db := applyDB()
	outcome, err := NewPostgresRepository(db.open(t)).Apply(t.Context(), in)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, outcome, OutcomeAmountMismatch)
	c, _ := db.call("InsertPaymentEvent")
	testx.AssertEqual(t, c.args[2], driver.Value("none|capture|challenge"))
	testx.AssertEqual(t, c.args[3], driver.Value(SourceReconcile))
	testx.AssertEqual(t, c.args[5], driver.Value("challenge"))
	testx.AssertEqual(t, c.args[7], driver.Value(nil), "no transaction id: NULL")
	testx.AssertEqual(t, c.args[8], driver.Value(nil), "no payment type: NULL")
	testx.AssertEqual(t, c.args[9], driver.Value(nil), "gross amount NULL when it did not parse")
	id, ok := c.args[0].(string)
	testx.AssertTrue(t, ok && len(id) == 36, "event id %v", c.args[0])
}
