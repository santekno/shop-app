// Package redisconn opens the API's Redis connection (go-redis v9) and
// adapts it to the small client interfaces of santekno/sdk: redisx and
// ratelimitx each declare the few commands they need, with signatures that
// differ from go-redis's (it returns command objects, not values), so each
// gets a thin adapter here (docs/sdk-gaps.md).
package redisconn

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/redisx"
)

// connectTimeout bounds the first ping, so a wrong address fails the start
// in seconds.
const connectTimeout = 5 * time.Second

// Open connects to url (REDIS_URL, redis:// or rediss:// for TLS) and pings
// once: the API refuses to start without Redis, because authenticated
// requests and rate limits need it. The caller closes the client. No error
// repeats the URL, which can hold a password.
func Open(ctx context.Context, url string) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, errors.New("open redis: REDIS_URL is not a valid redis:// URL")
	}
	// Short command timeouts: Redis answers in well under a millisecond, and
	// a request must not hang on it.
	opts.DialTimeout, opts.ReadTimeout, opts.WriteTimeout = connectTimeout, time.Second, time.Second
	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("open redis: ping %s: %w", opts.Addr, err)
	}
	return client, nil
}

// KV adapts a go-redis client to redisx.RedisClient.
type KV struct{ c redis.UniversalClient }

var _ redisx.RedisClient = KV{}

// NewKV returns the adapter for c.
func NewKV(c redis.UniversalClient) KV { return KV{c: c} }

// Get implements redisx.RedisClient: a missing key is ("",
// redisx.ErrKeyNotFound), as redisx documents, where go-redis says redis.Nil.
func (k KV) Get(ctx context.Context, key string) (string, error) {
	v, err := k.c.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", redisx.ErrKeyNotFound
	}
	if err != nil {
		return "", fmt.Errorf("redis get: %w", err)
	}
	return v, nil
}

// Set implements redisx.RedisClient.
func (k KV) Set(ctx context.Context, key string, value any, ttl time.Duration) error {
	if err := k.c.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("redis set: %w", err)
	}
	return nil
}

// Del implements redisx.RedisClient.
func (k KV) Del(ctx context.Context, keys ...string) error {
	if err := k.c.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("redis del: %w", err)
	}
	return nil
}

// SetNX implements redisx.RedisClient.
func (k KV) SetNX(ctx context.Context, key string, value any, ttl time.Duration) (bool, error) {
	ok, err := k.c.SetNX(ctx, key, value, ttl).Result()
	if err != nil {
		return false, fmt.Errorf("redis setnx: %w", err)
	}
	return ok, nil
}

// Counter adapts a go-redis client to ratelimitx.Client.
type Counter struct{ c redis.UniversalClient }

// NewCounter returns the adapter for c.
func NewCounter(c redis.UniversalClient) Counter { return Counter{c: c} }

// Incr implements ratelimitx.Client.
func (k Counter) Incr(ctx context.Context, key string) (int64, error) {
	n, err := k.c.Incr(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("redis incr: %w", err)
	}
	return n, nil
}

// Expire implements ratelimitx.Client.
func (k Counter) Expire(ctx context.Context, key string, ttl time.Duration) error {
	if err := k.c.Expire(ctx, key, ttl).Err(); err != nil {
		return fmt.Errorf("redis expire: %w", err)
	}
	return nil
}

// PTTL implements ratelimitx.Client.
func (k Counter) PTTL(ctx context.Context, key string) (time.Duration, error) {
	d, err := k.c.PTTL(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("redis pttl: %w", err)
	}
	return d, nil
}

// Pinger adapts a go-redis client to healthx.Pinger, for the readiness
// check.
type Pinger struct{ c redis.UniversalClient }

// NewPinger returns the adapter for c.
func NewPinger(c redis.UniversalClient) Pinger { return Pinger{c: c} }

// PingContext implements healthx.Pinger.
func (p Pinger) PingContext(ctx context.Context) error {
	if err := p.c.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}
