//go:build integration

package integration_test

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/adminevents"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The admin dashboard's live feed (Bab 12 artikel 09, ADR 0009) end to
// end: an order changes, the change is an outbox event, `api
// publish-events` (the worker's dispatcher, run once) publishes it to Redis,
// and an open GET /v1/admin/events stream writes it as an SSE frame.

// sseEvent is one event of a stream: its fields, or the comment of a
// comment-only block.
type sseEvent struct {
	ID, Event, Data, Comment string
}

// eventStream is an open GET /v1/admin/events.
type eventStream struct {
	resp   *http.Response
	events chan sseEvent
	// close cancels the request and closes the body; the test's cleanup
	// calls it too, so a stream the test leaves open is still closed.
	close func()
}

// openEvents opens the stream with token. The response is checked by the
// caller; events delivers each event block until the stream closes, when
// it is closed.
func (s *server) openEvents(t *testing.T, token string) *eventStream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.URL+"/v1/admin/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	// No client timeout: the stream stays open.
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		cancel()
		t.Fatalf("GET /v1/admin/events: %v", err)
	}
	closeStream := func() {
		cancel()
		_ = resp.Body.Close()
	}
	t.Cleanup(closeStream)
	es := &eventStream{resp: resp, events: make(chan sseEvent, 64), close: closeStream}
	if resp.StatusCode != http.StatusOK {
		close(es.events)
		return es
	}
	go func() {
		defer close(es.events)
		sc := bufio.NewScanner(resp.Body)
		var e sseEvent
		for sc.Scan() {
			line := sc.Text()
			if line == "" {
				es.events <- e
				e = sseEvent{}
				continue
			}
			field, value, _ := strings.Cut(line, ":")
			value = strings.TrimPrefix(value, " ")
			switch field {
			case "":
				e.Comment = value
			case "id":
				e.ID = value
			case "event":
				e.Event = value
			case "data":
				e.Data = value
			}
		}
	}()
	return es
}

// next is the next event, failing the test after wait.
func (es *eventStream) next(t *testing.T, wait time.Duration) (sseEvent, bool) {
	t.Helper()
	select {
	case e, ok := <-es.events:
		return e, ok
	case <-time.After(wait):
		t.Fatalf("no event within %s", wait)
		return sseEvent{}, false
	}
}

// orderEvents reads order events until it has n of orderID's (events of
// other orders, which other tests' dispatchers publish on the same Redis
// channel, are skipped) and returns them.
func (es *eventStream) orderEvents(t *testing.T, orderID string, n int) []sseEvent {
	t.Helper()
	var out []sseEvent
	deadline := time.Now().Add(20 * time.Second)
	for len(out) < n {
		e, ok := es.next(t, time.Until(deadline))
		if !ok {
			t.Fatalf("the stream closed after %d of %d events", len(out), n)
		}
		if e.Event == adminevents.EventOrder && strings.Contains(e.Data, `"order_id":"`+orderID+`"`) {
			out = append(out, e)
		}
	}
	return out
}

// TestAdminEvents_OrderReachesTheStream: an order is placed and paid while
// a seller's stream is open; after the dispatcher runs, the stream carries
// order.created and order.paid with the outbox event IDs, the order's code,
// status and total, and nothing about the buyer.
func TestAdminEvents_OrderReachesTheStream(t *testing.T) {
	sh := newShop(t, nil)
	seller := sh.accountWithRole(t, user.RoleSeller).AccessToken
	es := sh.openEvents(t, seller)
	if es.resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/admin/events = %d", es.resp.StatusCode)
	}
	h := es.resp.Header
	if !strings.HasPrefix(h.Get("Content-Type"), "text/event-stream") || h.Get("X-Accel-Buffering") != "no" ||
		h.Get("Cache-Control") != "no-store" {
		t.Errorf("headers: Content-Type %q, X-Accel-Buffering %q, Cache-Control %q",
			h.Get("Content-Type"), h.Get("X-Accel-Buffering"), h.Get("Cache-Control"))
	}
	if first, _ := es.next(t, 5*time.Second); first.Comment != "connected" {
		t.Fatalf("first block = %+v, want the comment connected", first)
	}

	p := sh.product(t, "kaos-siaran", variant("SR-M", "M", 50000, 10))
	b := sh.buyer(t, "siaran")
	o := sh.order(t, b, line{p.Variants["SR-M"], 2})
	sh.markPaid(t, o.ID)
	ids := queryStrings(t, sh.db, `SELECT id::text FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at, id`, o.ID)
	if logs := runCommand(t, "publish-events"); !strings.Contains(logs, "published=2") {
		t.Fatalf("publish-events logged:\n%s", logs)
	}

	events := es.orderEvents(t, o.ID, 2)
	for i, want := range []struct{ typ, status string }{{"order.created", "pending_payment"}, {"order.paid", "paid"}} {
		e := events[i]
		if e.ID != ids[i] {
			t.Errorf("event %d id = %q, want the outbox event %s", i, e.ID, ids[i])
		}
		obj := decodeObject(t, []byte(e.Data))
		assertMatchesSchema(t, obj, contractSchema(t, "AdminOrderEvent"), "event data")
		assertTimestamp(t, obj["occurred_at"], "occurred_at")
		var data struct {
			Type    string   `json:"type"`
			OrderID string   `json:"order_id"`
			Code    string   `json:"code"`
			Status  string   `json:"status"`
			Total   moneyOut `json:"total"`
		}
		if err := json.Unmarshal([]byte(e.Data), &data); err != nil {
			t.Fatal(err)
		}
		if data.Type != want.typ || data.Status != want.status || data.Code != o.Code || data.Total != o.Totals.Total {
			t.Errorf("event %d = %+v, want %s %s %s %+v", i, data, want.typ, want.status, o.Code, o.Totals.Total)
		}
		for _, buyerData := range []string{b.ID, b.Email, "user_id", "recipient", "address", "phone"} {
			if strings.Contains(e.Data, buyerData) {
				t.Errorf("event %d carries buyer data %q: %s", i, buyerData, e.Data)
			}
		}
	}

	// A status change by staff arrives too, once the dispatcher runs.
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+o.ID+"/process", nil), http.StatusOK, "process")
	runCommand(t, "publish-events")
	if e := es.orderEvents(t, o.ID, 1)[0]; !strings.Contains(e.Data, `"type":"order.processing"`) {
		t.Errorf("after process: %+v", e)
	}
}

// TestAdminEvents_Access: the stream is for staff only, and at most
// MaxStreamsPerUser per account.
func TestAdminEvents_Access(t *testing.T) {
	sh := newShop(t, nil)
	if es := sh.openEvents(t, ""); es.resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without a token = %d, want 401", es.resp.StatusCode)
	}
	_, buyer := sh.newAccount(t, "siaran-pembeli")
	if es := sh.openEvents(t, buyer.AccessToken); es.resp.StatusCode != http.StatusForbidden {
		t.Errorf("a buyer = %d, want 403", es.resp.StatusCode)
	}

	var open []*eventStream
	for i := range adminevents.MaxStreamsPerUser {
		es := sh.openEvents(t, sh.staff)
		if es.resp.StatusCode != http.StatusOK {
			t.Fatalf("stream %d = %d, want 200", i+1, es.resp.StatusCode)
		}
		open = append(open, es)
	}
	over := sh.openEvents(t, sh.staff)
	if over.resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("stream %d = %d, want 429", adminevents.MaxStreamsPerUser+1, over.resp.StatusCode)
	}
	// Another account has streams of its own.
	if es := sh.openEvents(t, sh.accountWithRole(t, user.RoleAdmin).AccessToken); es.resp.StatusCode != http.StatusOK {
		t.Errorf("another admin = %d, want 200", es.resp.StatusCode)
	}
	// Closing one frees its place.
	open[0].close()
	deadline := time.Now().Add(10 * time.Second)
	for {
		es := sh.openEvents(t, sh.staff)
		if es.resp.StatusCode == http.StatusOK {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("a closed stream's place was not given back: %d", es.resp.StatusCode)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// TestAdminEvents_TokenExpired: a stream ends with event end and reason
// token_expired when the access token it was opened with expires.
func TestAdminEvents_TokenExpired(t *testing.T) {
	clock := &testClock{}
	sh := newShop(t, nil, withClock(clock))
	token := sh.accountWithRole(t, user.RoleSeller).AccessToken
	// The token was issued for 15 minutes; two seconds of it are left.
	clock.advance(15*time.Minute - 2*time.Second)
	es := sh.openEvents(t, token)
	if es.resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/admin/events = %d", es.resp.StatusCode)
	}
	started := time.Now()
	var last sseEvent
	for {
		e, ok := es.next(t, 15*time.Second)
		if !ok {
			break
		}
		last = e
	}
	if last.Event != "end" || last.Data != `{"reason":"token_expired"}` {
		t.Errorf("the stream ended with %+v, want event end with reason token_expired", last)
	}
	if d := time.Since(started); d > 10*time.Second {
		t.Errorf("the stream ended after %s, want about 2 s", d)
	}
	// The expired token opens no new stream.
	clock.advance(5 * time.Second)
	if again := sh.openEvents(t, token); again.resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("reopening with the expired token = %d, want 401", again.resp.StatusCode)
	}
}
