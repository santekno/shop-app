//go:build integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// TestOutbox_EventPerChange: every status change writes exactly one event
// in its own transaction, with the order's state after the change; a
// refused change and a refused checkout write none.
func TestOutbox_EventPerChange(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-peristiwa", variant("PW-M", "M", 10000, 10))
	m := p.Variants["PW-M"]
	b := sh.buyer(t, "peristiwa")
	o := sh.order(t, b, line{m, 1})
	c := sh.order(t, b, line{m, 1})
	sh.markPaid(t, o.ID)
	path := "/v1/admin/orders/" + o.ID
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, path+"/process", nil), http.StatusOK, "process")
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, path+"/ship", map[string]any{"tracking_number": "SCP123456"}), http.StatusOK, "ship")
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, path+"/complete", nil), http.StatusOK, "staff complete")
	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+c.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")

	before := sh.count(t, `SELECT count(*) FROM outbox_events`)
	assertTransitionRefused(t, sh.staffCall(t, http.MethodPost, path+"/cancel", nil), "completed", "cancelled")
	assertTransitionRefused(t, sh.call(t, http.MethodPost, "/v1/orders/"+c.ID+"/cancel", nil, b.Token), "cancelled", "cancelled")
	sh.add(t, b, m, 1)
	mustExec(t, sh.db, `UPDATE product_variants SET stock = 0 WHERE id = $1`, m)
	assertCheckoutProblems(t, sh.checkout(t, b.Token, "kunci-gagal", checkoutBody(b.AddressID)), "checkout without stock")
	if after := sh.count(t, `SELECT count(*) FROM outbox_events`); after != before {
		t.Errorf("refused changes wrote %d events", after-before)
	}

	sh.assertEvents(t, o.ID, "order.created", "order.paid", "order.processing", "order.shipped", "order.completed")
	sh.assertEvents(t, c.ID, "order.created", "order.cancelled")
	type payload struct {
		OrderID      string  `json:"order_id"`
		Code         string  `json:"code"`
		UserID       string  `json:"user_id"`
		Status       string  `json:"status"`
		CancelReason *string `json:"cancel_reason"`
		Total        int64   `json:"total"`
		Currency     string  `json:"currency"`
		OccurredAt   string  `json:"occurred_at"`
	}
	rows := queryStrings(t, sh.db, `SELECT event_type || ' ' || payload::text FROM outbox_events
		WHERE aggregate_type = 'order' ORDER BY created_at, id`)
	for _, row := range rows {
		typ, raw, _ := strings.Cut(row, " ")
		var pl payload
		if err := json.Unmarshal([]byte(raw), &pl); err != nil {
			t.Fatalf("payload of %s: %v", typ, err)
		}
		want := strings.TrimPrefix(typ, "order.")
		if want == "created" {
			want = "pending_payment"
		}
		if pl.Status != want || pl.UserID != b.ID || pl.Currency != "IDR" || pl.Total != 20000 || pl.OccurredAt == "" ||
			(pl.OrderID != o.ID && pl.OrderID != c.ID) || !orderCode.MatchString(pl.Code) {
			t.Errorf("%s payload = %+v", typ, pl)
		}
		if (typ == "order.cancelled") != (pl.CancelReason != nil) {
			t.Errorf("%s payload cancel_reason = %v", typ, pl.CancelReason)
		}
	}
}

// TestPublishEvents_Command runs `api publish-events` for real: every
// pending event is written to the log with its id and marked published,
// oldest first; a second run publishes nothing; a later event is published
// by the next run alone.
func TestPublishEvents_Command(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-terbit", variant("TB-M", "M", 10000, 10))
	b := sh.buyer(t, "terbit")
	var orders []orderOut
	for range 3 {
		orders = append(orders, sh.order(t, b, line{p.Variants["TB-M"], 1}))
	}
	sh.markPaid(t, orders[0].ID)
	ids := queryStrings(t, sh.db, `SELECT id::text FROM outbox_events ORDER BY created_at, id`)

	logs := runCommand(t, "publish-events")
	if !strings.Contains(logs, "published domain events") || !strings.Contains(logs, fmt.Sprintf("published=%d", len(ids))) {
		t.Errorf("publish-events logged:\n%s", logs)
	}
	last := -1
	for _, id := range ids {
		at := strings.Index(logs, id)
		if at < 0 {
			t.Errorf("event %s was not published to the log", id)
		}
		if at < last {
			t.Errorf("event %s was published out of order", id)
		}
		last = at
	}
	if n := sh.count(t, `SELECT count(*) FROM outbox_events WHERE published_at IS NULL`); n != 0 {
		t.Errorf("%d events still unpublished", n)
	}
	if logs := runCommand(t, "publish-events"); !strings.Contains(logs, "published=0") {
		t.Errorf("a second run logged:\n%s", logs)
	}

	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+orders[1].ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	logs = runCommand(t, "publish-events")
	if !strings.Contains(logs, "published=1") || !strings.Contains(logs, "order.cancelled") {
		t.Errorf("the run after one more change logged:\n%s", logs)
	}
}
