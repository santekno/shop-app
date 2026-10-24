package outbox

// Bab 6 artikel 11: the dispatcher's bounds — a timeout per publish
// (the batch's rows stay locked meanwhile) and a cap on batches per run.

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// deadlinePublisher records how long each publish was given.
type deadlinePublisher struct {
	mu    sync.Mutex
	left  []time.Duration
	noDDL int
}

func (p *deadlinePublisher) Publish(ctx context.Context, _ Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	d, ok := ctx.Deadline()
	if !ok {
		p.noDDL++
		return nil
	}
	p.left = append(p.left, time.Until(d))
	return nil
}

func TestDispatcher_PublishTimeout(t *testing.T) {
	testx.AssertEqual(t, PublishTimeout, 2*time.Second)

	t.Run("each publish gets its own PublishTimeout", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, 3))
		p := &deadlinePublisher{}
		// The run's own deadline is far later: the 2 s are the dispatcher's.
		ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
		defer cancel()
		n, err := dispatcher(t, db, p).PublishPending(ctx)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 3)
		testx.AssertEqual(t, p.noDDL, 0, "a publish without a deadline")
		testx.AssertEqual(t, len(p.left), 3)
		for i, left := range p.left {
			testx.AssertTrue(t, left > PublishTimeout-500*time.Millisecond && left <= PublishTimeout,
				"publish %d had %v", i, left)
		}
	})
	t.Run("a shorter run deadline still wins", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, 1))
		p := &deadlinePublisher{}
		ctx, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
		defer cancel()
		_, err := dispatcher(t, db, p).PublishPending(ctx)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(p.left), 1)
		testx.AssertTrue(t, p.left[0] <= 500*time.Millisecond, "had %v", p.left[0])
	})
}

// hangingPublisher publishes every event but hangOn, on which it waits
// until its context ends, like an enqueue to a Redis that stopped
// answering.
type hangingPublisher struct {
	hangOn string
	seen   []string
}

func (p *hangingPublisher) Publish(ctx context.Context, e Event) error {
	if e.ID == p.hangOn {
		<-ctx.Done()
		return ctx.Err()
	}
	p.seen = append(p.seen, e.ID)
	return nil
}

// A hanging broker holds the batch's locks for one PublishTimeout at most:
// the publish that timed out ends the batch, the events before it are
// marked, the rest waits for the next run.
func TestDispatcher_HangingPublisherEndsTheBatch(t *testing.T) {
	db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, BatchSize))
	p := &hangingPublisher{hangOn: "e-3"}
	// Should the timeout go, the run would wait for this 10 s instead.
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	start := time.Now()
	n, err := dispatcher(t, db, p).PublishPending(ctx)
	took := time.Since(start)

	testx.AssertTrue(t, errors.Is(err, context.DeadlineExceeded), "err = %v", err)
	testx.AssertEqual(t, err.Error(), "publish outbox event: context deadline exceeded")
	testx.AssertTrue(t, took >= PublishTimeout-100*time.Millisecond && took < PublishTimeout+2*time.Second, "took %v", took)
	testx.AssertEqual(t, n, 2)
	testx.AssertEqual(t, strings.Join(p.seen, ","), "e-1,e-2", "nothing after the hung event")
	mark, _ := db.call("MarkOutboxEventsPublished")
	assertArgs(t, mark.args, []driver.Value{testTime, pqArray("e-1", "e-2")})
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,ClaimOutboxEvents,MarkOutboxEventsPublished,COMMIT",
		"one batch, committed, though it was full")
}

// cappedPublisher publishes up to limit events, then fails: should the
// run not stop after MaxBatchesPerRun, the test ends with an error rather
// than spinning for ever.
type cappedPublisher struct {
	count int
	limit int
}

var errPastTheCap = errors.New("published past the cap")

func (p *cappedPublisher) Publish(context.Context, Event) error {
	if p.count >= p.limit {
		return errPastTheCap
	}
	p.count++
	return nil
}

func TestDispatcher_MaxBatchesPerRun(t *testing.T) {
	testx.AssertEqual(t, MaxBatchesPerRun, 10)
	// Every claim answers a full batch: a flood.
	db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, BatchSize))
	p := &cappedPublisher{limit: MaxBatchesPerRun * BatchSize}
	n, err := dispatcher(t, db, p).PublishPending(t.Context())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, n, MaxBatchesPerRun*BatchSize)
	testx.AssertEqual(t, p.count, 1000)
	testx.AssertEqual(t, len(db.calledAll("BEGIN")), MaxBatchesPerRun)
	testx.AssertEqual(t, len(db.calledAll("ClaimOutboxEvents")), MaxBatchesPerRun)
	testx.AssertEqual(t, len(db.calledAll("MarkOutboxEventsPublished")), MaxBatchesPerRun)
	testx.AssertEqual(t, len(db.calledAll("COMMIT")), MaxBatchesPerRun)
	for i, c := range db.calledAll("ClaimOutboxEvents") {
		testx.AssertEqual(t, c.tx, i+1, fmt.Sprintf("claim %d in transaction %d", i, c.tx))
	}
}
