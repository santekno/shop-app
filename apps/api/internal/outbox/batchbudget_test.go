package outbox

// Bab 6 artikel 11: the publishes of one batch share BatchPublishTime. A
// slow broker (each publish under PublishTimeout, but many of them) must
// not hold the claimed rows for minutes: when the budget runs out, the
// events published so far are marked, the rest stays for the next run, and
// the run ends without an error, because nothing failed.

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// slowPublisher publishes the first fast events at once and each later one
// in delay, unless its context ends first. When ignoreCtx is set it sleeps
// through its context, like a client that does not watch it.
type slowPublisher struct {
	fast      int
	delay     time.Duration
	ignoreCtx bool

	mu   sync.Mutex
	seen []string
}

func (p *slowPublisher) Publish(ctx context.Context, e Event) error {
	p.mu.Lock()
	n := len(p.seen)
	p.mu.Unlock()
	if n >= p.fast {
		if p.ignoreCtx {
			time.Sleep(p.delay)
		} else {
			select {
			case <-time.After(p.delay):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.seen = append(p.seen, e.ID)
	return nil
}

func TestDispatcher_BatchPublishTime(t *testing.T) {
	testx.AssertEqual(t, BatchPublishTime, 5*time.Second)
	testx.AssertTrue(t, BatchPublishTime > PublishTimeout, "the batch budget holds more than one publish")

	tests := []struct {
		name     string
		p        *slowPublisher
		wantSeen string
	}{
		// e-3 and e-4 take 1.9 s each (under PublishTimeout); e-5 is cut
		// by the batch budget at 5 s, not by its own 2 s.
		{name: "a publish cut by the budget", p: &slowPublisher{fast: 2, delay: 1900 * time.Millisecond}, wantSeen: "e-1,e-2,e-3,e-4"},
		// A publisher that overruns the budget without noticing: the
		// dispatcher stops before the next event.
		{name: "the budget spent between publishes", p: &slowPublisher{fast: 2, delay: BatchPublishTime + 200*time.Millisecond, ignoreCtx: true}, wantSeen: "e-1,e-2,e-3"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, BatchSize))
			// The run's own deadline is far later: the 5 s are the batch's.
			ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
			defer cancel()
			start := time.Now()
			n, err := dispatcher(t, db, tt.p).PublishPending(ctx)
			took := time.Since(start)

			testx.AssertNoError(t, err, "running out of time is not a failure")
			testx.AssertTrue(t, took < BatchPublishTime+2*time.Second, "took %v", took)
			testx.AssertEqual(t, strings.Join(tt.p.seen, ","), tt.wantSeen)
			testx.AssertEqual(t, n, strings.Count(tt.wantSeen, ",")+1)
			mark, _ := db.call("MarkOutboxEventsPublished")
			assertArgs(t, mark.args, []driver.Value{testTime, pqArray(strings.Split(tt.wantSeen, ",")...)}, "the published ones are marked")
			testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,ClaimOutboxEvents,MarkOutboxEventsPublished,COMMIT",
				"one batch, committed; the full batch's rest waits for the next run")
		})
	}
}

// The caller's own deadline is not the batch budget: a publish cut by it
// is an error, as before, and the transaction (whose statements use the
// caller's context) does not commit, so the event published before it is
// published again next run: at least once.
func TestDispatcher_RunDeadlineIsStillAnError(t *testing.T) {
	db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, 3))
	p := &slowPublisher{fast: 1, delay: time.Second}
	ctx, cancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancel()
	n, err := dispatcher(t, db, p).PublishPending(ctx)
	testx.AssertTrue(t, errors.Is(err, context.DeadlineExceeded), "err = %v", err)
	testx.AssertEqual(t, n, 0)
	testx.AssertEqual(t, strings.Join(p.seen, ","), "e-1")
	testx.AssertFalse(t, db.ran("COMMIT"))
}
