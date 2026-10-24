package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/outbox"
)

// Routes is which tasks each domain event becomes: one per consumer, so
// each retries on its own (a failing chat does not send the email again).
type Routes map[string][]string

// NewRoutes is GoShop's routing (ADR 0007); the seller's chat message only
// when it is configured, since a task nobody handles would only fail.
func NewRoutes(sellerChat bool) Routes {
	r := Routes{
		"order.created": {TypeOrderConfirmationEmail},
		"order.paid":    {TypePaymentReceivedEmail},
		"order.shipped": {TypeOrderShippedEmail},
	}
	if sellerChat {
		r["order.paid"] = append(r["order.paid"], TypeSellerPaidOrder)
	}
	return r
}

// taskRetention keeps a finished task's ID in Redis for a day, so an event
// published again in that time (the dispatcher died between the enqueue
// and its commit) is refused by Asynq as a duplicate.
const taskRetention = 24 * time.Hour

// QueuePublisher is the outbox's publisher (ADR 0007): it enqueues the
// event's tasks for the worker. It replaces Bab 5's LogPublisher.
type QueuePublisher struct {
	client *asynq.Client
	routes Routes
}

// NewQueuePublisher returns a publisher that enqueues with client along
// routes.
func NewQueuePublisher(client *asynq.Client, routes Routes) *QueuePublisher {
	return &QueuePublisher{client: client, routes: routes}
}

// Publish implements outbox.Publisher. Each task's ID is
// "<event id>:<task type>", so publishing an event twice enqueues each
// task once. An event no consumer wants is published as it is.
func (p *QueuePublisher) Publish(ctx context.Context, e outbox.Event) error {
	for _, taskType := range p.routes[e.Type] {
		task, err := NewEventTask(taskType, e)
		if err != nil {
			return err
		}
		_, err = p.client.EnqueueContext(ctx, task,
			asynq.TaskID(e.ID+":"+taskType), MaxRetry(taskType),
			asynq.Timeout(time.Minute), asynq.Retention(taskRetention))
		if err != nil && !errors.Is(err, asynq.ErrTaskIDConflict) {
			return fmt.Errorf("enqueue %s for event %s: %w", taskType, e.ID, err)
		}
	}
	logx.FromContext(ctx).Info("domain event published", "event_id", e.ID, "type", e.Type,
		"aggregate_id", e.AggregateID, "tasks", len(p.routes[e.Type]))
	return nil
}

// Deliveries is where consumers record the events they handled;
// *outbox.Deliveries is one.
type Deliveries interface {
	Delivered(ctx context.Context, eventID, consumer string) (bool, error)
	MarkDelivered(ctx context.Context, eventID, consumer string) error
}

// Once makes the event task handler h idempotent (ADR 0007): it skips an
// event this task type has handled before, and records the event after h
// succeeds. Only a crash between h's side effect and that record can repeat
// it: at least once, never lost.
func Once(deliveries Deliveries, h asynq.HandlerFunc) asynq.HandlerFunc {
	return func(ctx context.Context, t *asynq.Task) error {
		ev, err := decodeEvent(t)
		if err != nil {
			return err
		}
		done, err := deliveries.Delivered(ctx, ev.EventID, t.Type())
		if err != nil {
			return fmt.Errorf("%s: %w", t.Type(), err)
		}
		if done {
			logx.FromContext(ctx).Info("event handled before; skipped", "event_id", ev.EventID, "task", t.Type())
			return nil
		}
		if err := h(ctx, t); err != nil {
			return err
		}
		if err := deliveries.MarkDelivered(ctx, ev.EventID, t.Type()); err != nil {
			return fmt.Errorf("%s: %w", t.Type(), err)
		}
		return nil
	}
}
