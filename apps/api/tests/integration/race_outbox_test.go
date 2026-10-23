//go:build integration

package integration_test

import (
	"context"
	"slices"
	"sync"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/outbox"
)

// recordingPublisher keeps the ids of the events it was handed.
type recordingPublisher struct {
	mu  sync.Mutex
	ids []string
}

// Publish implements outbox.Publisher.
func (p *recordingPublisher) Publish(_ context.Context, e outbox.Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ids = append(p.ids, e.ID)
	return nil
}

// TestRace_OutboxTwoDispatchers: two dispatchers publish one backlog at
// once (more than two batches of it). FOR UPDATE SKIP LOCKED gives each
// row to one of them: every event is published exactly once, none twice,
// all are marked published, and each dispatcher saw its events oldest
// first.
func TestRace_OutboxTwoDispatchers(t *testing.T) {
	sh := newShop(t, nil)
	const backlog = 2*outbox.BatchSize + 37
	for i := range raceIterations {
		want := make([]string, backlog)
		for j := range want {
			want[j] = uuidx.NewV7()
		}
		mustExec(t, sh.db, `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, created_at)
			SELECT id, 'order', gen_random_uuid(), 'order.created', '{}'::jsonb, now() + n * interval '1 microsecond'
			FROM unnest($1::uuid[]) WITH ORDINALITY AS e(id, n)`, want)
		pubs := []*recordingPublisher{{}, {}}
		counts, errs := make([]int, 2), make([]error, 2)
		together(
			func() { counts[0], errs[0] = outbox.NewDispatcher(sh.db, pubs[0]).PublishPending(context.Background()) },
			func() { counts[1], errs[1] = outbox.NewDispatcher(sh.db, pubs[1]).PublishPending(context.Background()) })
		if errs[0] != nil || errs[1] != nil {
			t.Fatalf("iteration %d: dispatchers failed: %v, %v", i, errs[0], errs[1])
		}
		pos := make(map[string]int, backlog)
		for j, id := range want {
			pos[id] = j
		}
		seen := map[string]int{}
		for k, p := range pubs {
			if len(p.ids) != counts[k] {
				t.Errorf("iteration %d: dispatcher %d reported %d, published %d", i, k, counts[k], len(p.ids))
			}
			if !slices.IsSortedFunc(p.ids, func(a, b string) int { return pos[a] - pos[b] }) {
				t.Errorf("iteration %d: dispatcher %d published out of order", i, k)
			}
			for _, id := range p.ids {
				seen[id]++
			}
		}
		for _, id := range want {
			if seen[id] != 1 {
				t.Fatalf("iteration %d: event %s published %d times, want once (dispatchers took %d and %d)", i, id, seen[id], counts[0], counts[1])
			}
		}
		if len(seen) != backlog {
			t.Fatalf("iteration %d: %d events published, want %d", i, len(seen), backlog)
		}
		if n := sh.count(t, `SELECT count(*) FROM outbox_events WHERE published_at IS NULL`); n != 0 {
			t.Fatalf("iteration %d: %d events still unpublished", i, n)
		}
		if i == 0 {
			t.Logf("first iteration: the dispatchers took %d and %d of %d events", counts[0], counts[1], backlog)
		}
	}
}
