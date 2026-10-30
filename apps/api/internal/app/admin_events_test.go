package app_test

// Bab 12 artikel-09: the admin's live event stream as app.New wires it,
// its end on shutdown, and EventPublisher.

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/adminevents"
	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// GET /v1/admin/events is for staff. HEAD answers the stream's headers
// without subscribing.
func TestApp_AdminEventsNeedStaff(t *testing.T) {
	h := staffHandler(t)
	tests := []struct {
		name, method, auth string
		status             int
		code               string
	}{
		{name: "anonymous", method: http.MethodGet, status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "a broken token", method: http.MethodGet, auth: "Bearer nope", status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "buyer", method: http.MethodGet, auth: bearer(t, user.RoleBuyer, "s1"), status: http.StatusForbidden, code: "FORBIDDEN"},
		{name: "seller", method: http.MethodHead, auth: bearer(t, user.RoleSeller, "s1"), status: http.StatusOK},
		{name: "admin", method: http.MethodHead, auth: bearer(t, user.RoleAdmin, "s1"), status: http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, code := call(t, h, tt.method, "/v1/admin/events", tt.auth, "")
			testx.AssertEqual(t, rec.Code, tt.status, "body %s", rec.Body.String())
			testx.AssertEqual(t, code, tt.code)
			if tt.status == http.StatusOK {
				testx.AssertEqual(t, rec.Header().Get("Content-Type"), "text/event-stream")
				testx.AssertTrue(t, rec.Header().Get("X-Request-ID") != "", "the stream gets the middleware chain")
			}
		})
	}
	// The revoked-session check of the guard applies too.
	rev := &memRevocations{revoked: map[string]bool{"ended": true}}
	h = app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t), app.WithSessionRevocations(rev)).Handler()
	rec, code := call(t, h, http.MethodHead, "/v1/admin/events", bearer(t, user.RoleSeller, "ended"), "")
	testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
	testx.AssertEqual(t, code, "UNAUTHORIZED")
}

// Serve ends every open event stream when it shuts down, with an end
// event, instead of waiting for it until APP_SHUTDOWN_TIMEOUT and then
// cutting it off.
func TestApp_ServeEndsEventStreamsOnShutdown(t *testing.T) {
	cfg := testConfig(config.EnvProduction)
	cfg.ShutdownTimeout = 5 * time.Second // long, so a stream left open would show
	a := app.New(cfg, logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}}))
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	testx.AssertNoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.Serve(ctx, ln) }()
	waitHealthy(t, ln.Addr().(*net.TCPAddr).Port)

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://"+ln.Addr().String()+"/v1/admin/events", nil)
	testx.AssertNoError(t, err)
	req.Header.Set("Authorization", bearer(t, user.RoleSeller, "s1"))
	resp, err := http.DefaultClient.Do(req)
	testx.AssertNoError(t, err)
	defer func() { _ = resp.Body.Close() }()
	testx.AssertEqual(t, resp.StatusCode, http.StatusOK)
	testx.AssertEqual(t, resp.Header.Get("Content-Type"), "text/event-stream")
	body := bufio.NewReader(resp.Body)
	testx.AssertEqual(t, readFrame(t, body), ": connected\n\n")

	started := time.Now()
	cancel()
	testx.AssertEqual(t, readFrame(t, body), "event: end\ndata: {\"reason\":\"shutdown\"}\n\n")
	select {
	case err := <-done:
		testx.AssertNoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return after cancel")
	}
	testx.AssertTrue(t, time.Since(started) < cfg.ShutdownTimeout, "the shutdown did not wait for the stream")
}

// readFrame reads one SSE frame, up to and including the blank line.
func readFrame(t *testing.T, r *bufio.Reader) string {
	t.Helper()
	got := make(chan string, 1)
	go func() {
		var b strings.Builder
		for {
			line, err := r.ReadString('\n')
			b.WriteString(line)
			if err != nil || line == "\n" {
				got <- b.String()
				return
			}
		}
	}()
	select {
	case f := <-got:
		return f
	case <-time.After(5 * time.Second):
		t.Fatal("no frame from the stream")
		return ""
	}
}

// EventPublisher sends each event to the worker's queue first and then to
// the admin feed.
func TestEventPublisher(t *testing.T) {
	f := newFakeRedis(t)
	rdb := redis.NewClient(&redis.Options{Addr: f.addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = rdb.Close() })

	p := app.EventPublisher(testConfig(config.EnvProduction), rdb)
	ps, ok := p.(outbox.Publishers)
	testx.AssertTrue(t, ok, "a %T", p)
	testx.AssertEqual(t, len(ps), 2)
	_, queueFirst := ps[0].(*notify.QueuePublisher)
	testx.AssertTrue(t, queueFirst, "the task queue first: %T", ps[0])
	_, feedSecond := ps[1].(*adminevents.Publisher)
	testx.AssertTrue(t, feedSecond, "then the admin feed: %T", ps[1])

	// An order event no task is routed for still reaches the feed.
	payload, err := json.Marshal(map[string]any{
		"order_id": "0190c8a0-0000-7000-8000-0000000000d1", "code": "GS-1", "status": "processing",
		"total": 1000, "currency": "IDR", "occurred_at": "2026-10-30T00:00:00Z",
	})
	testx.AssertNoError(t, err)
	err = p.Publish(context.Background(), outbox.Event{
		ID: "e-1", AggregateType: "order", AggregateID: "o-1", Type: "order.processing", Payload: payload,
	})
	testx.AssertNoError(t, err)
	f.mu.Lock()
	commands := strings.Join(f.commands, "\n")
	f.mu.Unlock()
	testx.AssertContains(t, commands, "PUBLISH "+adminevents.Channel+` {"id":"e-1","event":"order","data":{"type":"order.processing"`)
}
