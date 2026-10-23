//go:build integration

package integration_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// assertTransitionRefused fails unless resp is 409 INVALID_TRANSITION
// naming the current status and the wanted one.
func assertTransitionRefused(t *testing.T, resp response, status, to string) {
	t.Helper()
	details := assertError(t, resp, http.StatusConflict, "INVALID_TRANSITION")
	if details["status"] != status || details["to"] != to {
		t.Errorf("details = %v, want status %s to %s", details, status, to)
	}
}

// TestOrderStatus_HappyPath moves an order through its whole life on the
// real routes: paid (Bab 6's webhook, here the service), processing and
// shipped by staff, completed by the buyer. Each step answers the order
// with the timestamps its status needs, and records its event.
func TestOrderStatus_HappyPath(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-alur", variant("AL-M", "M", 50000, 5))
	b := sh.buyer(t, "alur")
	o := sh.order(t, b, line{p.Variants["AL-M"], 2})
	path := "/v1/admin/orders/" + o.ID

	sh.markPaid(t, o.ID)
	paid := assertOrderDetail(t, sh.staffCall(t, http.MethodGet, path, nil), http.StatusOK, "GET admin order")
	if paid.Status != "paid" || paid.PaidAt == nil {
		t.Errorf("after MarkPaid: %s, paid_at %v", paid.Status, paid.PaidAt)
	}
	if got := assertOrderDetail(t, sh.staffCall(t, http.MethodPost, path+"/process", nil), http.StatusOK, "process"); got.Status != "processing" {
		t.Errorf("process → %s", got.Status)
	}
	for _, bad := range []string{"", "AB-1", "JNE 123", strings.Repeat("A", 41)} {
		details := assertError(t, sh.staffCall(t, http.MethodPost, path+"/ship", map[string]any{"tracking_number": bad}),
			http.StatusBadRequest, "VALIDATION_FAILED")
		if _, ok := details["tracking_number"]; !ok {
			t.Errorf("tracking %q: details %v", bad, details)
		}
	}
	shipped := assertOrderDetail(t, sh.staffCall(t, http.MethodPost, path+"/ship", map[string]any{"tracking_number": "  jne0123456789 "}),
		http.StatusOK, "ship")
	if shipped.Status != "shipped" || shipped.ShippedAt == nil || shipped.Shipping.TrackingNumber == nil || *shipped.Shipping.TrackingNumber != "JNE0123456789" {
		t.Errorf("after ship: %+v", shipped)
	}
	done := assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/complete", nil, b.Token), http.StatusOK, "buyer complete")
	if done.Status != "completed" || done.CompletedAt == nil {
		t.Errorf("after complete: %+v", done)
	}
	sh.assertEvents(t, o.ID, "order.created", "order.paid", "order.processing", "order.shipped", "order.completed")
	if s := sh.stock(t, p.Variants["AL-M"]); s != 3 {
		t.Errorf("stock = %d, want 3: only a cancel gives stock back", s)
	}
	assertNoErrorLog(t, sh.server)
}

// TestOrderStatus_Refusals: every move the table of ADR 0006 forbids is
// 409 INVALID_TRANSITION with the current and the wanted status, and
// changes nothing; a buyer may cancel only while unpaid.
func TestOrderStatus_Refusals(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-larang", variant("LR-M", "M", 50000, 50))
	m := p.Variants["LR-M"]
	b := sh.buyer(t, "larang")
	pending := sh.order(t, b, line{m, 1})
	paid := sh.order(t, b, line{m, 1})
	sh.markPaid(t, paid.ID)
	shipped := sh.order(t, b, line{m, 1})
	sh.markPaid(t, shipped.ID)
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+shipped.ID+"/process", nil), http.StatusOK, "process")
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+shipped.ID+"/ship", map[string]any{"tracking_number": "JNE000111"}), http.StatusOK, "ship")

	buyer := func(id, move string) response {
		return sh.call(t, http.MethodPost, "/v1/orders/"+id+"/"+move, nil, b.Token)
	}
	staff := func(id, move string) response {
		var body any
		if move == "ship" {
			body = map[string]any{"tracking_number": "JNE999999"}
		}
		return sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+id+"/"+move, body)
	}
	assertTransitionRefused(t, buyer(pending.ID, "complete"), "pending_payment", "completed")
	assertTransitionRefused(t, buyer(paid.ID, "cancel"), "paid", "cancelled")
	assertTransitionRefused(t, buyer(shipped.ID, "cancel"), "shipped", "cancelled")
	assertTransitionRefused(t, staff(pending.ID, "process"), "pending_payment", "processing")
	assertTransitionRefused(t, staff(pending.ID, "ship"), "pending_payment", "shipped")
	assertTransitionRefused(t, staff(paid.ID, "ship"), "paid", "shipped")
	assertTransitionRefused(t, staff(paid.ID, "complete"), "paid", "completed")
	assertTransitionRefused(t, staff(shipped.ID, "cancel"), "shipped", "cancelled")
	assertTransitionRefused(t, staff(shipped.ID, "process"), "shipped", "processing")

	// The first cancel succeeds, a second one is refused and gives
	// nothing back twice.
	assertOrderDetail(t, buyer(pending.ID, "cancel"), http.StatusOK, "cancel")
	assertTransitionRefused(t, buyer(pending.ID, "cancel"), "cancelled", "cancelled")
	assertTransitionRefused(t, staff(pending.ID, "cancel"), "cancelled", "cancelled")
	if s := sh.stock(t, m); s != 48 {
		t.Errorf("stock = %d, want 50 - 3 + 1", s)
	}
	sh.assertEvents(t, pending.ID, "order.created", "order.cancelled")
	sh.assertEvents(t, paid.ID, "order.created", "order.paid")
	assertNoErrorLog(t, sh.server)
}

// TestOrderStatus_StaffCancel: a seller cancels before shipping, from
// every status that allows it (seller_cancelled), and each cancel gives the
// stock and the voucher use back once.
func TestOrderStatus_StaffCancel(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-batal", variant("BL-M", "M", 50000, 30))
	m := p.Variants["BL-M"]
	vid := sh.voucher(t, voucherSpec{code: "BATAL5", kind: "fixed", value: 5000, perUser: 9})
	seller := sh.accountWithRole(t, user.RoleSeller).AccessToken
	b := sh.buyer(t, "batal")

	for _, from := range []string{"pending_payment", "paid", "processing"} {
		t.Run(from, func(t *testing.T) {
			sh.add(t, b, m, 2)
			o := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), "BATAL5")),
				http.StatusCreated, "checkout")
			if from != "pending_payment" {
				sh.markPaid(t, o.ID)
			}
			if from == "processing" {
				assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/process", nil, seller), http.StatusOK, "process")
			}
			stock, used := sh.stock(t, m), sh.usedCount(t, vid)
			got := assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/cancel", nil, seller), http.StatusOK, "seller cancel")
			if got.Status != "cancelled" || got.CancelReason == nil || *got.CancelReason != "seller_cancelled" || got.CancelledAt == nil {
				t.Errorf("after the seller's cancel: %+v", got)
			}
			if sh.stock(t, m) != stock+2 || sh.usedCount(t, vid) != used-1 {
				t.Errorf("stock %d → %d, used_count %d → %d; want +2 and -1", stock, sh.stock(t, m), used, sh.usedCount(t, vid))
			}
			if events := sh.events(t, o.ID); events[len(events)-1] != "order.cancelled" {
				t.Errorf("events = %v, want order.cancelled last", events)
			}
		})
	}
	if s := sh.stock(t, m); s != 30 {
		t.Errorf("stock = %d after every cancel, want 30", s)
	}
}

// TestAdminOrders_Access: the staff routes need a seller or an admin
// (403 for a buyer, 401 without a login); unknown and malformed ids are
// 404; the queue lists one status, paid by default, newest first, with a
// cursor.
func TestAdminOrders_Access(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-antrean", variant("AT-M", "M", 10000, 50))
	b := sh.buyer(t, "antrean")
	var ids []string
	for range 5 {
		o := sh.order(t, b, line{p.Variants["AT-M"], 1})
		sh.markPaid(t, o.ID)
		ids = append(ids, o.ID)
	}
	pending := sh.order(t, b, line{p.Variants["AT-M"], 1})

	assertError(t, sh.call(t, http.MethodGet, "/v1/admin/orders", nil, b.Token), http.StatusForbidden, "FORBIDDEN")
	assertError(t, sh.call(t, http.MethodPost, "/v1/admin/orders/"+ids[0]+"/process", nil, b.Token), http.StatusForbidden, "FORBIDDEN")
	assertUnauthorizedBearer(t, sh.call(t, http.MethodGet, "/v1/admin/orders/"+ids[0], nil, ""), "admin order without a login")
	for _, id := range []string{uuidx.NewV7(), "bukan-uuid"} {
		assertError(t, sh.staffCall(t, http.MethodGet, "/v1/admin/orders/"+id, nil), http.StatusNotFound, "NOT_FOUND")
		assertError(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+id+"/process", nil), http.StatusNotFound, "NOT_FOUND")
	}
	assertError(t, sh.staffCall(t, http.MethodGet, "/v1/admin/orders?status=hilang", nil), http.StatusBadRequest, "VALIDATION_FAILED")

	var seen []string
	cursor := ""
	for page := 0; ; page++ {
		path := "/v1/admin/orders?limit=2"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		list, next := assertOrderList(t, sh.staffCall(t, http.MethodGet, path, nil), "GET /v1/admin/orders")
		for _, o := range list {
			if o.Status != "paid" {
				t.Errorf("the default queue lists a %s order", o.Status)
			}
			seen = append(seen, o.ID)
		}
		if next == "" || page > 5 {
			break
		}
		cursor = next
	}
	want := []string{ids[4], ids[3], ids[2], ids[1], ids[0]}
	if strings.Join(seen, ",") != strings.Join(want, ",") {
		t.Errorf("paid queue = %v, want newest first %v", seen, want)
	}
	list, _ := assertOrderList(t, sh.staffCall(t, http.MethodGet, "/v1/admin/orders?status=pending_payment", nil), "pending queue")
	if len(list) != 1 || list[0].ID != pending.ID {
		t.Errorf("pending queue = %+v", list)
	}
	assertNoErrorLog(t, sh.server)
}
