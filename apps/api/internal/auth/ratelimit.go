package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/santekno/sdk/ratelimitx"
)

// Limit is one rate limit: at most Max attempts per Window for one key (an
// IP address, an email, a user). Name is part of the Redis key.
type Limit struct {
	Name   string
	Max    int
	Window time.Duration
}

// The limits on the endpoints an attacker would hammer. Per IP stops one
// machine from trying many accounts; per email stops many machines from
// trying one account. The per-email login limit also means an attacker can
// lock a victim out of password login for up to 15 minutes; that is the
// accepted price (OWASP), and Google sign-in and the reset email still
// work.
var (
	LimitLoginPerIP     = Limit{Name: "login-ip", Max: 20, Window: 15 * time.Minute}
	LimitLoginPerEmail  = Limit{Name: "login-email", Max: 5, Window: 15 * time.Minute}
	LimitRegisterPerIP  = Limit{Name: "register-ip", Max: 10, Window: time.Hour}
	LimitForgotPerIP    = Limit{Name: "forgot-ip", Max: 5, Window: time.Hour}
	LimitForgotPerEmail = Limit{Name: "forgot-email", Max: 3, Window: time.Hour}
	LimitGooglePerIP    = Limit{Name: "google-ip", Max: 20, Window: 15 * time.Minute}
	LimitResendPerUser  = Limit{Name: "resend-user", Max: 3, Window: time.Hour}
	// The token endpoints cannot be brute-forced (256-bit secrets), but each
	// attempt costs a query, and a reset an argon2id hash: these limits
	// bound that work (OWASP API4).
	LimitRefreshPerIP     = Limit{Name: "refresh-ip", Max: 60, Window: 15 * time.Minute}
	LimitVerifyEmailPerIP = Limit{Name: "verify-email-ip", Max: 30, Window: 15 * time.Minute}
	LimitResetPerIP       = Limit{Name: "reset-ip", Max: 10, Window: time.Hour}
)

// Limits is every limit the auth endpoints use, for NewRedisRateLimiter.
var Limits = []Limit{
	LimitLoginPerIP, LimitLoginPerEmail, LimitRegisterPerIP, LimitForgotPerIP,
	LimitForgotPerEmail, LimitGooglePerIP, LimitResendPerUser,
	LimitRefreshPerIP, LimitVerifyEmailPerIP, LimitResetPerIP,
}

// RateLimiter counts attempts. The API uses RedisRateLimiter; a test passes
// a fake that allows or refuses on demand.
type RateLimiter interface {
	// Allow counts one attempt for key under limit. When the attempt is
	// over the limit, allowed is false and retryAfter says when to try
	// again.
	Allow(ctx context.Context, limit Limit, key string) (allowed bool, retryAfter time.Duration, err error)
}

// RedisRateLimiter is a fixed-window counter in Redis per limit and key,
// from sdk ratelimitx. Counters live in Redis, so every API instance shares
// them.
type RedisRateLimiter struct {
	limiters map[string]*ratelimitx.Limiter
}

// NewRedisRateLimiter returns a limiter for limits on client (a go-redis
// client through redisconn.Counter).
func NewRedisRateLimiter(client ratelimitx.Client, limits []Limit) *RedisRateLimiter {
	l := &RedisRateLimiter{limiters: make(map[string]*ratelimitx.Limiter, len(limits))}
	for _, limit := range limits {
		l.limiters[limit.Name] = ratelimitx.New(client,
			ratelimitx.WithLimit(limit.Max),
			ratelimitx.WithWindow(limit.Window),
			ratelimitx.WithPrefix("goshop:rl:"+limit.Name),
		)
	}
	return l
}

// Allow implements RateLimiter. A limit it was not built with is a
// programming mistake and an error.
func (l *RedisRateLimiter) Allow(ctx context.Context, limit Limit, key string) (bool, time.Duration, error) {
	limiter, ok := l.limiters[limit.Name]
	if !ok {
		return false, 0, fmt.Errorf("rate limit %q is not configured", limit.Name)
	}
	res, err := limiter.Allow(ctx, key)
	if err != nil {
		return false, 0, fmt.Errorf("rate limit %s: %w", limit.Name, err)
	}
	return res.Allowed, res.RetryAfter, nil
}

// EmailKey is the rate-limit key for an email: a hash of its normalised
// form, so Redis holds no addresses and Budi@ and budi@ share a counter.
func EmailKey(email string) string {
	sum := sha256.Sum256([]byte(NormalizeEmail(email)))
	return hex.EncodeToString(sum[:16])
}
