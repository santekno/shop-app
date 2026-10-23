package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// registerFrom sends an empty sign-up from remote; it is counted under the
// per-IP limit before the body is read.
func registerFrom(h *Handler, remote string) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/auth/register", strings.NewReader(`{}`))
	r.RemoteAddr = remote
	rec := httptest.NewRecorder()
	h.Register(rec, r)
	return rec
}

// One IPv6 customer usually holds a whole /64: every address in it shares
// one per-IP counter, so changing the address does not reset the limit;
// another /64 is another customer with its own counter.
func TestHandler_IPv6SharesACounterPerSlash64(t *testing.T) {
	counter := newFakeCounter()
	counter.pttl = time.Hour
	h := NewHandler(HandlerDeps{
		Service: &fakeAccounts{}, Validator: httpapi.NewValidator(),
		Limiter: NewRedisRateLimiter(counter, []Limit{LimitRegisterPerIP}),
	})
	same := []string{"[2001:db8:1:2::5]:4000", "[2001:db8:1:2::9]:4001", "[2001:db8:1:2:aaaa::1]:4002"}
	for i := range LimitRegisterPerIP.Max {
		rec := registerFrom(h, same[i%len(same)])
		testx.AssertEqual(t, rec.Code, http.StatusBadRequest, "attempt %d is within the limit", i+1)
	}
	rec := registerFrom(h, "[2001:db8:1:2::77]:4003")
	testx.AssertEqual(t, rec.Code, http.StatusTooManyRequests, "a new address in the same /64 is still over the limit")

	rec = registerFrom(h, "[2001:db8:1:3::5]:4000")
	testx.AssertEqual(t, rec.Code, http.StatusBadRequest, "another /64 has its own counter")

	keys := counter.keys()
	testx.AssertEqual(t, len(keys), 2, "keys %v", keys)
	for _, k := range keys {
		testx.AssertTrue(t, strings.Contains(k, "2001:db8:1:2::/64") || strings.Contains(k, "2001:db8:1:3::/64"), "key %q", k)
	}
}

// The limiter sees the /64 key, after ClientIP picked the client address.
func TestHandler_ClientIPKeyIsTheSlash64(t *testing.T) {
	tests := []struct{ remote, xff, want string }{
		{remote: "[2001:db8:1:2::5]:4321", want: "2001:db8:1:2::/64"},
		{remote: "203.0.113.7:4321", want: "203.0.113.7"},
		{remote: "10.0.0.2:80", xff: "2001:db8:9:9::1", want: "2001:db8:9:9::/64"},
	}
	for _, tt := range tests {
		env := newHandlerEnv(1)
		env.svc.verifyEmail = func(string) error { return nil }
		r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/auth/verify-email", strings.NewReader(`{"token":"x"}`))
		r.RemoteAddr = tt.remote
		if tt.xff != "" {
			r.Header.Set("X-Forwarded-For", tt.xff)
		}
		env.h.VerifyEmail(httptest.NewRecorder(), r)
		testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "verify-email-ip:"+tt.want)
	}
}
