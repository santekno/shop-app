package adminevents_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/adminevents"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
)

const orderID = "0190c8a0-0000-7000-8000-0000000000d1"

// orderEvent is an outbox event as the order package writes it, buyer
// fields included.
func orderEvent(id, typ string) outbox.Event {
	return outbox.Event{
		ID: id, AggregateType: "order", AggregateID: orderID, Type: typ,
		Payload: json.RawMessage(`{"order_id":"` + orderID + `","code":"GS-20261030-0001",` +
			`"user_id":"0190c8a0-0000-7000-8000-0000000000u1","status":"paid","cancel_reason":"buyer_cancelled",` +
			`"total":159000,"currency":"IDR","occurred_at":"2026-10-30T14:05:06+07:00","address":"Jl. Rahasia 1"}`),
	}
}

// The data of an order message: the named fields only, in UTC.
const wantOrderData = `{"type":"order.paid","order_id":"` + orderID + `","code":"GS-20261030-0001","status":"paid",` +
	`"total":{"amount":159000,"currency":"IDR"},"occurred_at":"2026-10-30T07:05:06Z"}`

func TestConstants(t *testing.T) {
	testx.AssertEqual(t, adminevents.Channel, "goshop:admin:events")
	testx.AssertEqual(t, adminevents.EventOrder, "order")
	testx.AssertEqual(t, adminevents.CodeTooManyStreams, "TOO_MANY_STREAMS")
	testx.AssertEqual(t, adminevents.MaxStreamsPerUser, 5)
	testx.AssertEqual(t, adminevents.Heartbeat, 25*time.Second)
	testx.AssertEqual(t, adminevents.EndTokenExpired, "token_expired")
	testx.AssertEqual(t, adminevents.EndShutdown, "shutdown")
}

func TestFromEvent(t *testing.T) {
	msg, ok, err := adminevents.FromEvent(orderEvent("e1", "order.paid"))
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, msg.ID, "e1", "the outbox event's ID, for de-duplication")
	testx.AssertEqual(t, msg.Event, adminevents.EventOrder)
	testx.AssertEqual(t, string(msg.Data), wantOrderData)
	for _, secret := range []string{"user_id", "cancel_reason", "address", "Rahasia"} {
		testx.AssertFalse(t, strings.Contains(string(msg.Data), secret), "%s reached the dashboard", secret)
	}
}

// Every order event type passes through with its own type.
func TestFromEvent_Types(t *testing.T) {
	for _, typ := range []string{"order.created", "order.paid", "order.processing", "order.shipped", "order.completed", "order.cancelled"} {
		msg, ok, err := adminevents.FromEvent(orderEvent("e1", typ))
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, ok, typ)
		testx.AssertContains(t, string(msg.Data), `"type":"`+typ+`"`)
	}
}

func TestFromEvent_NotAnOrder(t *testing.T) {
	for _, aggregate := range []string{"payment", "user", "", "Order"} {
		e := orderEvent("e1", "order.paid")
		e.AggregateType = aggregate
		e.Payload = json.RawMessage(`not even json`)
		msg, ok, err := adminevents.FromEvent(e)
		testx.AssertNoError(t, err, "aggregate %q is skipped, not an error", aggregate)
		testx.AssertFalse(t, ok, "aggregate %q", aggregate)
		testx.AssertEqual(t, msg.ID, "")
	}
}

func TestFromEvent_BadPayload(t *testing.T) {
	for _, payload := range []string{`{`, `[]`, `{"total":"lots"}`, `{"occurred_at":"yesterday"}`} {
		e := orderEvent("e7", "order.paid")
		e.Payload = json.RawMessage(payload)
		_, ok, err := adminevents.FromEvent(e)
		testx.AssertFalse(t, ok, payload)
		testx.AssertError(t, err, payload)
		testx.AssertContains(t, err.Error(), "decode order.paid event e7: ")
	}
}

// fakeRedisPublisher records each PUBLISH and answers err.
type fakeRedisPublisher struct {
	channels []string
	messages []string
	err      error
}

func (f *fakeRedisPublisher) Publish(_ context.Context, channel string, message any) *redis.IntCmd {
	f.channels = append(f.channels, channel)
	f.messages = append(f.messages, string(message.([]byte)))
	if f.err != nil {
		return redis.NewIntResult(0, f.err)
	}
	return redis.NewIntResult(1, nil)
}

func TestPublisher_Publish(t *testing.T) {
	rdb := &fakeRedisPublisher{}
	err := adminevents.NewPublisher(rdb).Publish(context.Background(), orderEvent("e1", "order.paid"))

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(rdb.channels), 1)
	testx.AssertEqual(t, rdb.channels[0], adminevents.Channel)
	testx.AssertEqual(t, rdb.messages[0], `{"id":"e1","event":"order","data":`+wantOrderData+`}`)
}

// Nobody listening is not an error: PUBLISH answers 0 and the message is
// gone.
func TestPublisher_PublishWithoutListeners(t *testing.T) {
	rdb := &zeroListeners{}
	testx.AssertNoError(t, adminevents.NewPublisher(rdb).Publish(context.Background(), orderEvent("e1", "order.created")))
	testx.AssertEqual(t, rdb.calls, 1)
}

type zeroListeners struct{ calls int }

func (z *zeroListeners) Publish(context.Context, string, any) *redis.IntCmd {
	z.calls++
	return redis.NewIntResult(0, nil)
}

func TestPublisher_PublishSkipsOtherEvents(t *testing.T) {
	rdb := &fakeRedisPublisher{}
	e := orderEvent("e1", "payment.settled")
	e.AggregateType = "payment"
	testx.AssertNoError(t, adminevents.NewPublisher(rdb).Publish(context.Background(), e))
	testx.AssertEqual(t, len(rdb.channels), 0, "only order events reach the feed")
}

// A payload that does not decode is logged and skipped, never returned:
// the dispatcher would retry it for ever and hold back every later event.
func TestPublisher_PublishSkipsABadPayload(t *testing.T) {
	var logs bytes.Buffer
	ctx := logx.WithContextLogger(context.Background(), logx.New(logx.WithOutput(&logs), logx.WithFormat("json")))
	rdb := &fakeRedisPublisher{}
	e := orderEvent("e9", "order.paid")
	e.Payload = json.RawMessage(`{`)

	testx.AssertNoError(t, adminevents.NewPublisher(rdb).Publish(ctx, e))
	testx.AssertEqual(t, len(rdb.channels), 0)
	testx.AssertContains(t, logs.String(), `"level":"ERROR"`)
	testx.AssertContains(t, logs.String(), `"msg":"admin feed: event skipped"`)
	testx.AssertContains(t, logs.String(), `"event_id":"e9"`)
}

// Redis down is an error, so the dispatcher tries the event again.
func TestPublisher_PublishRedisDown(t *testing.T) {
	boom := errors.New("connection refused")
	err := adminevents.NewPublisher(&fakeRedisPublisher{err: boom}).Publish(context.Background(), orderEvent("e3", "order.paid"))
	testx.AssertTrue(t, errors.Is(err, boom), "wrapped: %v", err)
	testx.AssertEqual(t, err.Error(), "publish event e3 to the admin feed: connection refused")
}

// Publisher is an outbox.Publisher.
var _ outbox.Publisher = (*adminevents.Publisher)(nil)
