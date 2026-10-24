package notify

// Bab 6 artikel 11: the outbox's queue publisher, the routes, the event
// tasks and Once (dedupe through event_deliveries).

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/testx"
)

func TestNewRoutes(t *testing.T) {
	without := NewRoutes(false)
	testx.AssertEqual(t, len(without), 3)
	testx.AssertEqual(t, strings.Join(without["order.created"], ","), TypeOrderConfirmationEmail)
	testx.AssertEqual(t, strings.Join(without["order.paid"], ","), TypePaymentReceivedEmail)
	testx.AssertEqual(t, strings.Join(without["order.shipped"], ","), TypeOrderShippedEmail)

	with := NewRoutes(true)
	testx.AssertEqual(t, strings.Join(with["order.paid"], ","), TypePaymentReceivedEmail+","+TypeSellerPaidOrder)
	testx.AssertEqual(t, strings.Join(with["order.created"], ","), TypeOrderConfirmationEmail)
	testx.AssertEqual(t, strings.Join(with["order.shipped"], ","), TypeOrderShippedEmail)

	// A second call never changes the routes handed out before.
	testx.AssertEqual(t, strings.Join(without["order.paid"], ","), TypePaymentReceivedEmail)
	testx.AssertEqual(t, strings.Join(NewRoutes(false)["order.paid"], ","), TypePaymentReceivedEmail)
}

func TestNewEventTask(t *testing.T) {
	e := testEvent("order.paid")
	task, err := NewEventTask(TypePaymentReceivedEmail, e)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, task.Type(), TypePaymentReceivedEmail)
	var fields map[string]json.RawMessage
	testx.AssertNoError(t, json.Unmarshal(task.Payload(), &fields))
	testx.AssertEqual(t, len(fields), 5)
	testx.AssertEqual(t, string(fields["event_id"]), `"`+e.ID+`"`)
	testx.AssertEqual(t, string(fields["type"]), `"order.paid"`)
	testx.AssertEqual(t, string(fields["aggregate_id"]), `"`+e.AggregateID+`"`)
	testx.AssertEqual(t, string(fields["payload"]), `{"code":"GS-20261024-ABC123"}`)
	testx.AssertEqual(t, string(fields["occurred_at"]), `"2026-10-24T01:02:03Z"`)

	ev, err := decodeEvent(task)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, ev.EventID, e.ID)
	testx.AssertEqual(t, ev.AggregateID, e.AggregateID)
	testx.AssertTrue(t, ev.OccurredAt.Equal(e.CreatedAt))

	t.Run("a payload that is not JSON cannot be encoded", func(t *testing.T) {
		bad := testEvent("order.paid")
		bad.Payload = json.RawMessage(`{not json`)
		_, err := NewEventTask(TypePaymentReceivedEmail, bad)
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "encode email:payment-received task: "), "err = %v", err)
	})
}

func TestQueuePublisher_Publish(t *testing.T) {
	t.Run("one task per consumer, with its id, retry, timeout and retention", func(t *testing.T) {
		client, rdb := newFakeAsynq(t)
		ctx, logs := logCtx()
		e := testEvent("order.paid")
		err := NewQueuePublisher(client, NewRoutes(true)).Publish(ctx, e)
		testx.AssertNoError(t, err)

		calls := rdb.enqueues()
		testx.AssertEqual(t, len(calls), 2)
		for i, want := range []struct {
			taskType string
			retry    uint64
		}{{TypePaymentReceivedEmail, 8}, {TypeSellerPaidOrder, 5}} {
			id := e.ID + ":" + want.taskType
			testx.AssertEqual(t, calls[i].keys[0], "asynq:{default}:t:"+id, "the task key holds the task ID")
			testx.AssertEqual(t, calls[i].keys[1], "asynq:{default}:pending")
			testx.AssertEqual(t, calls[i].argv[1], any(id))
			m := decodeTaskMessage(t, calls[i].argv[0])
			testx.AssertEqual(t, m.ID, id)
			testx.AssertEqual(t, m.Type, want.taskType)
			testx.AssertEqual(t, m.Queue, "default")
			testx.AssertEqual(t, m.Retry, want.retry)
			testx.AssertEqual(t, m.Timeout, uint64(60))
			testx.AssertEqual(t, m.Retention, uint64(24*60*60), "kept a day, so a second publish is refused")
			var p EventPayload
			testx.AssertNoError(t, json.Unmarshal(m.Payload, &p))
			testx.AssertEqual(t, p.EventID, e.ID)
			testx.AssertEqual(t, p.AggregateID, e.AggregateID)
		}

		lines := logLines(t, logs)
		testx.AssertEqual(t, len(lines), 1)
		testx.AssertEqual(t, lines[0]["msg"], any("domain event published"))
		testx.AssertEqual(t, lines[0]["event_id"], any(e.ID))
		testx.AssertEqual(t, lines[0]["type"], any("order.paid"))
		testx.AssertEqual(t, lines[0]["aggregate_id"], any(e.AggregateID))
		testx.AssertEqual(t, lines[0]["tasks"], any(float64(2)))
	})
	t.Run("without the seller chat: only the email", func(t *testing.T) {
		client, rdb := newFakeAsynq(t)
		testx.AssertNoError(t, NewQueuePublisher(client, NewRoutes(false)).Publish(t.Context(), testEvent("order.paid")))
		calls := rdb.enqueues()
		testx.AssertEqual(t, len(calls), 1)
		testx.AssertEqual(t, decodeTaskMessage(t, calls[0].argv[0]).Type, TypePaymentReceivedEmail)
	})
	t.Run("an event nobody consumes is published as it is", func(t *testing.T) {
		client, rdb := newFakeAsynq(t)
		ctx, logs := logCtx()
		testx.AssertNoError(t, NewQueuePublisher(client, NewRoutes(true)).Publish(ctx, testEvent("order.cancelled")))
		testx.AssertEqual(t, len(rdb.enqueues()), 0)
		lines := logLines(t, logs)
		testx.AssertEqual(t, len(lines), 1)
		testx.AssertEqual(t, lines[0]["tasks"], any(float64(0)))
	})
	t.Run("published twice: the task ID conflict is not an error", func(t *testing.T) {
		client, rdb := newFakeAsynq(t, enqueueAnswer{n: 0})
		err := NewQueuePublisher(client, NewRoutes(true)).Publish(t.Context(), testEvent("order.paid"))
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(rdb.enqueues()), 2, "each task is tried")
	})
	t.Run("a Redis error ends the event", func(t *testing.T) {
		client, rdb := newFakeAsynq(t, enqueueAnswer{err: errors.New("LOADING Redis is loading the dataset")})
		e := testEvent("order.paid")
		err := NewQueuePublisher(client, NewRoutes(true)).Publish(t.Context(), e)
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "enqueue email:payment-received for event "+e.ID+": "), "err = %v", err)
		testx.AssertContains(t, err.Error(), "LOADING Redis is loading the dataset")
		testx.AssertFalse(t, errors.Is(err, asynq.ErrTaskIDConflict))
		testx.AssertEqual(t, len(rdb.enqueues()), 1, "the seller task is not enqueued")
	})
	t.Run("a Redis error on the second task", func(t *testing.T) {
		client, rdb := newFakeAsynq(t, enqueueAnswer{n: 1}, enqueueAnswer{err: errors.New("READONLY replica")})
		e := testEvent("order.paid")
		err := NewQueuePublisher(client, NewRoutes(true)).Publish(t.Context(), e)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "enqueue telegram:paid-order for event "+e.ID+": "), "err = %v", err)
		testx.AssertEqual(t, len(rdb.enqueues()), 2)
	})
}

// fakeDeliveries is an event_deliveries table in memory; it records the
// calls in order.
type fakeDeliveries struct {
	done       map[string]bool
	calls      []string
	queryErr   error
	markErr    error
	afterCalls *[]string // shared with the handler, to see the order
}

func (f *fakeDeliveries) log(s string) {
	f.calls = append(f.calls, s)
	if f.afterCalls != nil {
		*f.afterCalls = append(*f.afterCalls, s)
	}
}

func (f *fakeDeliveries) Delivered(_ context.Context, eventID, consumer string) (bool, error) {
	f.log("Delivered " + eventID + " " + consumer)
	if f.queryErr != nil {
		return false, f.queryErr
	}
	return f.done[eventID+" "+consumer], nil
}

func (f *fakeDeliveries) MarkDelivered(_ context.Context, eventID, consumer string) error {
	f.log("MarkDelivered " + eventID + " " + consumer)
	if f.markErr != nil {
		return f.markErr
	}
	if f.done == nil {
		f.done = map[string]bool{}
	}
	f.done[eventID+" "+consumer] = true
	return nil
}

func TestOnce(t *testing.T) {
	e := testEvent("order.paid")
	key := e.ID + " " + TypePaymentReceivedEmail
	newOnce := func(d *fakeDeliveries, handlerErr error) (asynq.HandlerFunc, *[]string) {
		seq := &[]string{}
		d.afterCalls = seq
		return Once(d, func(_ context.Context, task *asynq.Task) error {
			*seq = append(*seq, "handler "+task.Type())
			return handlerErr
		}), seq
	}

	t.Run("first delivery: handled, then recorded", func(t *testing.T) {
		d := &fakeDeliveries{}
		h, seq := newOnce(d, nil)
		testx.AssertNoError(t, h(t.Context(), eventTask(t, TypePaymentReceivedEmail)))
		testx.AssertEqual(t, strings.Join(*seq, " | "),
			"Delivered "+key+" | handler "+TypePaymentReceivedEmail+" | MarkDelivered "+key)
	})
	t.Run("delivered before: skipped", func(t *testing.T) {
		ctx, logs := logCtx()
		d := &fakeDeliveries{done: map[string]bool{key: true}}
		h, seq := newOnce(d, nil)
		testx.AssertNoError(t, h(ctx, eventTask(t, TypePaymentReceivedEmail)))
		testx.AssertEqual(t, strings.Join(*seq, " | "), "Delivered "+key, "neither the handler nor a second record")
		lines := logLines(t, logs)
		testx.AssertEqual(t, len(lines), 1)
		testx.AssertEqual(t, lines[0]["msg"], any("event handled before; skipped"))
		testx.AssertEqual(t, lines[0]["event_id"], any(e.ID))
		testx.AssertEqual(t, lines[0]["task"], any(TypePaymentReceivedEmail))
	})
	t.Run("delivered to another consumer only: handled", func(t *testing.T) {
		d := &fakeDeliveries{done: map[string]bool{e.ID + " " + TypeSellerPaidOrder: true}}
		h, seq := newOnce(d, nil)
		testx.AssertNoError(t, h(t.Context(), eventTask(t, TypePaymentReceivedEmail)))
		testx.AssertEqual(t, len(*seq), 3)
		testx.AssertTrue(t, d.done[key])
	})
	t.Run("twice in a row: the second is skipped", func(t *testing.T) {
		d := &fakeDeliveries{}
		h, seq := newOnce(d, nil)
		testx.AssertNoError(t, h(t.Context(), eventTask(t, TypePaymentReceivedEmail)))
		testx.AssertNoError(t, h(t.Context(), eventTask(t, TypePaymentReceivedEmail)))
		handled := 0
		for _, c := range *seq {
			if strings.HasPrefix(c, "handler ") {
				handled++
			}
		}
		testx.AssertEqual(t, handled, 1)
	})
	t.Run("the handler fails: not recorded, the error returned", func(t *testing.T) {
		d := &fakeDeliveries{}
		h, seq := newOnce(d, errBoom)
		err := h(t.Context(), eventTask(t, TypePaymentReceivedEmail))
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "boom", "returned as it is")
		testx.AssertEqual(t, strings.Join(*seq, " | "), "Delivered "+key+" | handler "+TypePaymentReceivedEmail)
		testx.AssertFalse(t, d.done[key])
	})
	t.Run("the handler skips retries: still not recorded", func(t *testing.T) {
		d := &fakeDeliveries{}
		h, _ := newOnce(d, asynq.SkipRetry)
		err := h(t.Context(), eventTask(t, TypePaymentReceivedEmail))
		testx.AssertTrue(t, errors.Is(err, asynq.SkipRetry))
		testx.AssertFalse(t, d.done[key])
	})
	t.Run("the lookup fails: not handled", func(t *testing.T) {
		d := &fakeDeliveries{queryErr: errBoom}
		h, seq := newOnce(d, nil)
		err := h(t.Context(), eventTask(t, TypePaymentReceivedEmail))
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), TypePaymentReceivedEmail+": boom")
		testx.AssertEqual(t, strings.Join(*seq, " | "), "Delivered "+key)
	})
	t.Run("the record fails: an error, so the task is retried", func(t *testing.T) {
		d := &fakeDeliveries{markErr: errBoom}
		h, seq := newOnce(d, nil)
		err := h(t.Context(), eventTask(t, TypePaymentReceivedEmail))
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), TypePaymentReceivedEmail+": boom")
		testx.AssertEqual(t, len(*seq), 3, "handled, then the record failed")
	})
	for name, payload := range badPayloads {
		t.Run("bad payload: "+name, func(t *testing.T) {
			d := &fakeDeliveries{}
			h, seq := newOnce(d, nil)
			err := h(t.Context(), asynq.NewTask(TypePaymentReceivedEmail, payload))
			testx.AssertTrue(t, errors.Is(err, asynq.SkipRetry), "err = %v", err)
			testx.AssertEqual(t, len(*seq), 0, "nothing called")
		})
	}
}

// The event's time survives the task payload as the same instant,
// whatever zone the outbox row came back in.
func TestNewEventTask_OccurredAtZone(t *testing.T) {
	e := testEvent("order.created")
	e.CreatedAt = time.Date(2026, 10, 24, 8, 2, 3, 0, time.FixedZone("WIB", 7*3600))
	task, err := NewEventTask(TypeOrderConfirmationEmail, e)
	testx.AssertNoError(t, err)
	ev, err := decodeEvent(task)
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ev.OccurredAt.Equal(time.Date(2026, 10, 24, 1, 2, 3, 0, time.UTC)), "occurred_at = %v", ev.OccurredAt)
}
