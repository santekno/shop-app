package order

import (
	"net/http"
	"time"

	"github.com/santekno/sdk/ctxx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
)

// DefaultLimitPerMinute is how many previews, shipping quotes and
// checkouts one buyer may ask for per minute, each, when
// APP_CHECKOUT_LIMIT_PER_MINUTE is not set: far above what a person clicks,
// far below what a script enumerating voucher codes, or using the API to
// flood the courier rates API, needs.
const DefaultLimitPerMinute = 30

// Limits are the per-buyer rate limits of the checkout routes (OWASP API4,
// API6). Every preview and quote may call the courier rates API, and the
// preview answers which voucher codes exist.
type Limits struct {
	Preview  auth.Limit
	Quotes   auth.Limit
	Checkout auth.Limit
}

// NewLimits returns the limits at perMinute requests per buyer per minute
// for each route; 0 or less means DefaultLimitPerMinute.
func NewLimits(perMinute int) Limits {
	if perMinute <= 0 {
		perMinute = DefaultLimitPerMinute
	}
	return Limits{
		Preview:  auth.Limit{Name: "checkout-preview-user", Max: perMinute, Window: time.Minute},
		Quotes:   auth.Limit{Name: "shipping-quotes-user", Max: perMinute, Window: time.Minute},
		Checkout: auth.Limit{Name: "checkout-user", Max: perMinute, Window: time.Minute},
	}
}

// All lists the limits, for auth.NewRedisRateLimiter.
func (l Limits) All() []auth.Limit { return []auth.Limit{l.Preview, l.Quotes, l.Checkout} }

// LimitPerBuyer makes the checkout routes count each buyer's requests
// under limits with limiter (internal/app always calls it). It returns h.
func (h *Handler) LimitPerBuyer(limiter auth.RateLimiter, limits Limits) *Handler {
	h.limiter, h.limits = limiter, limits
	return h
}

// allow counts one request of the caller under limit, or answers 429.
// Without LimitPerBuyer nothing is counted: that is a seam for handler
// tests only. internal/app always calls LimitPerBuyer, which
// TestApp_CheckoutRoutesAreLimitedPerBuyer checks.
func (h *Handler) allow(w http.ResponseWriter, r *http.Request, limit auth.Limit) bool {
	if h.limiter == nil {
		return true
	}
	return auth.Allow(w, r, h.limiter, limit, ctxx.UserID(r.Context()))
}
