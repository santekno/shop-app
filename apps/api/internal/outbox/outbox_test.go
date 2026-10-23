package outbox

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

var (
	errBoom  = errors.New("boom")
	testTime = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
)

func TestRecord(t *testing.T) {
	db := newFakeSQL()
	err := Record(context.Background(), sqlc.New(db.open(t)), "order", "o-1", "order.paid", map[string]any{"total": 117000})
	testx.AssertNoError(t, err)
	c, _ := db.call("InsertOutboxEvent")
	testx.AssertTrue(t, uuidx.IsValidUUID(c.args[0].(string)), "event id %v", c.args[0])
	assertArgs(t, c.args[1:4], []driver.Value{"order", "o-1", "order.paid"})
	testx.AssertEqual(t, string(c.args[4].([]byte)), `{"total":117000}`)

	other := newFakeSQL()
	testx.AssertNoError(t, Record(context.Background(), sqlc.New(other.open(t)), "order", "o-1", "order.paid", nil))
	c2, _ := other.call("InsertOutboxEvent")
	testx.AssertNotEqual(t, c2.args[0], c.args[0], "a new id per event")

	t.Run("a payload that cannot be encoded is not written", func(t *testing.T) {
		db := newFakeSQL()
		err := Record(context.Background(), sqlc.New(db.open(t)), "order", "o-1", "order.paid", make(chan int))
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "encode order.paid event: "), "err = %v", err)
		testx.AssertFalse(t, db.ran("InsertOutboxEvent"))
	})
	t.Run("the insert fails", func(t *testing.T) {
		db := newFakeSQL().on("InsertOutboxEvent", failWith(errBoom))
		err := Record(context.Background(), sqlc.New(db.open(t)), "order", "o-1", "order.paid", 1)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "record order.paid event: boom")
	})
}

func TestLogPublisher(t *testing.T) {
	var logs bytes.Buffer
	p := LogPublisher{Logger: logx.New(logx.WithOutput(&logs), logx.WithFormat("json"))}
	err := p.Publish(context.Background(), Event{
		ID: "e-1", AggregateType: "order", AggregateID: "o-1", Type: "order.created", Payload: json.RawMessage(`{"code":"GS-1"}`),
	})
	testx.AssertNoError(t, err)
	var line map[string]any
	testx.AssertNoError(t, json.Unmarshal(logs.Bytes(), &line))
	testx.AssertEqual(t, line["msg"], any("domain event"))
	testx.AssertEqual(t, line["event_id"], any("e-1"))
	testx.AssertEqual(t, line["type"], any("order.created"))
	testx.AssertEqual(t, line["aggregate"], any("order"))
	testx.AssertEqual(t, line["aggregate_id"], any("o-1"))
	testx.AssertEqual(t, line["payload"], any(`{"code":"GS-1"}`))
}

// recordingPublisher records what it published and fails on the event
// named failOn.
type recordingPublisher struct {
	seen   []string
	failOn string
}

func (p *recordingPublisher) Publish(_ context.Context, e Event) error {
	if e.ID == p.failOn {
		return errBoom
	}
	p.seen = append(p.seen, e.ID)
	return nil
}

// eventRows is a ClaimOutboxEvents answer of n events e-<from>…
func eventRows(from, n int) fakeAnswer {
	out := make([][]driver.Value, 0, n)
	for i := range n {
		id := fmt.Sprintf("e-%d", from+i)
		out = append(out, []driver.Value{id, "order", "o-" + id, "order.created", []byte(`{}`), testTime})
	}
	return fakeAnswer{rows: out}
}

func dispatcher(t *testing.T, db *fakeSQL, p Publisher) *Dispatcher {
	t.Helper()
	d := NewDispatcher(db.open(t), p)
	d.now = func() time.Time { return testTime }
	return d
}

func TestDispatcher_PublishPending(t *testing.T) {
	t.Run("one short batch: published in order and marked", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, 3))
		p := &recordingPublisher{}
		n, err := dispatcher(t, db, p).PublishPending(context.Background())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 3)
		testx.AssertEqual(t, strings.Join(p.seen, ","), "e-1,e-2,e-3")
		assertLockedFirst(t, db, "ClaimOutboxEvents")
		testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,ClaimOutboxEvents,MarkOutboxEventsPublished,COMMIT")
		claim, _ := db.call("ClaimOutboxEvents")
		assertArgs(t, claim.args, []driver.Value{int64(BatchSize)})
		mark, _ := db.call("MarkOutboxEventsPublished")
		assertArgs(t, mark.args, []driver.Value{testTime, pqArray("e-1", "e-2", "e-3")})
	})
	t.Run("a full batch reads another, each in its own transaction", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, BatchSize)).on("ClaimOutboxEvents", eventRows(101, 2))
		p := &recordingPublisher{}
		n, err := dispatcher(t, db, p).PublishPending(context.Background())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, BatchSize+2)
		testx.AssertEqual(t, len(db.calledAll("COMMIT")), 2)
		testx.AssertEqual(t, len(db.calledAll("MarkOutboxEventsPublished")), 2)
	})
	t.Run("nothing to publish", func(t *testing.T) {
		db := newFakeSQL()
		n, err := dispatcher(t, db, &recordingPublisher{}).PublishPending(context.Background())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 0)
		testx.AssertFalse(t, db.ran("MarkOutboxEventsPublished"), "no empty mark")
		testx.AssertTrue(t, db.ran("COMMIT"))
	})
	// At least once, in order: the events before the failure are marked,
	// the failed one and the rest stay for the next run.
	t.Run("a publisher error stops the batch and keeps the earlier marks", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, BatchSize))
		p := &recordingPublisher{failOn: "e-3"}
		n, err := dispatcher(t, db, p).PublishPending(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "publish outbox event: boom")
		testx.AssertEqual(t, n, 2)
		mark, _ := db.call("MarkOutboxEventsPublished")
		assertArgs(t, mark.args, []driver.Value{testTime, pqArray("e-1", "e-2")})
		testx.AssertTrue(t, db.ran("COMMIT"), "the marks commit")
		testx.AssertEqual(t, len(db.calledAll("ClaimOutboxEvents")), 1, "no further batch, though this one was full")
	})
	t.Run("the first event fails: nothing is marked", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, 2))
		n, err := dispatcher(t, db, &recordingPublisher{failOn: "e-1"}).PublishPending(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, n, 0)
		testx.AssertFalse(t, db.ran("MarkOutboxEventsPublished"))
	})
	t.Run("claiming fails", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", failWith(errBoom))
		n, err := dispatcher(t, db, &recordingPublisher{}).PublishPending(context.Background())
		testx.AssertEqual(t, err.Error(), "claim outbox events: boom")
		testx.AssertEqual(t, n, 0)
		testx.AssertTrue(t, db.ran("ROLLBACK"))
	})
	t.Run("marking fails: the batch counts as unpublished", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, 2)).on("MarkOutboxEventsPublished", failWith(errBoom))
		n, err := dispatcher(t, db, &recordingPublisher{}).PublishPending(context.Background())
		testx.AssertEqual(t, err.Error(), "mark outbox events published: boom")
		testx.AssertEqual(t, n, 0, "rolled back: they will be published again")
		testx.AssertTrue(t, db.ran("ROLLBACK"))
	})
	t.Run("an earlier batch still counts when a later one fails", func(t *testing.T) {
		db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, BatchSize)).on("ClaimOutboxEvents", failWith(errBoom))
		n, err := dispatcher(t, db, &recordingPublisher{}).PublishPending(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, n, BatchSize)
	})
}

func TestNewDispatcher_UsesTheRealClock(t *testing.T) {
	d := NewDispatcher(newFakeSQL().open(t), &recordingPublisher{})
	testx.AssertTrue(t, time.Since(d.now()) < time.Minute)
}
