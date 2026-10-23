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

// Publisher hands an event to whoever consumes it. Bab 5 has only
// LogPublisher; Bab 6 adds the job queue that sends emails and push
// notifications.
type Publisher interface {
	Publish(ctx context.Context, e Event) error
}

// LogPublisher publishes an event by writing it to the log: a stand-in
// until Bab 6, which shows the flow end to end.
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
// `api publish-events` runs it once; Bab 6's worker runs it on a ticker.
//
// The batch's row locks are held while the publisher runs, so a publisher
// must be quick: the log is; Bab 6's queue publisher must bound each
// publish with a short timeout (ADR 0006).
func (d *Dispatcher) PublishPending(ctx context.Context) (int, error) {
	total := 0
	for {
		n, more, err := d.publishBatch(ctx)
		total += n
		if err != nil || !more {
			return total, err
		}
	}
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
		var done []string
		for _, row := range rows {
			e := Event{
				ID: row.ID, AggregateType: row.AggregateType, AggregateID: row.AggregateID,
				Type: row.EventType, Payload: row.Payload, CreatedAt: row.CreatedAt,
			}
			if publishErr = d.publisher.Publish(ctx, e); publishErr != nil {
				more = false
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
