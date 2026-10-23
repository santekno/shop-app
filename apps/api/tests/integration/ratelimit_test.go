//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// The rate-limit tests run on the real Redis limiter (sdk ratelimitx) on
// the test's own Redis database, so counters start at zero and no other
// test can push them.

// assertRateLimited fails unless resp is the contract's 429: RATE_LIMITED
// with Retry-After (whole seconds, 1 to window) equal to
// details.retry_after_seconds.
func assertRateLimited(t *testing.T, resp response, window time.Duration, what string) {
	t.Helper()
	details := assertError(t, resp, http.StatusTooManyRequests, "RATE_LIMITED")
	after, err := strconv.Atoi(resp.Header.Get("Retry-After"))
	if err != nil || after < 1 || after > int(window/time.Second) {
		t.Errorf("%s: Retry-After = %q, want 1 to %d seconds", what, resp.Header.Get("Retry-After"), int(window/time.Second))
	}
	if got, _ := details["retry_after_seconds"].(float64); int(got) != after {
		t.Errorf("%s: details.retry_after_seconds = %v, want the Retry-After value %d", what, details["retry_after_seconds"], after)
	}
}

// exhaust sends limit.Max requests, which must all get past the limiter
// (any status but 429), then one more, which must be 429. req(i) sends the
// i-th request.
func exhaust(t *testing.T, limit auth.Limit, req func(i int) response) {
	t.Helper()
	for i := range limit.Max {
		if r := req(i); r.Status == http.StatusTooManyRequests {
			t.Fatalf("%s: request %d of %d was limited: %s", limit.Name, i+1, limit.Max, r.Body)
		}
	}
	assertRateLimited(t, req(limit.Max), limit.Window, limit.Name)
}

// assertCounter fails unless Redis holds a counter for limit that expires
// within its window.
func (s *server) assertCounter(t *testing.T, limit auth.Limit) {
	t.Helper()
	keys, err := s.rdb.Keys(t.Context(), "goshop:rl:"+limit.Name+"*").Result()
	if err != nil || len(keys) == 0 {
		t.Fatalf("no Redis counter for %s (err %v)", limit.Name, err)
	}
	for _, k := range keys {
		ttl, err := s.rdb.PTTL(t.Context(), k).Result()
		if err != nil || ttl <= 0 || ttl > limit.Window {
			t.Errorf("%s: TTL %s (err %v), want an expiry within %s", k, ttl, err, limit.Window)
		}
	}
}

// TestRateLimit_LoginPerEmail: five attempts per email per 15 minutes,
// whatever the case of the address and whether the password was right;
// another email from the same machine is not affected. Redis holds a hash
// of the email, never the address.
func TestRateLimit_LoginPerEmail(t *testing.T) {
	s := startServer(t, nil)
	u, _ := s.newAccount(t, "dikunci") // the login here is attempt 1
	exhaust(t, auth.Limit{Name: auth.LimitLoginPerEmail.Name, Max: auth.LimitLoginPerEmail.Max - 1, Window: auth.LimitLoginPerEmail.Window},
		func(i int) response {
			email := u.Email
			if i%2 == 1 {
				email = strings.ToUpper(email)
			}
			return s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": email, "password": wrongPassword}, "")
		})
	assertRateLimited(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": u.Email, "password": testPassword}, ""),
		auth.LimitLoginPerEmail.Window, "the right password while limited")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": uniqueEmail("lain"), "password": testPassword}, ""),
		http.StatusUnauthorized, "INVALID_CREDENTIALS")

	s.assertCounter(t, auth.LimitLoginPerEmail)
	keys, err := s.rdb.Keys(t.Context(), "*").Result()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range keys {
		if strings.Contains(strings.ToLower(k), "@") {
			t.Errorf("Redis key %q holds an email address", k)
		}
	}
}

// TestRateLimit_PerIP checks every per-IP limit from one client address:
// the limit's Max attempts go through, the next is 429, and the counter
// lives in Redis for at most the window.
func TestRateLimit_PerIP(t *testing.T) {
	g := &fakeGoogle{}
	s, _ := googleServer(t, g)
	post := func(path string, body any) response { return s.call(t, http.MethodPost, path, body, "") }
	tests := []struct {
		limit auth.Limit
		req   func(i int) response
	}{
		{auth.LimitLoginPerIP, func(int) response {
			return post("/v1/auth/login", map[string]string{"email": uniqueEmail("ip"), "password": testPassword})
		}},
		{auth.LimitRegisterPerIP, func(i int) response {
			return post("/v1/auth/register", map[string]string{"email": uniqueEmail("daftar"), "password": testPassword, "name": fmt.Sprint("D", i)})
		}},
		{auth.LimitRefreshPerIP, func(int) response {
			return post("/v1/auth/refresh", map[string]string{"refresh_token": "bukan-token"})
		}},
		{auth.LimitVerifyEmailPerIP, func(int) response {
			return post("/v1/auth/verify-email", map[string]string{"token": "bukan-token"})
		}},
		{auth.LimitResetPerIP, func(int) response {
			return post("/v1/auth/reset-password", resetBody("bukan-token", testPassword))
		}},
		{auth.LimitGooglePerIP, func(int) response {
			return post("/v1/auth/google", map[string]string{"id_token": "palsu"})
		}},
		{auth.LimitForgotPerIP, func(int) response {
			return post("/v1/auth/forgot-password", map[string]string{"email": uniqueEmail("lupa")})
		}},
	}
	for _, tt := range tests {
		t.Run(tt.limit.Name, func(t *testing.T) {
			exhaust(t, tt.limit, tt.req)
			s.assertCounter(t, tt.limit)
		})
	}
}

// TestRateLimit_ForgotPerEmail: three reset emails per address per hour,
// counted before the per-IP limit has run out.
func TestRateLimit_ForgotPerEmail(t *testing.T) {
	s, mailer := mailServer(t, nil)
	u, _ := s.newAccount(t, "lupa-terus")
	exhaust(t, auth.LimitForgotPerEmail, func(int) response {
		return s.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": u.Email}, "")
	})
	if n := len(mailer.tokens(u.Email, subjectReset)); n != auth.LimitForgotPerEmail.Max {
		t.Errorf("%d reset emails sent, want %d (none for the limited request)", n, auth.LimitForgotPerEmail.Max)
	}
}

// TestRateLimit_ResendPerUser: three verification emails per account per
// hour; another account is not affected.
func TestRateLimit_ResendPerUser(t *testing.T) {
	s := startServer(t, nil)
	_, p := s.newAccount(t, "kirim-ulang")
	exhaust(t, auth.LimitResendPerUser, func(int) response {
		return s.call(t, http.MethodPost, "/v1/auth/verify-email/resend", nil, p.AccessToken)
	})
	_, other := s.newAccount(t, "kirim-lain")
	if r := s.call(t, http.MethodPost, "/v1/auth/verify-email/resend", nil, other.AccessToken); r.Status != http.StatusAccepted {
		t.Errorf("another account's resend = %d, want 202", r.Status)
	}
}

// TestRateLimit_ClientIP checks which address the per-IP limits count: with
// APP_TRUSTED_PROXY_HOPS=1 the client in X-Forwarded-For (each client its
// own counter), and with the default 0 the peer, so a forged
// X-Forwarded-For cannot escape the limit.
func TestRateLimit_ClientIP(t *testing.T) {
	login := func(s *server, xff string) response {
		resp, err := s.tryCall(http.MethodPost, "/v1/auth/login",
			map[string]string{"email": uniqueEmail("xff"), "password": testPassword}, "", map[string]string{"X-Forwarded-For": xff})
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	t.Run("behind one proxy", func(t *testing.T) {
		s := startServer(t, map[string]string{"APP_TRUSTED_PROXY_HOPS": "1"})
		exhaust(t, auth.LimitLoginPerIP, func(int) response { return login(s, "203.0.113.7") })
		assertError(t, login(s, "203.0.113.8"), http.StatusUnauthorized, "INVALID_CREDENTIALS")
	})
	t.Run("no proxy trusted", func(t *testing.T) {
		s := startServer(t, nil)
		exhaust(t, auth.LimitLoginPerIP, func(i int) response { return login(s, fmt.Sprintf("198.51.100.%d", i+1)) })
	})
}

// TestRateLimit_IPv6PerSlash64: one IPv6 client usually holds a whole /64,
// so the per-IP limits count the /64 (httpapi.RateLimitKey). Behind one
// trusted proxy, twenty addresses of one /64 use up the login limit for
// all of it, and an address in the next /64 is still allowed.
func TestRateLimit_IPv6PerSlash64(t *testing.T) {
	s := startServer(t, map[string]string{"APP_TRUSTED_PROXY_HOPS": "1"})
	login := func(xff string) response {
		resp, err := s.tryCall(http.MethodPost, "/v1/auth/login",
			map[string]string{"email": uniqueEmail("v6"), "password": testPassword}, "", map[string]string{"X-Forwarded-For": xff})
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	exhaust(t, auth.LimitLoginPerIP, func(i int) response { return login(fmt.Sprintf("2001:db8:1:2:%x::%x", i, i+1)) })
	assertError(t, login("2001:db8:1:3::1"), http.StatusUnauthorized, "INVALID_CREDENTIALS")

	keys, err := s.rdb.Keys(t.Context(), "goshop:rl:"+auth.LimitLoginPerIP.Name+"*").Result()
	if err != nil {
		t.Fatal(err)
	}
	// One counter per /64 (and window): no key names a single address.
	slashes := map[string]int{}
	for _, k := range keys {
		for _, net := range []string{"2001:db8:1:2::/64", "2001:db8:1:3::/64"} {
			if strings.Contains(k, ":"+net+":") {
				slashes[net]++
			}
		}
	}
	if len(keys) != 2 || slashes["2001:db8:1:2::/64"] != 1 || slashes["2001:db8:1:3::/64"] != 1 {
		t.Errorf("login-ip keys = %v, want one counter for each /64", keys)
	}
}

// TestRateLimit_CrossOriginRetryAfter: a browser app on another origin can
// read Retry-After from a 429, because the API exposes it through CORS.
func TestRateLimit_CrossOriginRetryAfter(t *testing.T) {
	const web = "http://localhost:5173"
	s := startServer(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": web})
	email := uniqueEmail("cors-429")
	var resp response
	for range auth.LimitLoginPerEmail.Max + 1 {
		var err error
		resp, err = s.tryCall(http.MethodPost, "/v1/auth/login", map[string]string{"email": email, "password": wrongPassword}, "",
			map[string]string{"Origin": web})
		if err != nil {
			t.Fatal(err)
		}
	}
	assertRateLimited(t, resp, auth.LimitLoginPerEmail.Window, "cross-origin login")
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != web {
		t.Errorf("Access-Control-Allow-Origin on the 429 = %q, want %q", got, web)
	}
	assertExposes(t, resp, "X-Request-ID", "Retry-After", "Location")
}

// TestConfig_TrustedProxyHopsRequired: outside development the API refuses
// to start without APP_TRUSTED_PROXY_HOPS (a wrong guess would either let
// clients forge their address or count every client as the proxy), and
// with a value outside 0..5; nothing listens.
func TestConfig_TrustedProxyHopsRequired(t *testing.T) {
	tests := []struct{ env, hops, want string }{
		{config.EnvStaging, "", "APP_TRUSTED_PROXY_HOPS: is required outside development"},
		{config.EnvProduction, "", "APP_TRUSTED_PROXY_HOPS: is required outside development"},
		{config.EnvProduction, "6", "APP_TRUSTED_PROXY_HOPS"},
		{config.EnvProduction, "-1", "APP_TRUSTED_PROXY_HOPS"},
	}
	for _, tt := range tests {
		t.Run(tt.env+" hops="+tt.hops, func(t *testing.T) {
			dsn, _ := newTestDB(t)
			port := freePort(t)
			setEnv(t, map[string]string{"APP_ENV": tt.env, "PORT": strconv.Itoa(port), "DATABASE_URL": dsn, "APP_TRUSTED_PROXY_HOPS": tt.hops})
			out := &syncBuffer{}
			done := make(chan error, 1)
			go func() { done <- app.Run(t.Context(), nil, out) }()
			select {
			case err := <-done:
				if err == nil || !strings.Contains(err.Error(), tt.want) {
					t.Fatalf("Run = %v, want an error mentioning %q", err, tt.want)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("Run started without a valid APP_TRUSTED_PROXY_HOPS")
			}
			if strings.Contains(out.String(), "api listening") {
				t.Errorf("the API listened:\n%s", out.String())
			}
		})
	}
}
