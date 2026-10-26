// Package outbox is the transactional outbox (ADR 0006): domain events are
// written to outbox_events in the same transaction as the change they
// announce, and a dispatcher publishes them afterwards. An event exists
// exactly when its change committed, so none is lost when the process
// dies after the commit, and none announces a change that was rolled back.
package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// Event is one domain event.
type Event struct {
	// ID is unique per event: a consumer that may see an event twice (at
	// least once delivery) remembers the IDs it has handled.
	ID            string
	AggregateType string // "order"
	AggregateID   string
	Type          string // "order.created", "order.paid", ...
	Payload       json.RawMessage
	CreatedAt     time.Time
}

// Record writes an event about aggregateType aggregateID into the outbox,
// through q, the queries of the transaction that makes the change.
func Record(ctx context.Context, q *sqlc.Queries, aggregateType, aggregateID, eventType string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode %s event: %w", eventType, err)
	}
	err = q.InsertOutboxEvent(ctx, sqlc.InsertOutboxEventParams{
		ID: uuidx.NewV7(), AggregateType: aggregateType, AggregateID: aggregateID, EventType: eventType, Payload: body,
	})
	if err != nil {
		return fmt.Errorf("record %s event: %w", eventType, err)
	}
	return nil
}

// Publisher hands an event to whoever consumes it: notify.QueuePublisher
// (Bab 6) enqueues the worker's tasks; LogPublisher writes it to the log.
type Publisher interface {
	Publish(ctx context.Context, e Event) error
}

// LogPublisher publishes an event by writing it to the log: Bab 5's
// stand-in, kept for tests and demonstrations. It delivers to nobody, so
// the API and the worker never use it.
type LogPublisher struct {
	Logger logx.Logger
}

// Publish implements Publisher.
func (p LogPublisher) Publish(_ context.Context, e Event) error {
	p.Logger.Info("domain event", "event_id", e.ID, "type", e.Type,
		"aggregate", e.AggregateType, "aggregate_id", e.AggregateID, "payload", string(e.Payload))
	return nil
}

// BatchSize is how many events one dispatcher transaction takes.
const BatchSize = 100

// PublishTimeout bounds one Publish (ADR 0007). The batch's rows stay
// locked while the publisher runs, so a hanging broker must not hold them
// for long: the first publish that times out ends the batch, and the
// event waits for the next run.
const PublishTimeout = 2 * time.Second

// BatchPublishTime bounds the publishing inside one batch's transaction,
// all publishes together: under a slow (not hanging) broker, 100 publishes
// that each stay under PublishTimeout could still hold the claimed rows
// for minutes. When it runs out, the events published so far are marked,
// the rest stay for the next run, and the run ends there.
const BatchPublishTime = 5 * time.Second

// MaxBatchesPerRun bounds one PublishPending: at most this many batches,
// then the rest waits for the next run (the worker runs it every 5
// seconds), so one run never takes unbounded time under a flood.
const MaxBatchesPerRun = 10

// Dispatcher publishes the outbox.
type Dispatcher struct {
	db        *sql.DB
	publisher Publisher
	now       func() time.Time
}

// NewDispatcher returns a Dispatcher that publishes the outbox of db
// through publisher.
func NewDispatcher(db *sql.DB, publisher Publisher) *Dispatcher {
	return &Dispatcher{db: db, publisher: publisher, now: time.Now}
}

// PublishPending publishes every unpublished event, oldest first, and
// returns how many. Each batch is one transaction: the events are locked
// (FOR UPDATE SKIP LOCKED, so a second dispatcher takes other rows), handed
// to the publisher, and marked published. When the publisher fails, the
// events published before it are still marked, the batch stops, and the
// failed event is tried again on the next run: at least once, in order.
// `api publish-events` runs it once; the worker every 5 seconds. One run
// takes at most MaxBatchesPerRun batches.
//
// The batch's row locks are held while the publisher runs, so each
// publish gets PublishTimeout and the batch's publishes together
// BatchPublishTime (ADR 0006, ADR 0007).
func (d *Dispatcher) PublishPending(ctx context.Context) (int, error) {
	total := 0
	for range MaxBatchesPerRun {
		n, more, err := d.publishBatch(ctx)
		total += n
		if err != nil || !more {
			return total, err
		}
	}
	return total, nil
}

// publishBatch publishes one batch and reports whether a full one was
// read (there may be more).
func (d *Dispatcher) publishBatch(ctx context.Context) (published int, more bool, err error) {
	var publishErr error
	err = database.WithTx(ctx, d.db, func(q *sqlc.Queries) error {
		rows, err := q.ClaimOutboxEvents(ctx, BatchSize)
		if err != nil {
			return fmt.Errorf("claim outbox events: %w", err)
		}
		more = len(rows) == BatchSize
		// The publishes share BatchPublishTime; the transaction's own
		// statements keep ctx.
		pubCtx, cancel := context.WithTimeout(ctx, BatchPublishTime)
		defer cancel()
		var done []string
		for _, row := range rows {
			if pubCtx.Err() != nil && ctx.Err() == nil {
				more = false // out of time: the next run goes on
				break
			}
			e := Event{
				ID: row.ID, AggregateType: row.AggregateType, AggregateID: row.AggregateID,
				Type: row.EventType, Payload: row.Payload, CreatedAt: row.CreatedAt,
			}
			if publishErr = d.publish(pubCtx, e); publishErr != nil {
				more = false
				if pubCtx.Err() != nil && ctx.Err() == nil && errors.Is(publishErr, context.DeadlineExceeded) {
					publishErr = nil // the batch ran out of time; not the event's fault
				}
				break
			}
			done = append(done, row.ID)
		}
		published = len(done)
		if len(done) == 0 {
			return nil
		}
		if err := q.MarkOutboxEventsPublished(ctx, sqlc.MarkOutboxEventsPublishedParams{Now: d.now(), Ids: done}); err != nil {
			return fmt.Errorf("mark outbox events published: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, false, err
	}
	if publishErr != nil {
		return published, false, fmt.Errorf("publish outbox event: %w", publishErr)
	}
	return published, more, nil
}

// publish hands e to the publisher within PublishTimeout.
func (d *Dispatcher) publish(ctx context.Context, e Event) error {
	ctx, cancel := context.WithTimeout(ctx, PublishTimeout)
	defer cancel()
	return d.publisher.Publish(ctx, e)
}

// Retention is how long published events (and their delivery records) are
// kept: long enough for every consumer's retries and for a look at what
// happened, short enough that the table does not grow for ever.
const Retention = 7 * 24 * time.Hour

// cleanupBatchSize is how many rows one cleanup DELETE takes.
const cleanupBatchSize = 1000

// Cleanup deletes the events published, and the delivery records made,
// more than Retention before now, in batches, and returns how many events
// it deleted. The worker runs it daily.
func Cleanup(ctx context.Context, db *sql.DB, now time.Time) (int64, error) {
	q := sqlc.New(db)
	before := now.Add(-Retention)
	var events int64
	for {
		n, err := q.DeletePublishedEvents(ctx, sqlc.DeletePublishedEventsParams{Before: before, BatchSize: cleanupBatchSize})
		events += n
		if err != nil {
			return events, fmt.Errorf("delete published events: %w", err)
		}
		if n < cleanupBatchSize {
			break
		}
	}
	for {
		n, err := q.DeleteOldDeliveries(ctx, sqlc.DeleteOldDeliveriesParams{Before: before, BatchSize: cleanupBatchSize})
		if err != nil {
			return events, fmt.Errorf("delete old deliveries: %w", err)
		}
		if n < cleanupBatchSize {
			return events, nil
		}
	}
}

// Deliveries records which consumer has handled which event (ADR 0007),
// so a consumer can skip an event it saw before: delivery is at least
// once.
type Deliveries struct {
	q *sqlc.Queries
}

// NewDeliveries returns the delivery records of db.
func NewDeliveries(db *sql.DB) *Deliveries { return &Deliveries{q: sqlc.New(db)} }

// Delivered reports whether consumer has handled event eventID.
func (d *Deliveries) Delivered(ctx context.Context, eventID, consumer string) (bool, error) {
	ok, err := d.q.EventDelivered(ctx, sqlc.EventDeliveredParams{EventID: eventID, Consumer: consumer})
	if err != nil {
		return false, fmt.Errorf("query event delivery: %w", err)
	}
	return ok, nil
}

// MarkDelivered records that consumer has handled event eventID.
func (d *Deliveries) MarkDelivered(ctx context.Context, eventID, consumer string) error {
	if err := d.q.MarkEventDelivered(ctx, sqlc.MarkEventDeliveredParams{EventID: eventID, Consumer: consumer}); err != nil {
		return fmt.Errorf("record event delivery: %w", err)
	}
	return nil
}
