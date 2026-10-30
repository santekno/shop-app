package adminevents

import (
	"context"
	"fmt"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Subscriber opens one subscription to the feed per stream.
type Subscriber interface {
	Subscribe(ctx context.Context) (Subscription, error)
}

// Subscription is one open subscription. Messages yields each message's
// raw payload and is closed when the subscription can no longer promise
// to deliver everything published: on Close, and when the connection to
// Redis was lost (messages may have been missed meanwhile).
type Subscription interface {
	Messages() <-chan string
	Close() error
}

// RedisSubscriber subscribes to Channel on Redis. Every subscription holds
// one Redis connection of its own for as long as its stream is open.
type RedisSubscriber struct {
	rdb redis.UniversalClient
}

// NewRedisSubscriber returns a RedisSubscriber on rdb.
func NewRedisSubscriber(rdb redis.UniversalClient) *RedisSubscriber {
	return &RedisSubscriber{rdb: rdb}
}

// Subscribe implements Subscriber. It returns once Redis has confirmed the
// subscription, so nothing published after it returns is missed.
func (s *RedisSubscriber) Subscribe(ctx context.Context) (Subscription, error) {
	ps := s.rdb.Subscribe(ctx, Channel)
	if _, err := ps.Receive(ctx); err != nil {
		_ = ps.Close()
		return nil, fmt.Errorf("subscribe to %s: %w", Channel, err)
	}
	sub := &redisSubscription{ps: ps, out: make(chan string), done: make(chan struct{})}
	go sub.forward(ps.ChannelWithSubscriptions())
	return sub, nil
}

type redisSubscription struct {
	ps        *redis.PubSub
	out       chan string
	done      chan struct{}
	closeOnce sync.Once
}

func (s *redisSubscription) Messages() <-chan string { return s.out }

// Close ends the subscription and releases its connection.
func (s *redisSubscription) Close() error {
	s.closeOnce.Do(func() { close(s.done) })
	if err := s.ps.Close(); err != nil {
		return fmt.Errorf("close subscription: %w", err)
	}
	return nil
}

// forward hands each message of in to out until the subscription is
// closed. go-redis reconnects and subscribes again on its own after a lost
// connection, and says so with a new "subscribe" confirmation; whatever
// was published in between is lost, so forward ends there and the stream
// closes: the client reconnects and refetches instead of silently missing
// an order.
func (s *redisSubscription) forward(in <-chan any) {
	defer close(s.out)
	for m := range in {
		switch m := m.(type) {
		case *redis.Subscription:
			if m.Kind == "subscribe" {
				return
			}
		case *redis.Message:
			select {
			case s.out <- m.Payload:
			case <-s.done:
				return
			}
		}
	}
}
