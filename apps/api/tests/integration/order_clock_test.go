//go:build integration

package integration_test

import (
	"net/http"
	"os"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/order"
)

// frozenClock is a clock that stands still until the test moves it, so a
// test can name the exact time every write must carry. Keep it within a
// few minutes after the real time: access tokens are checked against both
// (docs/sdk-gaps.md).
type frozenClock struct{ at atomic.Int64 }

func (c *frozenClock) now() time.Time         { return time.Unix(0, c.at.Load()).UTC() }
func (c *frozenClock) set(t time.Time)        { c.at.Store(t.UnixNano()) }
func newFrozenClock(t time.Time) *frozenClock { c := &frozenClock{}; c.set(t); return c }

// TestOrders_FollowTheClock: every time an order carries comes from the
// API's clock (app.WithClock), not from the database's now(): created_at,
// updated_at and the line snapshots' created_at at checkout,
// payment_expires_at one APP_PAYMENT_TTL later, and paid_at, shipped_at,
// completed_at, cancelled_at and updated_at at each status change, the
// expiry job's included.
func TestOrders_FollowTheClock(t *testing.T) {
	t0 := time.Now().UTC().Truncate(time.Second)
	clk := newFrozenClock(t0)
	sh := newShop(t, nil, app.WithClock(clk.now))
	svc := order.NewService(order.Deps{Repo: order.NewPostgresRepository(sh.db), Clock: clk.now})
	p := sh.product(t, "kaos-jam", variant("JM-M", "M", 10000, 20))
	b := sh.buyer(t, "jam")
	at := func(minutes int) time.Time { return t0.Add(time.Duration(minutes) * time.Minute) }
	same := func(what string, got *time.Time, want time.Time) {
		t.Helper()
		if got == nil || !got.Equal(want) {
			t.Errorf("%s = %v, want %s", what, got, want)
		}
	}
	get := func(id string) orderOut {
		return assertOrderDetail(t, sh.staffCall(t, http.MethodGet, "/v1/admin/orders/"+id, nil), http.StatusOK, "GET order")
	}

	clk.set(at(1))
	o := sh.order(t, b, line{p.Variants["JM-M"], 1})
	same("created_at", &o.CreatedAt, at(1))
	same("updated_at", &o.UpdatedAt, at(1))
	same("payment_expires_at", &o.PaymentExpiresAt, at(1).Add(order.DefaultPaymentTTL))
	if n := sh.count(t, `SELECT count(*) FROM order_items WHERE order_id = $1 AND created_at = $2`, o.ID, at(1)); n != 1 {
		t.Errorf("order_items.created_at is not the clock's %s", at(1))
	}

	clk.set(at(2))
	if err := svc.MarkPaid(t.Context(), o.ID); err != nil {
		t.Fatal(err)
	}
	got := get(o.ID)
	same("paid_at", got.PaidAt, at(2))
	same("updated_at after paid", &got.UpdatedAt, at(2))

	clk.set(at(3))
	got = assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/process", nil), http.StatusOK, "process")
	same("updated_at after processing", &got.UpdatedAt, at(3))

	clk.set(at(4))
	got = assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/ship", map[string]any{"tracking_number": "JNE0001112"}),
		http.StatusOK, "ship")
	same("shipped_at", got.ShippedAt, at(4))
	same("updated_at after shipping", &got.UpdatedAt, at(4))

	clk.set(at(5))
	got = assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/complete", nil, b.Token), http.StatusOK, "complete")
	same("completed_at", got.CompletedAt, at(5))
	same("updated_at after completing", &got.UpdatedAt, at(5))
	same("created_at kept", &got.CreatedAt, at(1))

	clk.set(at(6))
	c := sh.order(t, b, line{p.Variants["JM-M"], 1})
	clk.set(at(7))
	got = assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+c.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	same("cancelled_at", got.CancelledAt, at(7))
	same("updated_at after cancelling", &got.UpdatedAt, at(7))

	// Expiry: the job's clock past the deadline. Checked in SQL, since
	// the access tokens would not survive a clock a day ahead.
	clk.set(at(8))
	e := sh.order(t, b, line{p.Variants["JM-M"], 1})
	late := at(8).Add(order.DefaultPaymentTTL).Add(time.Minute)
	expireClock := newFrozenClock(late)
	if n, err := order.NewService(order.Deps{Repo: order.NewPostgresRepository(sh.db), Clock: expireClock.now}).ExpireDue(t.Context()); err != nil || n != 1 {
		t.Fatalf("ExpireDue = %d, %v; want 1", n, err)
	}
	if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND status = 'cancelled' AND cancel_reason = 'payment_expired'
		AND cancelled_at = $2 AND updated_at = $2 AND created_at = $3`, e.ID, late, at(8)); n != 1 {
		t.Errorf("the expired order's times are not the job's clock %s", late)
	}
}

// contractResponse is the components/responses name a path's operation
// answers status with, read from api/openapi.yaml like contractSchema.
func contractResponse(t *testing.T, path, method, status string) string {
	t.Helper()
	raw, err := os.ReadFile(openAPIPath)
	if err != nil {
		t.Fatalf("read the contract: %v", err)
	}
	lines := strings.Split(string(raw), "\n")
	start := slices.Index(lines, "  "+path+":")
	if start < 0 {
		t.Fatalf("path %s not in the contract", path)
	}
	inMethod, inStatus := false, false
	for _, line := range lines[start+1:] {
		if strings.HasPrefix(line, "  /") || (strings.TrimSpace(line) != "" && !strings.HasPrefix(line, "  ")) {
			break
		}
		text := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "     "):
			inMethod = text == method+":"
		case inMethod && text == `"`+status+`":`:
			inStatus = true
		case inStatus:
			if ref, ok := strings.CutPrefix(text, `$ref: "#/components/responses/`); ok {
				return strings.TrimSuffix(ref, `"`)
			}
			return ""
		}
	}
	return ""
}

// TestAdminShip_BadTracking: POST /v1/admin/orders/{id}/ship with a bad
// airway bill is the contract's generic ValidationFailed: 400
// VALIDATION_FAILED, the Error schema, details naming tracking_number.
func TestAdminShip_BadTracking(t *testing.T) {
	if got := contractResponse(t, "/v1/admin/orders/{id}/ship", "post", "400"); got != "ValidationFailed" {
		t.Fatalf("the contract answers the ship 400 with %q, want ValidationFailed", got)
	}
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-resi", variant("RS-M", "M", 10000, 5))
	b := sh.buyer(t, "resi")
	o := sh.order(t, b, line{p.Variants["RS-M"], 1})
	sh.markPaid(t, o.ID)
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/process", nil), http.StatusOK, "process")
	for _, body := range []any{map[string]any{"tracking_number": "ab"}, map[string]any{}, `{"tracking_number":"JNE 1"}`} {
		details := assertErrorDetails(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/ship", body),
			http.StatusBadRequest, "VALIDATION_FAILED")
		if msg, _ := details["tracking_number"].(string); !strings.Contains(msg, "airway bill") || len(details) != 1 {
			t.Errorf("details = %v, want only tracking_number", details)
		}
	}
	if got := sh.events(t, o.ID); slices.Contains(got, "order.shipped") {
		t.Error("a refused ship recorded order.shipped")
	}
	// An unknown field is the same 400, under body.
	details := assertErrorDetails(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/ship",
		`{"tracking_number":"JNE123456","kurir":"jne"}`), http.StatusBadRequest, "VALIDATION_FAILED")
	if _, ok := details["body"]; !ok {
		t.Errorf("details = %v, want body", details)
	}
}
