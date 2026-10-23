package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// memRevocations is an in-memory auth.SessionRevocations.
type memRevocations struct {
	mu      sync.Mutex
	revoked map[string]bool
}

func (m *memRevocations) Revoke(_ context.Context, ids ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range ids {
		m.revoked[id] = true
	}
	return nil
}

func (m *memRevocations) IsRevoked(_ context.Context, id string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.revoked[id], nil
}

// refuseAll is an auth.RateLimiter that refuses every attempt.
type refuseAll struct{ seen []string }

func (r *refuseAll) Allow(_ context.Context, l auth.Limit, _ string) (bool, time.Duration, error) {
	r.seen = append(r.seen, l.Name)
	return false, 30 * time.Second, nil
}

// googleSays is an auth.GoogleVerifier that refuses every token.
type googleSays struct{ err error }

func (g googleSays) Verify(context.Context, string) (auth.GoogleIdentity, error) {
	return auth.GoogleIdentity{}, g.err
}

type noMail struct{}

func (noMail) Send(context.Context, mail.Message) error { return nil }

// bearer is an access token for role in session sid, signed like the API's.
func bearer(t *testing.T, role user.Role, sid string) string {
	t.Helper()
	tok, _, err := auth.NewAccessTokens(testSecret, 15*time.Minute, nil).Issue(user.User{ID: "0190c8a0-0000-7000-8000-000000000001", Role: role}, sid)
	testx.AssertNoError(t, err)
	return "Bearer " + tok
}

func call(t *testing.T, h http.Handler, method, path, authorization, body string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	r := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	if authorization != "" {
		r.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	var b struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	return rec, b.Error.Code
}

// The admin routes need a logged-in seller or admin, in every environment;
// there is no development-only mount any more.
func TestApp_AdminRoutesNeedStaff(t *testing.T) {
	const id = "0190c8a0-0000-7000-8000-0000000000c1"
	for _, env := range []string{config.EnvDevelopment, config.EnvProduction} {
		t.Run(env, func(t *testing.T) {
			rev := &memRevocations{revoked: map[string]bool{"ended": true}}
			h := app.New(testConfig(env), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
				app.WithSessionRevocations(rev)).Handler()

			tests := []struct {
				name, authorization string
				wantStatus          int
				wantCode            string
			}{
				{name: "anonymous", authorization: "", wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHORIZED"},
				{name: "buyer", authorization: bearer(t, user.RoleBuyer, "s1"), wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
				{name: "revoked seller", authorization: bearer(t, user.RoleSeller, "ended"), wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHORIZED"},
				// Staff reach the handler: the fake database has no such product.
				{name: "seller", authorization: bearer(t, user.RoleSeller, "s1"), wantStatus: http.StatusNotFound, wantCode: "NOT_FOUND"},
				{name: "admin", authorization: bearer(t, user.RoleAdmin, "s1"), wantStatus: http.StatusNotFound, wantCode: "NOT_FOUND"},
			}
			for _, tt := range tests {
				rec, code := call(t, h, http.MethodGet, "/v1/admin/products/"+id, tt.authorization, "")
				testx.AssertEqual(t, rec.Code, tt.wantStatus, "%s: body %s", tt.name, rec.Body.String())
				testx.AssertEqual(t, code, tt.wantCode, tt.name)
				if tt.wantStatus == http.StatusNotFound {
					testx.AssertContains(t, rec.Body.String(), "product not found", "the handler answered, not the router")
				}
			}
			// A seller's empty POST reaches the admin handler's validation.
			rec, code := call(t, h, http.MethodPost, "/v1/admin/products", bearer(t, user.RoleSeller, "s1"), "{}")
			testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
			testx.AssertEqual(t, code, "VALIDATION_FAILED")
		})
	}
}

func TestApp_ProtectedRoutes(t *testing.T) {
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}})).Handler()
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/v1/me"}, {http.MethodPatch, "/v1/me"}, {http.MethodDelete, "/v1/me"},
		{http.MethodGet, "/v1/me/addresses"}, {http.MethodPost, "/v1/me/addresses"},
		{http.MethodPost, "/v1/auth/verify-email/resend"},
	} {
		rec, code := call(t, h, route.method, route.path, "", "{}")
		testx.AssertEqual(t, rec.Code, http.StatusUnauthorized, "%s %s", route.method, route.path)
		testx.AssertEqual(t, code, "UNAUTHORIZED")
		testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`)
	}
	// The public catalog needs no token.
	rec, _ := call(t, h, http.MethodGet, "/v1/categories", "", "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
}

// With the default Redis revocations, the Guard asks the Redis New was
// given, and fails closed when it cannot answer.
func TestApp_GuardFailsClosedWithoutRedis(t *testing.T) {
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	testx.AssertNoError(t, err)
	addr := ln.Addr().String()
	_ = ln.Close()
	down := redis.NewClient(&redis.Options{Addr: addr, MaxRetries: -1, DialTimeout: 200 * time.Millisecond})
	t.Cleanup(func() { _ = down.Close() })

	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), down).Handler()

	rec, code := call(t, h, http.MethodGet, "/v1/me", bearer(t, user.RoleBuyer, "s1"), "")
	testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
	testx.AssertEqual(t, code, "INTERNAL_ERROR")
	rec, _ = call(t, h, http.MethodGet, "/readyz", "", "")
	testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable)
	testx.AssertContains(t, rec.Body.String(), `"redis":{"status":"unavailable"`)
}

func TestApp_WithClockReachesTheTokenCheck(t *testing.T) {
	later := func() time.Time { return time.Now().Add(time.Hour) }
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithClock(later), app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}}),
		app.WithMailer(noMail{})).Handler()
	// Issued now with 15 minutes to live: an hour later it has expired.
	rec, code := call(t, h, http.MethodGet, "/v1/me", bearer(t, user.RoleBuyer, "s1"), "")
	testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
	testx.AssertEqual(t, code, "UNAUTHORIZED")
}

func TestApp_WithRateLimiter(t *testing.T) {
	limiter := &refuseAll{}
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithRateLimiter(limiter)).Handler()
	rec, code := call(t, h, http.MethodPost, "/v1/auth/login", "", `{"email":"budi@example.com","password":"x"}`)
	testx.AssertEqual(t, rec.Code, http.StatusTooManyRequests)
	testx.AssertEqual(t, code, "RATE_LIMITED")
	testx.AssertEqual(t, rec.Header().Get("Retry-After"), "30")
	testx.AssertEqual(t, strings.Join(limiter.seen, ","), "login-ip")
}

// The default limiter counts in the Redis New was given: the 11th sign-up
// from one IP in an hour is refused (counted before the body is read, so
// an empty body is enough and costs no hash).
func TestApp_DefaultRateLimiterUsesRedis(t *testing.T) {
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t)).Handler()
	for i := range auth.LimitRegisterPerIP.Max {
		rec, code := call(t, h, http.MethodPost, "/v1/auth/register", "", `{}`)
		testx.AssertEqual(t, code, "VALIDATION_FAILED", "attempt %d: %s", i+1, rec.Body.String())
	}
	rec, code := call(t, h, http.MethodPost, "/v1/auth/register", "", `{}`)
	testx.AssertEqual(t, rec.Code, http.StatusTooManyRequests)
	testx.AssertEqual(t, code, "RATE_LIMITED")
	testx.AssertEqual(t, rec.Header().Get("Retry-After"), "3600")
}

func TestApp_GoogleSignIn(t *testing.T) {
	t.Run("off without GOOGLE_CLIENT_ID", func(t *testing.T) {
		var logs bytes.Buffer
		h := app.New(testConfig(config.EnvDevelopment), logx.New(logx.WithOutput(&logs), logx.WithFormat("json")),
			(&fakeDB{}).open(t), testRedis(t)).Handler()
		rec, code := call(t, h, http.MethodPost, "/v1/auth/google", "", `{"id_token":"x"}`)
		testx.AssertEqual(t, rec.Code, http.StatusNotFound)
		testx.AssertEqual(t, code, "NOT_FOUND")
		testx.AssertContains(t, logs.String(), "google sign-in is off: GOOGLE_CLIENT_ID is not set")
	})
	t.Run("on with GOOGLE_CLIENT_ID", func(t *testing.T) {
		cfg := testConfig(config.EnvProduction)
		cfg.Auth.GoogleClientID = "goshop-test.apps.googleusercontent.com"
		var logs bytes.Buffer
		h := app.New(cfg, logx.New(logx.WithOutput(&logs), logx.WithFormat("json")), (&fakeDB{}).open(t), testRedis(t)).Handler()
		// A malformed token is refused before Google's keys are fetched.
		rec, code := call(t, h, http.MethodPost, "/v1/auth/google", "", `{"id_token":"not.a.jwt"}`)
		testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
		testx.AssertEqual(t, code, "TOKEN_INVALID")
		testx.AssertFalse(t, strings.Contains(logs.String(), "google sign-in is off"))
	})
	t.Run("WithGoogleVerifier", func(t *testing.T) {
		h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
			app.WithGoogleVerifier(googleSays{err: errors.New("nope")})).Handler()
		rec, code := call(t, h, http.MethodPost, "/v1/auth/google", "", `{"id_token":"x"}`)
		testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
		testx.AssertEqual(t, code, "TOKEN_INVALID")
	})
}

func TestApp_SecurityHeaders(t *testing.T) {
	for _, tt := range []struct {
		env  string
		hsts bool
	}{{config.EnvDevelopment, false}, {config.EnvProduction, true}} {
		h := app.New(testConfig(tt.env), logx.Noop(), (&fakeDB{}).open(t), testRedis(t)).Handler()
		for _, path := range []string{"/v1/categories", "/v1/nope"} {
			rec, _ := call(t, h, http.MethodGet, path, "", "")
			testx.AssertEqual(t, rec.Header().Get("X-Content-Type-Options"), "nosniff", "%s %s", tt.env, path)
			testx.AssertEqual(t, rec.Header().Get("Cache-Control"), "no-store")
			testx.AssertEqual(t, rec.Header().Get("Strict-Transport-Security") != "", tt.hsts, "%s %s HSTS", tt.env, path)
		}
	}
}
