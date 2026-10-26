// Package notify is what the worker tells people (ADR 0007): the buyer's
// order emails and, from Bab 6 artikel 09, the seller's Telegram message.
// Each is an Asynq task the outbox publishes per domain event, retried on
// its own.
package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"

	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
)

// The task types of this package.
const (
	// TypeSendEmail is one ready email the API queued (verification,
	// password reset), sent by the worker.
	TypeSendEmail = "email:send"
	// The order emails, one per domain event.
	TypeOrderConfirmationEmail = "email:order-confirmation"
	TypePaymentReceivedEmail   = "email:payment-received"
	TypeOrderShippedEmail      = "email:order-shipped"
)

// EventPayload is the payload of every task made from a domain event: the
// event as the outbox stored it.
type EventPayload struct {
	EventID     string          `json:"event_id"`
	Type        string          `json:"type"`
	AggregateID string          `json:"aggregate_id"`
	Payload     json.RawMessage `json:"payload"`
	OccurredAt  time.Time       `json:"occurred_at"`
}

// NewEventTask is the task of type taskType for event e.
func NewEventTask(taskType string, e outbox.Event) (*asynq.Task, error) {
	body, err := json.Marshal(EventPayload{
		EventID: e.ID, Type: e.Type, AggregateID: e.AggregateID, Payload: e.Payload, OccurredAt: e.CreatedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("encode %s task: %w", taskType, err)
	}
	return asynq.NewTask(taskType, body), nil
}

// decodeEvent reads an event task's payload. A payload that does not
// decode never will: SkipRetry sends the task to the dead-letter queue.
func decodeEvent(t *asynq.Task) (EventPayload, error) {
	var p EventPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil || p.AggregateID == "" || p.EventID == "" {
		return EventPayload{}, fmt.Errorf("%s: bad payload: %w", t.Type(), asynq.SkipRetry)
	}
	return p, nil
}

// QueueMailer is the API's mailer when SMTP is on: it queues each message
// for the worker, so a request never waits for the mail server, and
// forgot-password takes the same time whether the account exists or not.
type QueueMailer struct {
	client *asynq.Client
}

// NewQueueMailer returns a mailer that enqueues with client.
func NewQueueMailer(client *asynq.Client) *QueueMailer { return &QueueMailer{client: client} }

// Send implements mail.Mailer. The message (with its one-time token) stays
// in Redis only until the worker sent it: Asynq deletes a finished task
// unless it is told to keep it.
func (q *QueueMailer) Send(ctx context.Context, m mail.Message) error {
	body, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("encode email: %w", err)
	}
	if _, err := q.client.EnqueueContext(ctx, asynq.NewTask(TypeSendEmail, body),
		MaxRetry(TypeSendEmail), asynq.Timeout(time.Minute)); err != nil {
		return fmt.Errorf("queue email: %w", err)
	}
	return nil
}
