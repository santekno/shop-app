package payment

import (
	"database/sql/driver"
	"strings"
	"testing"
	"time"
)

// Row shapes the fake SQL driver answers with (first needed by Bab 6
// artikel 02: the payment repository).

// paymentRowValues is a GetOpenPayment / GetPaymentByProviderOrderID /
// ListPaymentsToReconcile row of p: id, order_id, provider,
// provider_order_id, amount, status, snap_token, redirect_url, expires_at,
// paid_at, refund_required_at, created_at, updated_at.
func paymentRowValues(p Payment) []driver.Value {
	var paidAt, refundAt driver.Value
	if p.PaidAt != nil {
		paidAt = *p.PaidAt
	}
	if p.RefundRequiredAt != nil {
		refundAt = *p.RefundRequiredAt
	}
	return []driver.Value{
		p.ID, p.OrderID, p.Provider, p.ProviderOrderID, p.Amount, string(p.Status), p.Token, p.RedirectURL,
		p.ExpiresAt, paidAt, refundAt, p.CreatedAt, p.UpdatedAt,
	}
}

// orderRowValues is a GetOrder row of orderID in status (27 columns): id,
// code, user_id, status, cancel_reason, subtotal, discount, shipping_fee,
// total, total_weight_grams, voucher_code, courier, courier_service,
// tracking_number, the six shipping_* columns, payment_expires_at,
// paid_at, shipped_at, completed_at, cancelled_at, created_at, updated_at.
func orderRowValues(status string, cancelReason driver.Value) []driver.Value {
	var paidAt, cancelledAt driver.Value
	if status == "paid" {
		paidAt = testNow
	}
	if status == "cancelled" {
		cancelledAt = testNow
	}
	return []driver.Value{
		orderID, orderCode, buyerID, status, cancelReason,
		int64(120000), int64(12000), int64(9000), int64(117000), int64(500),
		"HEMAT10", "sicepat", "REG", nil,
		"Budi", "081234567890", "Jl. Merdeka 1", "Bandung", "Jawa Barat", "40111",
		testNow.Add(time.Hour), paidAt, nil, nil, cancelledAt, testNow.Add(-time.Hour), testNow,
	}
}

func orderRow(status string, cancelReason driver.Value) fakeAnswer {
	return fakeAnswer{rows: [][]driver.Value{orderRowValues(status, cancelReason)}}
}

// affected is an exec answer that changed n rows.
func affected(n int64) fakeAnswer { return fakeAnswer{affected: n} }

// assertNames checks the exact statement sequence.
func assertNames(t *testing.T, db *fakeSQL, want ...string) {
	t.Helper()
	got := db.names()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("statements\n got %v\nwant %v", got, want)
	}
}

// assertNoUsers checks that no statement touched the users table (ADR
// 0007: the webhook never takes a users lock).
func assertNoUsers(t *testing.T, db *fakeSQL) {
	t.Helper()
	for _, name := range db.names() {
		if strings.Contains(name, "User") {
			t.Errorf("statement %s touches users", name)
		}
	}
	db.mu.Lock()
	defer db.mu.Unlock()
	for name, query := range db.queries {
		if strings.Contains(strings.ToLower(query), "users") {
			t.Errorf("statement %s mentions users: %s", name, query)
		}
	}
}
