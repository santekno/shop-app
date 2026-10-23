package order

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestNewLimits(t *testing.T) {
	l := NewLimits(12)
	testx.AssertEqual(t, l.Preview, auth.Limit{Name: "checkout-preview-user", Max: 12, Window: time.Minute})
	testx.AssertEqual(t, l.Quotes, auth.Limit{Name: "shipping-quotes-user", Max: 12, Window: time.Minute})
	testx.AssertEqual(t, l.Checkout, auth.Limit{Name: "checkout-user", Max: 12, Window: time.Minute})
	all := l.All()
	testx.AssertEqual(t, len(all), 3)
	testx.AssertEqual(t, all[0], l.Preview)
	testx.AssertEqual(t, all[1], l.Quotes)
	testx.AssertEqual(t, all[2], l.Checkout)

	for _, n := range []int{0, -1} {
		d := NewLimits(n)
		for _, limit := range d.All() {
			testx.AssertEqual(t, limit.Max, DefaultLimitPerMinute, "%d means the default", n)
		}
	}
	testx.AssertEqual(t, DefaultLimitPerMinute, 30)
	testx.AssertEqual(t, NewLimits(1).Checkout.Max, 1, "1 is a real limit")
}

// buyerLimiter refuses the limits named in refuse and records each check.
type buyerLimiter struct {
	refuse map[string]bool
	err    error
	checks []string
}

func (l *buyerLimiter) Allow(_ context.Context, limit auth.Limit, key string) (bool, time.Duration, error) {
	l.checks = append(l.checks, limit.Name+":"+key)
	if l.err != nil {
		return false, 0, l.err
	}
	if l.refuse[limit.Name] {
		return false, 42 * time.Second, nil
	}
	return true, 0, nil
}

// serveWith serves method path with body as the buyer through h.
func serveWith(h *Handler, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	h.Routes(r)
	ctx := ctxx.WithUserID(context.Background(), buyerID)
	req := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(body))
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// limitedOrder serves method path as the buyer through a handler limited
// by l.
func limitedOrder(f *fakeOrders, l auth.RateLimiter, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	h := NewHandler(f, f, f, httpapi.NewValidator()).LimitPerBuyer(l, NewLimits(5))
	return serveWith(h, method, path, body, header)
}

func TestHandler_LimitPerBuyer(t *testing.T) {
	routes := []struct {
		limit, method, path, body string
		header                    map[string]string
	}{
		{limit: "checkout-preview-user", method: http.MethodPost, path: "/checkout/preview", body: `{}`},
		{limit: "shipping-quotes-user", method: http.MethodGet, path: "/checkout/shipping-quotes?address_id=" + addressID},
		{limit: "checkout-user", method: http.MethodPost, path: "/checkout", body: checkoutBodyJSON(""), header: map[string]string{HeaderIdempotencyKey: "k"}},
	}
	for _, rt := range routes {
		t.Run(rt.limit, func(t *testing.T) {
			t.Run("counted per buyer, then served", func(t *testing.T) {
				f := &fakeOrders{resp: Response{Status: http.StatusCreated, Body: []byte(`{}`)}}
				l := &buyerLimiter{}
				rec := limitedOrder(f, l, rt.method, rt.path, rt.body, rt.header)
				testx.AssertTrue(t, rec.Code < 400, "status %d: %s", rec.Code, rec.Body.String())
				testx.AssertEqual(t, strings.Join(l.checks, ","), rt.limit+":"+buyerID, "one check, keyed by the buyer")
				testx.AssertEqual(t, len(f.calls), 1)
			})
			t.Run("over the limit: 429 before any work", func(t *testing.T) {
				f := &fakeOrders{}
				l := &buyerLimiter{refuse: map[string]bool{rt.limit: true}}
				rec := limitedOrder(f, l, rt.method, rt.path, rt.body, rt.header)
				assertError(t, rec, http.StatusTooManyRequests, httpapi.CodeRateLimited)
				testx.AssertEqual(t, rec.Header().Get("Retry-After"), "42")
				testx.AssertEqual(t, len(f.calls), 0, "no provider call and no database work")
			})
			t.Run("the limit comes before the request's own checks", func(t *testing.T) {
				f := &fakeOrders{}
				l := &buyerLimiter{refuse: map[string]bool{rt.limit: true}}
				// A bad body or query, and no Idempotency-Key: still 429.
				rec := limitedOrder(f, l, rt.method, strings.SplitN(rt.path, "?", 2)[0], "nope", nil)
				assertError(t, rec, http.StatusTooManyRequests, httpapi.CodeRateLimited)
			})
			t.Run("a limiter that fails stops the request", func(t *testing.T) {
				f := &fakeOrders{}
				rec := limitedOrder(f, &buyerLimiter{err: errBoom}, rt.method, rt.path, rt.body, rt.header)
				assertError(t, rec, http.StatusInternalServerError, httpapi.CodeInternal)
				testx.AssertEqual(t, len(f.calls), 0)
			})
		})
	}
	t.Run("other limits do not apply to a route", func(t *testing.T) {
		f := &fakeOrders{}
		l := &buyerLimiter{refuse: map[string]bool{"checkout-user": true, "shipping-quotes-user": true}}
		rec := limitedOrder(f, l, http.MethodPost, "/checkout/preview", `{}`, nil)
		testx.AssertEqual(t, rec.Code, http.StatusOK)
	})
	t.Run("without LimitPerBuyer nothing is counted", func(t *testing.T) {
		f := &fakeOrders{}
		rec := serveOrder(f, http.MethodPost, "/checkout/preview", `{}`, nil)
		testx.AssertEqual(t, rec.Code, http.StatusOK)
	})
	t.Run("the order reads are not limited", func(t *testing.T) {
		f := &fakeOrders{order: sampleOrder()}
		l := &buyerLimiter{refuse: map[string]bool{"checkout-preview-user": true, "shipping-quotes-user": true, "checkout-user": true}}
		rec := limitedOrder(f, l, http.MethodGet, "/orders/"+orderID1, "", nil)
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		testx.AssertEqual(t, len(l.checks), 0)
	})
	testx.AssertTrue(t, NewHandler(nil, nil, nil, nil).LimitPerBuyer(nil, Limits{}) != nil, "LimitPerBuyer returns the handler")
}
