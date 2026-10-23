package auth

import (
	"context"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// at is 23 October 2026 at hh:mm:ss UTC.
func at(hh, mm, ss int) time.Time { return time.Date(2026, 10, 23, hh, mm, ss, 0, time.UTC) }

func TestUntilWindowEnds(t *testing.T) {
	tests := []struct {
		name   string
		now    time.Time
		window time.Duration
		want   time.Duration
	}{
		{name: "09:06 in a 15-minute window", now: at(9, 6, 0), window: 15 * time.Minute, want: 9 * time.Minute},
		{name: "exactly on a boundary is the whole window", now: at(9, 15, 0), window: 15 * time.Minute, want: 15 * time.Minute},
		{name: "one second before the boundary", now: at(9, 14, 59), window: 15 * time.Minute, want: time.Second},
		{name: "an hour window", now: at(9, 59, 30), window: time.Hour, want: 30 * time.Second},
		{name: "midnight starts a new hour window", now: at(0, 0, 0), window: time.Hour, want: time.Hour},
		{name: "sub-second precision", now: at(9, 6, 0).Add(250 * time.Millisecond), window: time.Minute, want: 59*time.Second + 750*time.Millisecond},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testx.AssertEqual(t, untilWindowEnds(tt.now, tt.window), tt.want)
		})
	}
}

// Allow answers the smaller of the counter's TTL and the time left in the
// clock's window: the counter key is set to live a whole window at the
// first attempt, but counting starts again when the window turns.
func TestRedisRateLimiter_RetryAfterIsCappedAtTheWindowEnd(t *testing.T) {
	limit := Limit{Name: "cap", Max: 1, Window: 15 * time.Minute}
	tests := []struct {
		name string
		now  time.Time
		pttl time.Duration
		want time.Duration
	}{
		{name: "TTL past the window end: the window end", now: at(9, 6, 0), pttl: 15 * time.Minute, want: 9 * time.Minute},
		{name: "TTL before the window end: the TTL", now: at(9, 6, 0), pttl: 2 * time.Minute, want: 2 * time.Minute},
		{name: "equal: either", now: at(9, 6, 0), pttl: 9 * time.Minute, want: 9 * time.Minute},
		// No TTL: ratelimitx falls back to the whole window, still capped.
		{name: "no TTL", now: at(9, 10, 0), pttl: 0, want: 5 * time.Minute},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			counter := newFakeCounter()
			counter.pttl = tt.pttl
			l := NewRedisRateLimiter(counter, []Limit{limit})
			l.now = func() time.Time { return tt.now }

			ok, retry, err := l.Allow(context.Background(), limit, "k")
			testx.AssertNoError(t, err)
			testx.AssertTrue(t, ok, "the first attempt is allowed")
			testx.AssertEqual(t, retry, time.Duration(0), "an allowed attempt has no Retry-After")

			ok, retry, err = l.Allow(context.Background(), limit, "k")
			testx.AssertNoError(t, err)
			testx.AssertFalse(t, ok)
			testx.AssertEqual(t, retry, tt.want)
		})
	}
}

// The limiter's clock is the one ratelimitx counts with: when it moves into
// the next window, the counter is a new key and the attempt is allowed.
func TestRedisRateLimiter_ClockPicksTheWindow(t *testing.T) {
	counter := newFakeCounter()
	counter.pttl = time.Hour
	limit := Limit{Name: "clock", Max: 1, Window: 15 * time.Minute}
	l := NewRedisRateLimiter(counter, []Limit{limit})
	now := at(9, 14, 0)
	l.now = func() time.Time { return now }

	ok, _, _ := l.Allow(context.Background(), limit, "k")
	testx.AssertTrue(t, ok)
	ok, retry, _ := l.Allow(context.Background(), limit, "k")
	testx.AssertFalse(t, ok)
	testx.AssertEqual(t, retry, time.Minute)

	now = at(9, 15, 0)
	ok, _, err := l.Allow(context.Background(), limit, "k")
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok, "a new window counts from zero")
	testx.AssertEqual(t, len(counter.keys()), 2, "one counter per window")
}
