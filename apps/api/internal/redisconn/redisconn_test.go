package redisconn_test

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/redisx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/redisconn"
)

// client is a go-redis client on the fake server, without retries so a
// failure shows at once.
func client(t *testing.T, f *fakeRedis) *redis.Client {
	t.Helper()
	c := redis.NewClient(&redis.Options{Addr: f.addr(), MaxRetries: -1, DialTimeout: time.Second})
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func TestOpen(t *testing.T) {
	f := newFakeRedis(t)
	c, err := redisconn.Open(context.Background(), "redis://"+f.addr()+"/0")
	testx.AssertNoError(t, err)
	t.Cleanup(func() { _ = c.Close() })
	opts := c.Options()
	// Redis answers in well under a millisecond: short timeouts.
	testx.AssertEqual(t, opts.ReadTimeout, time.Second)
	testx.AssertEqual(t, opts.WriteTimeout, time.Second)
	testx.AssertEqual(t, opts.DialTimeout, 5*time.Second)
	testx.AssertEqual(t, strings.Join(f.seen(), ","), "PING", "Open pings once")
}

func TestOpen_RefusesABadURLWithoutEchoingIt(t *testing.T) {
	for _, url := range []string{"", "http://user:pass@cache:6379", "redis://user:pass@cache:notaport", "::"} {
		c, err := redisconn.Open(context.Background(), url)
		testx.AssertTrue(t, c == nil)
		testx.AssertError(t, err)
		testx.AssertEqual(t, err.Error(), "open redis: REDIS_URL is not a valid redis:// URL")
	}
}

func TestOpen_UnreachableNamesTheAddressNotThePassword(t *testing.T) {
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	testx.AssertNoError(t, err)
	addr := ln.Addr().String()
	_ = ln.Close() // nothing listens there now

	c, err := redisconn.Open(context.Background(), "redis://user:pass@"+addr+"/0")

	testx.AssertTrue(t, c == nil)
	testx.AssertError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open redis: ping "+addr+": "), "err = %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), "pass"), "the password leaks: %v", err)
}

func TestKV(t *testing.T) {
	f := newFakeRedis(t)
	kv := redisconn.NewKV(client(t, f))
	ctx := context.Background()

	v, err := kv.Get(ctx, "missing")
	testx.AssertTrue(t, errors.Is(err, redisx.ErrKeyNotFound), "a missing key is redisx.ErrKeyNotFound: %v", err)
	testx.AssertEqual(t, v, "")

	testx.AssertNoError(t, kv.Set(ctx, "k", "1", 15*time.Minute))
	v, err = kv.Get(ctx, "k")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, v, "1")

	ok, err := kv.SetNX(ctx, "k", "2", time.Minute)
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, ok, "SetNX on an existing key")
	ok, err = kv.SetNX(ctx, "fresh", "2", time.Minute)
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok)

	testx.AssertNoError(t, kv.Del(ctx, "k", "fresh"))
	_, err = kv.Get(ctx, "k")
	testx.AssertTrue(t, errors.Is(err, redisx.ErrKeyNotFound))

	seen := strings.Join(f.seen(), ",")
	testx.AssertContains(t, seen, "SET k 1 ex 900", "the TTL reaches Redis")
}

func TestKV_Errors(t *testing.T) {
	f := newFakeRedis(t)
	f.setFail(true)
	kv := redisconn.NewKV(client(t, f))
	ctx := context.Background()

	_, err := kv.Get(ctx, "k")
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis get: "), "err = %v", err)
	testx.AssertFalse(t, errors.Is(err, redisx.ErrKeyNotFound), "a failure is not a missing key")
	err = kv.Set(ctx, "k", "1", time.Minute)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis set: "), "err = %v", err)
	err = kv.Del(ctx, "k")
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis del: "), "err = %v", err)
	_, err = kv.SetNX(ctx, "k", "1", time.Minute)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis setnx: "), "err = %v", err)
}

func TestCounter(t *testing.T) {
	f := newFakeRedis(t)
	c := redisconn.NewCounter(client(t, f))
	ctx := context.Background()

	n, err := c.Incr(ctx, "rl")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, n, int64(1))
	n, err = c.Incr(ctx, "rl")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, n, int64(2))
	testx.AssertNoError(t, c.Expire(ctx, "rl", 90*time.Second))
	d, err := c.PTTL(ctx, "rl")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, d, 90*time.Second)

	f.setFail(true)
	_, err = c.Incr(ctx, "rl")
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis incr: "), "err = %v", err)
	err = c.Expire(ctx, "rl", time.Second)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis expire: "), "err = %v", err)
	_, err = c.PTTL(ctx, "rl")
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis pttl: "), "err = %v", err)
}

func TestPinger(t *testing.T) {
	f := newFakeRedis(t)
	p := redisconn.NewPinger(client(t, f))
	testx.AssertNoError(t, p.PingContext(context.Background()))
	f.setFail(true)
	err := p.PingContext(context.Background())
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "redis ping: "), "err = %v", err)
}
