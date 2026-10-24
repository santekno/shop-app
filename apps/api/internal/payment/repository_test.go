package payment

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func storedPayment() Payment {
	p := testPayment()
	refund := testNow.Add(-time.Second)
	p.RefundRequiredAt = &refund
	return p
}

func TestPostgresRepository_OpenPayment(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		want := storedPayment()
		db := newFakeSQL().on("GetOpenPayment", rows(paymentRowValues(want)...))
		got, ok, err := NewPostgresRepository(db.open(t)).OpenPayment(t.Context(), orderID)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, ok)
		assertPayment(t, got, want)
		c, _ := db.call("GetOpenPayment")
		assertArgs(t, c.args, []driver.Value{orderID})
		assertSQL(t, db, "GetOpenPayment", "status IN ('pending', 'challenge')")
	})
	t.Run("none", func(t *testing.T) {
		db := newFakeSQL()
		got, ok, err := NewPostgresRepository(db.open(t)).OpenPayment(t.Context(), orderID)
		testx.AssertNoError(t, err)
		testx.AssertFalse(t, ok)
		testx.AssertEqual(t, got.ID, "")
	})
	t.Run("error", func(t *testing.T) {
		db := newFakeSQL().on("GetOpenPayment", failWith(errBoom))
		_, ok, err := NewPostgresRepository(db.open(t)).OpenPayment(t.Context(), orderID)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "query open payment")
		testx.AssertFalse(t, ok)
	})
}

func assertPayment(t *testing.T, got, want Payment) {
	t.Helper()
	testx.AssertEqual(t, got.ID, want.ID)
	testx.AssertEqual(t, got.OrderID, want.OrderID)
	testx.AssertEqual(t, got.Provider, want.Provider)
	testx.AssertEqual(t, got.ProviderOrderID, want.ProviderOrderID)
	testx.AssertEqual(t, got.Amount, want.Amount)
	testx.AssertEqual(t, got.Status, want.Status)
	testx.AssertEqual(t, got.Token, want.Token)
	testx.AssertEqual(t, got.RedirectURL, want.RedirectURL)
	testx.AssertTrue(t, got.ExpiresAt.Equal(want.ExpiresAt), "expires_at %v", got.ExpiresAt)
	testx.AssertTrue(t, got.CreatedAt.Equal(want.CreatedAt), "created_at %v", got.CreatedAt)
	testx.AssertTrue(t, got.UpdatedAt.Equal(want.UpdatedAt), "updated_at %v", got.UpdatedAt)
	assertTimePtr(t, got.PaidAt, want.PaidAt, "paid_at")
	assertTimePtr(t, got.RefundRequiredAt, want.RefundRequiredAt, "refund_required_at")
}

func assertTimePtr(t *testing.T, got, want *time.Time, name string) {
	t.Helper()
	if want == nil {
		testx.AssertTrue(t, got == nil, "%s: got %v, want nil", name, got)
		return
	}
	testx.AssertTrue(t, got != nil && got.Equal(*want), "%s: got %v, want %v", name, got, *want)
}

func TestPostgresRepository_Insert(t *testing.T) {
	p := testPayment()
	tests := []struct {
		name   string
		answer fakeAnswer
		want   bool
	}{
		{"stored", affected(1), true},
		{"not stored", affected(0), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			db := newFakeSQL().on("InsertPayment", tc.answer)
			ok, err := NewPostgresRepository(db.open(t)).Insert(t.Context(), p)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, ok, tc.want)
			c, _ := db.call("InsertPayment")
			assertArgs(t, c.args, []driver.Value{
				p.ID, p.Provider, p.ProviderOrderID, p.Token, p.RedirectURL, p.ExpiresAt, p.CreatedAt, p.OrderID, p.Amount,
			}, "InsertPayment")
			testx.AssertEqual(t, c.tx, 0, "outside any transaction")
			// FOR SHARE OF o (ADR 0007, "Lock order"): the insert queues behind
			// a close or a payment of the order that is running, re-checks the
			// status on the committed row, and makes a later close wait for it
			// and cancel the new payment: no open payment on a closed order.
			assertSQL(t, db, "InsertPayment", "o.status = 'pending_payment' AND o.total = $9",
				"WHERE o.id = $8 AND o.status = 'pending_payment' AND o.total = $9 FOR SHARE OF o ON CONFLICT", "DO NOTHING")
		})
	}
	t.Run("error", func(t *testing.T) {
		db := newFakeSQL().on("InsertPayment", failWith(errBoom))
		ok, err := NewPostgresRepository(db.open(t)).Insert(t.Context(), p)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "insert payment")
		testx.AssertFalse(t, ok)
	})
}

func TestPostgresRepository_ByProviderOrderID(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		want := testPayment()
		paid := testNow
		want.PaidAt, want.Status = &paid, StatusPaid
		db := newFakeSQL().on("GetPaymentByProviderOrderID", rows(paymentRowValues(want)...))
		got, err := NewPostgresRepository(db.open(t)).ByProviderOrderID(t.Context(), providerOrderID)
		testx.AssertNoError(t, err)
		assertPayment(t, got, want)
		c, _ := db.call("GetPaymentByProviderOrderID")
		assertArgs(t, c.args, []driver.Value{providerOrderID})
	})
	t.Run("not found", func(t *testing.T) {
		db := newFakeSQL()
		_, err := NewPostgresRepository(db.open(t)).ByProviderOrderID(t.Context(), providerOrderID)
		testx.AssertTrue(t, errors.Is(err, ErrPaymentNotFound), "got %v", err)
	})
	t.Run("error", func(t *testing.T) {
		db := newFakeSQL().on("GetPaymentByProviderOrderID", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).ByProviderOrderID(t.Context(), providerOrderID)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertFalse(t, errors.Is(err, ErrPaymentNotFound))
		testx.AssertContains(t, err.Error(), "query payment")
	})
}

// reconcileRowValues is a ListPaymentsToReconcile row (15 columns): the
// payment's 13, then checked_at and closed (which queue it came from).
func reconcileRowValues(p Payment, checkedAt driver.Value, closed bool) []driver.Value {
	return append(paymentRowValues(p), checkedAt, closed)
}

// The reconciler's two queues (ADR 0007): open payments, and payments
// GoShop closed with their order (cancelled), which Midtrans may still
// take money for until their Snap window ends.
func TestPostgresRepository_ToReconcile(t *testing.T) {
	first := testPayment()
	second := testPayment()
	second.ID, second.ProviderOrderID, second.Status = "0192f0a0-0000-7000-8000-0000000000b2", orderCode+"-ZZZZZZ", StatusChallenge
	closed := testPayment()
	closed.ID, closed.ProviderOrderID, closed.Status = "0192f0a0-0000-7000-8000-0000000000b3", orderCode+"-CLOSED", StatusCancelled
	before := testNow.Add(-time.Minute)

	t.Run("rows from both queues", func(t *testing.T) {
		db := newFakeSQL().on("ListPaymentsToReconcile", fakeAnswer{rows: [][]driver.Value{
			reconcileRowValues(first, nil, false),
			reconcileRowValues(second, testNow.Add(-time.Hour), false),
			reconcileRowValues(closed, testNow.Add(-40*time.Minute), true),
		}})
		got, err := NewPostgresRepository(db.open(t)).ToReconcile(t.Context(), before, 100)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 3)
		assertPayment(t, got[0], first)
		assertPayment(t, got[1], second)
		assertPayment(t, got[2], closed)
		testx.AssertEqual(t, got[2].Status, StatusCancelled, "a closed payment is asked about as it is")

		c, _ := db.call("ListPaymentsToReconcile")
		// created_before, the open batch, then the closed queue's recheck
		// cutoff (30 min), window end (10 min) and its own batch: a quarter.
		assertArgs(t, c.args, []driver.Value{
			before, int64(100), before.Add(-30 * time.Minute), before.Add(-10 * time.Minute), int64(25),
		}, "ListPaymentsToReconcile")
	})
	t.Run("the closed queue's batch is a quarter, at least one", func(t *testing.T) {
		for limit, want := range map[int32]int64{100: 25, 7: 1, 3: 1, 1: 1, 8: 2} {
			db := newFakeSQL()
			got, err := NewPostgresRepository(db.open(t)).ToReconcile(t.Context(), before, limit)
			testx.AssertNoError(t, err)
			testx.AssertTrue(t, got != nil, "an empty slice, not nil")
			testx.AssertEqual(t, len(got), 0)
			c, _ := db.call("ListPaymentsToReconcile")
			testx.AssertEqual(t, c.args[1], driver.Value(int64(limit)), "open batch for %d", limit)
			testx.AssertEqual(t, c.args[4], driver.Value(want), "closed batch for %d", limit)
		}
	})
	t.Run("the query's rules", func(t *testing.T) {
		db := newFakeSQL()
		_, err := NewPostgresRepository(db.open(t)).ToReconcile(t.Context(), before, 100)
		testx.AssertNoError(t, err)
		assertSQL(t, db, "ListPaymentsToReconcile",
			// Open payments, the least recently checked first, their own LIMIT.
			"false AS closed FROM payments o WHERE o.status IN ('pending', 'challenge') AND o.created_at < $1",
			"ORDER BY o.checked_at NULLS FIRST, o.created_at LIMIT $2)",
			"UNION ALL",
			// Closed payments, until a check gets a final answer.
			"true AS closed FROM payments c WHERE c.status = 'cancelled' AND c.final_checked_at IS NULL AND c.created_at < $1",
			// Due: never checked, or not for 30 minutes, or the window has
			// ended and it was not checked since (the first check after it).
			"AND (c.checked_at IS NULL OR c.checked_at < $3::timestamptz OR (c.expires_at < $4::timestamptz AND c.checked_at - c.expires_at < interval '10 minutes'))",
			"ORDER BY c.expires_at LIMIT $5)",
		)
		// The open ones first, then by the end of the window.
		testx.AssertTrue(t, strings.HasSuffix(db.sqlOf("ListPaymentsToReconcile"), ") ORDER BY closed, expires_at"),
			"merged by closed, expires_at: %s", db.sqlOf("ListPaymentsToReconcile"))
	})
	t.Run("error", func(t *testing.T) {
		db := newFakeSQL().on("ListPaymentsToReconcile", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).ToReconcile(t.Context(), before, 100)
		testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
		testx.AssertContains(t, err.Error(), "query payments to reconcile")
	})
}

func TestPostgresRepository_MarkChecked(t *testing.T) {
	for _, final := range []bool{false, true} {
		db := newFakeSQL()
		err := NewPostgresRepository(db.open(t)).MarkChecked(t.Context(), paymentID, testNow, final)
		testx.AssertNoError(t, err)
		c, _ := db.call("MarkPaymentChecked")
		assertArgs(t, c.args, []driver.Value{testNow, final, paymentID}, "MarkPaymentChecked")
		// checked_at always moves; final_checked_at is set by the first
		// final answer only and never cleared: a later non-final check
		// (or a later final one) leaves it as it is.
		assertSQL(t, db, "MarkPaymentChecked", "SET checked_at = $1::timestamptz",
			"final_checked_at = CASE WHEN $2::boolean THEN COALESCE(final_checked_at, $1::timestamptz) ELSE final_checked_at END",
			"WHERE id = $3")
	}

	db := newFakeSQL().on("MarkPaymentChecked", failWith(errBoom))
	err := NewPostgresRepository(db.open(t)).MarkChecked(t.Context(), paymentID, testNow, false)
	testx.AssertTrue(t, errors.Is(err, errBoom), "got %v", err)
	testx.AssertContains(t, err.Error(), "mark payment checked")
}
