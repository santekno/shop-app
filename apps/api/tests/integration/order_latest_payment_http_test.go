//go:build integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// latestPaymentRow is a payment's status and times as PostgreSQL holds
// them, to compare with the order's latest_payment.
func (sh *shop) latestPaymentRow(t *testing.T, paymentID string) latestPaymentOut {
	t.Helper()
	var p latestPaymentOut
	if err := sh.db.QueryRowContext(t.Context(), `SELECT status, expires_at, updated_at FROM payments WHERE id = $1`, paymentID).
		Scan(&p.Status, &p.ExpiresAt, &p.UpdatedAt); err != nil {
		t.Fatalf("read payment %s: %v", paymentID, err)
	}
	return p
}

// assertLatestPayment fails unless got is the payment want, to the
// microsecond PostgreSQL keeps.
func assertLatestPayment(t *testing.T, got *latestPaymentOut, want latestPaymentOut, what string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s: latest_payment is null, want %+v", what, want)
	}
	same := func(a, b time.Time) bool { return a.Truncate(time.Microsecond).Equal(b.Truncate(time.Microsecond)) }
	if got.Status != want.Status || !same(got.ExpiresAt, want.ExpiresAt) || !same(got.UpdatedAt, want.UpdatedAt) {
		t.Errorf("%s: latest_payment %+v, want %+v", what, *got, want)
	}
}

// rawLatestPayment is the latest_payment of an OrderDetail body as sent.
func rawLatestPayment(t *testing.T, body []byte) string {
	t.Helper()
	var top struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &top); err != nil {
		t.Fatal(err)
	}
	raw, ok := top.Data["latest_payment"]
	if !ok {
		t.Fatalf("no latest_payment key in %s", body)
	}
	return string(raw)
}

// TestOrderLatestPayment_FollowsTheNewestPayment: GET /v1/orders/{id}
// (Bab 11 artikel 05) answers latest_payment null until the buyer starts
// paying (and always null in the checkout's answer); then the newest
// payment's status, expires_at and updated_at, as stored: pending after
// paying, denied after the gateway refuses it (with a newer updated_at),
// the second attempt once the buyer pays again, and paid after its
// settlement. Staff's GET /v1/admin/orders/{id} shows the same.
func TestOrderLatestPayment_FollowsTheNewestPayment(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-terakhir", variant("LP-M", "M", 40000, 10))
	b := ps.buyer(t, "terakhir")

	ps.add(t, b, p.Variants["LP-M"], 1)
	placed := ps.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID))
	o := assertOrderDetail(t, placed, http.StatusCreated, "checkout")
	if raw := rawLatestPayment(t, placed.Body); raw != "null" {
		t.Errorf("checkout answered latest_payment %s, want null", raw)
	}
	path := "/v1/orders/" + o.ID
	get := func(what string) orderOut {
		t.Helper()
		return assertOrderDetail(t, ps.call(t, http.MethodGet, path, nil, b.Token), http.StatusOK, what)
	}

	before := ps.call(t, http.MethodGet, path, nil, b.Token)
	assertOrderDetail(t, before, http.StatusOK, "GET before paying")
	if raw := rawLatestPayment(t, before.Body); raw != "null" {
		t.Errorf("before paying: latest_payment %s, want null", raw)
	}

	first := assertPaymentSession(t, ps.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
	pending := ps.latestPaymentRow(t, first.ID)
	if pending.Status != "pending" {
		t.Fatalf("payment %s after pay, want pending", pending.Status)
	}
	assertLatestPayment(t, get("GET after paying").LatestPayment, pending, "after paying")
	if got := get("GET after paying").LatestPayment; got != nil && !got.ExpiresAt.Equal(first.ExpiresAt) {
		t.Errorf("latest_payment.expires_at %s, want the payment session's %s", got.ExpiresAt, first.ExpiresAt)
	}

	assertOutcome(t, ps.gatewaySays(t, ps.providerOrderID(t, first.ID), "deny", ""), "recorded", "deny")
	denied := ps.latestPaymentRow(t, first.ID)
	if denied.Status != "denied" || !denied.UpdatedAt.After(pending.UpdatedAt) {
		t.Fatalf("payment after deny: %+v, want denied with an updated_at after %s", denied, pending.UpdatedAt)
	}
	afterDeny := get("GET after deny")
	if afterDeny.Status != "pending_payment" {
		t.Errorf("order %s after a denied payment, want pending_payment", afterDeny.Status)
	}
	assertLatestPayment(t, afterDeny.LatestPayment, denied, "after deny")

	second := assertPaymentSession(t, ps.pay(t, b.Token, o.ID), http.StatusCreated, "pay again")
	retry := ps.latestPaymentRow(t, second.ID)
	assertLatestPayment(t, get("GET after paying again").LatestPayment, retry, "after paying again")
	if retry.Status != "pending" || second.ID == first.ID {
		t.Errorf("second attempt %+v (%s), want a new pending payment", retry, second.ID)
	}

	assertOutcome(t, ps.gatewaySays(t, ps.providerOrderID(t, second.ID), "settlement", ""), "paid", "settlement")
	settled := ps.latestPaymentRow(t, second.ID)
	paid := get("GET after settlement")
	if paid.Status != "paid" || settled.Status != "paid" {
		t.Errorf("after settlement: order %s, payment %s, want both paid", paid.Status, settled.Status)
	}
	assertLatestPayment(t, paid.LatestPayment, settled, "after settlement")

	staff := assertOrderDetail(t, ps.staffCall(t, http.MethodGet, "/v1/admin/orders/"+o.ID, nil), http.StatusOK, "GET admin order")
	assertLatestPayment(t, staff.LatestPayment, settled, "admin order")

	// Another buyer still learns nothing about the order or its payments.
	other := ps.buyer(t, "terakhir-lain")
	assertError(t, ps.call(t, http.MethodGet, path, nil, other.Token), http.StatusNotFound, "NOT_FOUND")
	assertNoServerErrors(t, ps.server)
}
