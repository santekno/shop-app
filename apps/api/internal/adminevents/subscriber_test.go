package adminevents_test

import (
	"context"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/adminevents"
)

// receive is the next message of sub, failing the test after a while so a
// bug hangs nothing; ok is false once Messages is closed.
func receive(t *testing.T, sub adminevents.Subscription) (string, bool) {
	t.Helper()
	select {
	case m, ok := <-sub.Messages():
		return m, ok
	case <-time.After(5 * time.Second):
		t.Fatal("no message and Messages not closed")
		return "", false
	}
}

func TestRedisSubscriber_Subscribe(t *testing.T) {
	fake := newPubsubRedis(t)
	sub, err := adminevents.NewRedisSubscriber(fake.client(t)).Subscribe(context.Background())
	testx.AssertNoError(t, err)
	defer func() { _ = sub.Close() }()

	testx.AssertEqual(t, fake.waitSubscribed(t), adminevents.Channel)
	// Subscribe returned after the confirmation: a message published now
	// is not missed.
	testx.AssertEqual(t, fake.publish(adminevents.Channel, "first"), 1)
	testx.AssertEqual(t, fake.publish(adminevents.Channel, `{"id":"e2"}`), 1)

	m, ok := receive(t, sub)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, m, "first")
	m, ok = receive(t, sub)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, m, `{"id":"e2"}`, "the raw payload")
}

func TestRedisSubscriber_SubscribeRefused(t *testing.T) {
	fake := newPubsubRedis(t)
	fake.mu.Lock()
	fake.refuseSubscribe = true
	fake.mu.Unlock()
	sub, err := adminevents.NewRedisSubscriber(fake.client(t)).Subscribe(context.Background())
	testx.AssertTrue(t, sub == nil, "no subscription")
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "subscribe to goshop:admin:events: ")
	testx.AssertContains(t, err.Error(), "subscriptions are off")
}

func TestRedisSubscriber_SubscribeRedisDown(t *testing.T) {
	fake := newPubsubRedis(t)
	c := redis.NewClient(&redis.Options{Addr: fake.ln.Addr().String(), MaxRetries: -1})
	_ = c.Close() // a closed client fails at once, without the network
	sub, err := adminevents.NewRedisSubscriber(c).Subscribe(context.Background())
	testx.AssertTrue(t, sub == nil)
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "subscribe to goshop:admin:events: ")
}

func TestRedisSubscriber_SubscribeCanceled(t *testing.T) {
	fake := newPubsubRedis(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	sub, err := adminevents.NewRedisSubscriber(fake.client(t)).Subscribe(ctx)
	testx.AssertTrue(t, sub == nil)
	testx.AssertError(t, err)
}

// After a lost connection go-redis subscribes again by itself; whatever
// was published in between is gone, so Messages closes and the stream
// ends: the client reconnects and refetches instead of silently missing an
// order.
func TestRedisSubscriber_LostConnectionEndsTheSubscription(t *testing.T) {
	fake := newPubsubRedis(t)
	sub, err := adminevents.NewRedisSubscriber(fake.client(t)).Subscribe(context.Background())
	testx.AssertNoError(t, err)
	defer func() { _ = sub.Close() }()
	fake.waitSubscribed(t)

	fake.drop()
	testx.AssertEqual(t, fake.waitSubscribed(t), adminevents.Channel, "go-redis subscribed again")
	_, ok := receive(t, sub)
	testx.AssertFalse(t, ok, "Messages is closed after the new subscribe")
}

func TestRedisSubscription_Close(t *testing.T) {
	fake := newPubsubRedis(t)
	sub, err := adminevents.NewRedisSubscriber(fake.client(t)).Subscribe(context.Background())
	testx.AssertNoError(t, err)
	fake.waitSubscribed(t)

	testx.AssertNoError(t, sub.Close())
	_, ok := receive(t, sub)
	testx.AssertFalse(t, ok, "Messages is closed by Close")

	// A second Close does not panic (closeOnce) and says the connection
	// is already gone.
	err = sub.Close()
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "close subscription: ")
}

// A message nobody reads does not keep the subscription alive: Close ends
// the forwarding goroutine that is waiting to hand it over.
func TestRedisSubscription_CloseWhileAMessageWaits(t *testing.T) {
	fake := newPubsubRedis(t)
	sub, err := adminevents.NewRedisSubscriber(fake.client(t)).Subscribe(context.Background())
	testx.AssertNoError(t, err)
	fake.waitSubscribed(t)
	fake.publish(adminevents.Channel, "unread")
	fake.publish(adminevents.Channel, "also unread")

	testx.AssertNoError(t, sub.Close())
	// At most the message that was already being handed over arrives,
	// then Messages closes.
	for range 3 {
		if _, ok := receive(t, sub); !ok {
			return
		}
	}
	t.Fatal("Messages was not closed after Close")
}
