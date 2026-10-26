//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/redisconn"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// TestOutboxQueue_TasksPerEvent publishes the outbox through the real
// QueuePublisher into Redis (no worker running, so the tasks wait there):
// each event becomes one task per consumer, with the task id
// "<event id>:<task type>" and the event as its payload; order.cancelled
// has no consumer and is published as it is. Publishing the same events
// again (a dispatcher that died before its commit) adds no task.
func TestOutboxQueue_TasksPerEvent(t *testing.T) {
	ps := newPayShop(t, nil)
	client := asynq.NewClientFromRedisClient(ps.rdb)
	t.Cleanup(func() { _ = client.Close() })
	inspector := asynq.NewInspectorFromRedisClient(ps.rdb)
	publisher := notify.NewQueuePublisher(client, notify.NewRoutes(true))
	p := ps.product(t, "kaos-antrean", variant("AT-M", "M", 45000, 10))
	b := ps.buyer(t, "antrean")
	paid, _, poid := ps.paid(t, b, line{p.Variants["AT-M"], 1})
	assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "paid", "settlement")
	assertOrderDetail(t, ps.staffCall(t, http.MethodPost, "/v1/admin/orders/"+paid.ID+"/process", nil), http.StatusOK, "process")
	assertOrderDetail(t, ps.staffCall(t, http.MethodPost, "/v1/admin/orders/"+paid.ID+"/ship",
		map[string]string{"tracking_number": "JNT-0987654321"}), http.StatusOK, "ship")
	cancelled := ps.order(t, b, line{p.Variants["AT-M"], 1})
	assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+cancelled.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")

	type event struct{ id, typ, aggregate string }
	var events []event
	for _, row := range queryStrings(t, ps.db, `SELECT id::text || ' ' || event_type || ' ' || aggregate_id::text
		FROM outbox_events ORDER BY created_at, id`) {
		f := strings.Fields(row)
		events = append(events, event{id: f[0], typ: f[1], aggregate: f[2]})
	}
	want := map[string]string{} // task id → aggregate
	for _, e := range events {
		for _, task := range notify.NewRoutes(true)[e.typ] {
			want[e.id+":"+task] = e.aggregate
		}
	}
	// created ×2, paid ×2 (email and Telegram), shipped; cancelled none.
	if len(events) != 6 || len(want) != 5 {
		t.Fatalf("%d events making %d tasks, want 6 and 5: %v", len(events), len(want), events)
	}

	for round := range 2 {
		n, err := outbox.NewDispatcher(ps.db, publisher).PublishPending(t.Context())
		if err != nil || n != len(events) {
			t.Fatalf("round %d: PublishPending = %d, %v; want %d", round, n, err, len(events))
		}
		pending, err := inspector.ListPendingTasks(worker.Queue, asynq.PageSize(100))
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]string{}
		for _, task := range pending {
			var payload notify.EventPayload
			if err := json.Unmarshal(task.Payload, &payload); err != nil {
				t.Fatalf("task %s payload: %v", task.ID, err)
			}
			if !strings.HasPrefix(task.ID, payload.EventID+":") || task.ID != payload.EventID+":"+task.Type ||
				task.MaxRetry != map[bool]int{true: 5, false: 8}[task.Type == notify.TypeSellerPaidOrder] {
				t.Errorf("task %s (%s, max retry %d) for event %s", task.ID, task.Type, task.MaxRetry, payload.EventID)
			}
			got[task.ID] = payload.AggregateID
		}
		if len(pending) != len(want) || fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("round %d: tasks %v, want %v", round, got, want)
		}
		if n := ps.count(t, `SELECT count(*) FROM outbox_events WHERE published_at IS NULL`); n != 0 {
			t.Errorf("round %d: %d events unpublished", round, n)
		}
		mustExec(t, ps.db, `UPDATE outbox_events SET published_at = NULL`)
	}
}

// TestOutboxQueue_OnceAfterAsynqForgot: Asynq's task id refuses a
// re-published event only while it remembers the task (a day). After
// that, the consumer's own record in event_deliveries makes the handler
// skip the event: the buyer still gets one email.
func TestOutboxQueue_OnceAfterAsynqForgot(t *testing.T) {
	smtp := startFakeSMTP(t)
	sh := newShop(t, nil)
	w := startWorker(t, sh, workerOpts{mailer: smtp.mailer()})
	p := sh.product(t, "kaos-sekali", variant("SK-M", "M", 45000, 10))
	b := sh.buyer(t, "sekali")
	sh.order(t, b, line{p.Variants["SK-M"], 1})
	w.run(t, worker.TypePublishEvents)
	waitMails(t, smtp, b.Email, 1)
	waitIdle(t, w)

	if _, err := w.inspector.DeleteAllCompletedTasks(worker.Queue); err != nil {
		t.Fatal(err)
	}
	mustExec(t, sh.db, `UPDATE outbox_events SET published_at = NULL`)
	w.run(t, worker.TypePublishEvents)
	eventually(t, 30*time.Second, func() bool { return strings.Contains(w.logs.String(), "event handled before; skipped") },
		"the re-published event was not skipped; logs:\n%s", w.logs.String())
	waitIdle(t, w)
	if n := len(smtp.sent(b.Email)); n != 1 {
		t.Errorf("%d emails, want 1", n)
	}
}

// pausableProxy forwards TCP to target until paused; then it holds every
// byte, as a Redis that hangs does.
type pausableProxy struct {
	ln     net.Listener
	target string
	mu     sync.Mutex
	paused bool
}

func newPausableProxy(t *testing.T, target string) *pausableProxy {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &pausableProxy{ln: ln, target: target}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go p.pipe(c)
		}
	}()
	t.Cleanup(func() { _ = ln.Close() })
	return p
}

func (p *pausableProxy) pause(v bool) { p.mu.Lock(); p.paused = v; p.mu.Unlock() }

func (p *pausableProxy) held() bool { p.mu.Lock(); defer p.mu.Unlock(); return p.paused }

func (p *pausableProxy) pipe(c net.Conn) {
	var d net.Dialer
	up, err := d.Dial("tcp", p.target)
	if err != nil {
		_ = c.Close()
		return
	}
	copyHeld := func(dst, src net.Conn) {
		defer func() { _ = dst.Close(); _ = src.Close() }()
		buf := make([]byte, 32<<10)
		for {
			n, err := src.Read(buf)
			for n > 0 && p.held() {
				time.Sleep(10 * time.Millisecond)
			}
			if n > 0 {
				if _, werr := dst.Write(buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}
	go copyHeld(up, c)
	go copyHeld(c, up)
}

// TestOutboxQueue_HangingRedisBoundsTheBatch: Redis stops answering in
// the middle of a backlog. The dispatcher holds its batch's row locks
// while it enqueues, so the first enqueue that times out ends the batch:
// the run returns within one publish timeout, nothing is marked
// published, and the locks are free at once for the next run. When Redis
// answers again, every event is published once.
func TestOutboxQueue_HangingRedisBoundsTheBatch(t *testing.T) {
	sh := newShop(t, nil)
	opts := sh.rdb.Options()
	proxy := newPausableProxy(t, opts.Addr)
	rdb, err := redisconn.Open(t.Context(), fmt.Sprintf("redis://%s/%d", proxy.ln.Addr(), opts.DB))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rdb.Close() })
	client := asynq.NewClientFromRedisClient(rdb)
	publisher := notify.NewQueuePublisher(client, notify.NewRoutes(false))

	ids := make([]string, outbox.BatchSize+50)
	for i := range ids {
		ids[i] = uuidx.NewV7()
	}
	mustExec(t, sh.db, `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, created_at)
		SELECT id, 'order', gen_random_uuid(), 'order.created', '{}'::jsonb, now() + n * interval '1 microsecond'
		FROM unnest($1::uuid[]) WITH ORDINALITY AS e(id, n)`, ids)

	proxy.pause(true)
	start := time.Now()
	n, err := outbox.NewDispatcher(sh.db, publisher).PublishPending(context.Background())
	elapsed := time.Since(start)
	if err == nil || n != 0 {
		t.Errorf("PublishPending with Redis hanging = %d, %v; want 0 and an error", n, err)
	}
	if elapsed > outbox.PublishTimeout+time.Second {
		t.Errorf("the run held its batch for %s, want at most one publish timeout (%s)", elapsed, outbox.PublishTimeout)
	}
	// The locks are free: another dispatcher claims the batch at once.
	claimed := sh.count(t, `SELECT count(*) FROM (SELECT id FROM outbox_events WHERE published_at IS NULL
		ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED) s`)
	if claimed != 100 {
		t.Errorf("%d events claimable after the failed run, want 100", claimed)
	}
	if u := sh.count(t, `SELECT count(*) FROM outbox_events WHERE published_at IS NULL`); u != len(ids) {
		t.Errorf("%d events unpublished, want all %d", u, len(ids))
	}

	proxy.pause(false)
	var total int
	eventually(t, 30*time.Second, func() bool {
		n, _ := outbox.NewDispatcher(sh.db, publisher).PublishPending(context.Background())
		total += n
		return sh.count(t, `SELECT count(*) FROM outbox_events WHERE published_at IS NULL`) == 0
	}, "the backlog was not published after Redis came back")
	pending, err := asynq.NewInspectorFromRedisClient(sh.rdb).ListPendingTasks(worker.Queue, asynq.PageSize(1000))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	for _, task := range pending {
		seen[task.ID]++
	}
	for _, id := range ids {
		if seen[id+":"+notify.TypeOrderConfirmationEmail] != 1 {
			t.Fatalf("event %s has %d tasks, want 1", id, seen[id+":"+notify.TypeOrderConfirmationEmail])
		}
	}
	if total != len(ids) {
		t.Errorf("published %d, want %d", total, len(ids))
	}
}
