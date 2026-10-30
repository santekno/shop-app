// Package adminevents is the admin dashboard's live feed (Bab 12, ADR
// 0009). The outbox dispatcher, in the worker, publishes every order event
// to one Redis pub/sub channel (Publisher); each GET /v1/admin/events
// stream, on whichever API instance serves it, subscribes to that channel
// and writes what arrives as Server-Sent Events (Handler).
//
// Delivery is at least once and live only: a message carries its outbox
// event's ID so a client can drop one it has seen, and nothing is
// replayed. A client that (re)connects refetches what it shows.
package adminevents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/outbox"
)

// Channel is the Redis pub/sub channel of the feed.
const Channel = "goshop:admin:events"

// EventOrder is the SSE event name of an order change.
const EventOrder = "order"

// Message is one entry of the feed, as it travels on Channel and as the
// stream writes it: "id: <ID>", "event: <Event>", "data: <Data>".
type Message struct {
	// ID is the outbox event's ID, unique per event.
	ID    string          `json:"id"`
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

// orderData is the data of an order message. It names the fields it
// copies from the outbox payload, so nothing about the buyer (user_id,
// cancel_reason, an address) can reach the dashboard by accident.
type orderData struct {
	Type       string    `json:"type"` // order.created, order.paid, …
	OrderID    string    `json:"order_id"`
	Code       string    `json:"code"`
	Status     string    `json:"status"`
	Total      money     `json:"total"`
	OccurredAt time.Time `json:"occurred_at"`
}

type money struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// orderPayload is the part of the outbox's order payload (order's
// eventPayload) the feed reads. Total is a pointer so that a missing total
// is told apart from a total of 0.
type orderPayload struct {
	OrderID    string    `json:"order_id"`
	Code       string    `json:"code"`
	Status     string    `json:"status"`
	Total      *int64    `json:"total"`
	Currency   string    `json:"currency"`
	OccurredAt time.Time `json:"occurred_at"`
}

// check reports the first field the feed needs that p lacks. JSON decoding
// leaves a field it does not find at its zero value without complaint, so
// if order's eventPayload ever renamed a field, every event would decode
// into an empty ID, code or a total of 0; the dashboard's duplicate check
// and its "new order" toast would quietly degrade. Such a payload is
// treated as one that does not decode.
func (p orderPayload) check() error {
	switch {
	case p.OrderID == "":
		return errors.New("no order_id")
	case p.Code == "":
		return errors.New("no code")
	case p.Status == "":
		return errors.New("no status")
	case p.Total == nil:
		return errors.New("no total")
	case *p.Total < 0:
		return fmt.Errorf("negative total %d", *p.Total)
	case p.Currency == "":
		return errors.New("no currency")
	}
	return nil
}

// FromEvent is the feed message of e, and false for an event the feed does
// not carry (anything but an order's). An order payload that does not
// decode, or lacks a field the feed copies, is an error.
func FromEvent(e outbox.Event) (Message, bool, error) {
	if e.AggregateType != "order" {
		return Message{}, false, nil
	}
	var p orderPayload
	if err := json.Unmarshal(e.Payload, &p); err != nil {
		return Message{}, false, fmt.Errorf("decode %s event %s: %w", e.Type, e.ID, err)
	}
	if err := p.check(); err != nil {
		return Message{}, false, fmt.Errorf("decode %s event %s: %w", e.Type, e.ID, err)
	}
	data, err := json.Marshal(orderData{
		Type: e.Type, OrderID: p.OrderID, Code: p.Code, Status: p.Status,
		Total: money{Amount: *p.Total, Currency: p.Currency}, OccurredAt: p.OccurredAt.UTC(),
	})
	if err != nil {
		return Message{}, false, fmt.Errorf("encode %s event %s: %w", e.Type, e.ID, err)
	}
	return Message{ID: e.ID, Event: EventOrder, Data: data}, true, nil
}

// RedisPublisher is the one command Publisher needs; a go-redis client is
// one.
type RedisPublisher interface {
	Publish(ctx context.Context, channel string, message any) *redis.IntCmd
}

// Publisher is the outbox publisher of the feed: it publishes every order
// event to Channel. Nobody listening is not an error; the message is
// simply gone, which is what a live feed means.
type Publisher struct {
	rdb RedisPublisher
}

// NewPublisher returns a Publisher on rdb.
func NewPublisher(rdb RedisPublisher) *Publisher { return &Publisher{rdb: rdb} }

// Publish implements outbox.Publisher. An order event whose payload does
// not decode or lacks a field (FromEvent's error) is logged and skipped, never returned: the dispatcher would
// otherwise retry it for ever and hold back every event after it, emails
// included, for the sake of a dashboard notification.
func (p *Publisher) Publish(ctx context.Context, e outbox.Event) error {
	msg, ok, err := FromEvent(e)
	if err != nil {
		logx.FromContext(ctx).Error("admin feed: event skipped", "event_id", e.ID, "error", err.Error())
		return nil
	}
	if !ok {
		return nil
	}
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("encode admin feed message %s: %w", e.ID, err)
	}
	if err := p.rdb.Publish(ctx, Channel, body).Err(); err != nil {
		return fmt.Errorf("publish event %s to the admin feed: %w", e.ID, err)
	}
	return nil
}
