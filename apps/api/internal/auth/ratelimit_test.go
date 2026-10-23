package auth

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// fakeCounter is an in-memory ratelimitx.Client.
type fakeCounter struct {
	mu      sync.Mutex
	counts  map[string]int64
	expires map[string]time.Duration
	pttl    time.Duration
	incrErr error
}

func newFakeCounter() *fakeCounter {
	return &fakeCounter{counts: map[string]int64{}, expires: map[string]time.Duration{}}
}

func (c *fakeCounter) Incr(_ context.Context, key string) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.incrErr != nil {
		return 0, c.incrErr
	}
	c.counts[key]++
	return c.counts[key], nil
}

func (c *fakeCounter) Expire(_ context.Context, key string, ttl time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.expires[key] = ttl
	return nil
}

func (c *fakeCounter) PTTL(context.Context, string) (time.Duration, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.pttl, nil
}

func (c *fakeCounter) keys() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var keys []string
	for k := range c.counts {
		keys = append(keys, k)
	}
	return keys
}

func TestRedisRateLimiter_Allow(t *testing.T) {
	counter := newFakeCounter()
	counter.pttl = 90 * time.Second
	limit := Limit{Name: "test-limit", Max: 2, Window: time.Hour}
	l := NewRedisRateLimiter(counter, []Limit{limit})
	ctx := context.Background()

	for i := range 2 {
		ok, retry, err := l.Allow(ctx, limit, "203.0.113.7")
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, ok, "attempt %d is within the limit", i+1)
		testx.AssertEqual(t, retry, time.Duration(0))
	}
	ok, retry, err := l.Allow(ctx, limit, "203.0.113.7")
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, ok, "the third attempt is over the limit")
	testx.AssertEqual(t, retry, 90*time.Second)

	// Another key has its own counter.
	ok, _, err = l.Allow(ctx, limit, "198.51.100.1")
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok)

	// Keys are under goshop:rl:<limit name>, and expire with the window.
	keys := counter.keys()
	testx.AssertEqual(t, len(keys), 2)
	for _, k := range keys {
		testx.AssertTrue(t, strings.HasPrefix(k, "goshop:rl:test-limit:"), "key %q", k)
		testx.AssertEqual(t, counter.expires[k], time.Hour)
	}
}

func TestRedisRateLimiter_LimitsAreSeparate(t *testing.T) {
	counter := newFakeCounter()
	a := Limit{Name: "a", Max: 1, Window: time.Minute}
	b := Limit{Name: "b", Max: 1, Window: time.Minute}
	l := NewRedisRateLimiter(counter, []Limit{a, b})
	ctx := context.Background()

	ok, _, _ := l.Allow(ctx, a, "k")
	testx.AssertTrue(t, ok)
	ok, _, _ = l.Allow(ctx, b, "k")
	testx.AssertTrue(t, ok, "the same key under another limit has its own counter")
	ok, _, _ = l.Allow(ctx, a, "k")
	testx.AssertFalse(t, ok)
}

func TestRedisRateLimiter_Errors(t *testing.T) {
	counter := newFakeCounter()
	l := NewRedisRateLimiter(counter, []Limit{LimitLoginPerIP})

	t.Run("a limit it was not built with", func(t *testing.T) {
		ok, _, err := l.Allow(context.Background(), LimitResetPerIP, "k")
		testx.AssertFalse(t, ok)
		testx.AssertError(t, err)
		testx.AssertEqual(t, err.Error(), `rate limit "reset-ip" is not configured`)
		testx.AssertEqual(t, len(counter.keys()), 0)
	})
	t.Run("redis fails", func(t *testing.T) {
		counter.incrErr = errBoom
		ok, _, err := l.Allow(context.Background(), LimitLoginPerIP, "k")
		testx.AssertFalse(t, ok)
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "rate limit login-ip: "), "err = %v", err)
	})
}

// Every limit the handlers use is configured, and their names (part of the
// Redis key) are unique.
func TestLimits(t *testing.T) {
	names := map[string]bool{}
	for _, l := range Limits {
		testx.AssertFalse(t, names[l.Name], "duplicate limit name %q", l.Name)
		names[l.Name] = true
		testx.AssertTrue(t, l.Max > 0 && l.Window > 0, "limit %+v", l)
	}
	for _, l := range []Limit{
		LimitLoginPerIP, LimitLoginPerEmail, LimitRegisterPerIP, LimitForgotPerIP, LimitForgotPerEmail,
		LimitGooglePerIP, LimitResendPerUser, LimitRefreshPerIP, LimitVerifyEmailPerIP, LimitResetPerIP,
	} {
		testx.AssertTrue(t, names[l.Name], "%s is missing from Limits", l.Name)
	}
	testx.AssertEqual(t, len(Limits), 10)
	// The documented brute-force limits.
	testx.AssertEqual(t, LimitLoginPerEmail, Limit{Name: "login-email", Max: 5, Window: 15 * time.Minute})
	testx.AssertEqual(t, LimitLoginPerIP, Limit{Name: "login-ip", Max: 20, Window: 15 * time.Minute})
}

func TestEmailKey(t *testing.T) {
	k := EmailKey("budi@example.com")
	testx.AssertEqual(t, len(k), 32, "16 bytes of SHA-256, hex")
	testx.AssertEqual(t, EmailKey("  Budi@EXAMPLE.com "), k, "normalised first, so case and spaces share a counter")
	testx.AssertNotEqual(t, EmailKey("budi2@example.com"), k)
	testx.AssertFalse(t, strings.Contains(k, "budi"), "the key holds no address")
	// SHA-256("budi@example.com"), first 16 bytes: a fixed value, so a
	// change of hash would show (and reset every counter).
	testx.AssertEqual(t, k, "0b56f1259b38a335ddd59dde3b9e33ce")
}
