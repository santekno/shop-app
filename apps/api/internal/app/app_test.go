package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// testDatabaseURL is a valid DATABASE_URL. Nothing listens there in a unit
// test; Run's tests that reach the database use closedDatabaseURL instead.
const testDatabaseURL = "postgres://localhost:5432/goshop?sslmode=disable"

// The other variables Load requires, with test values (none of them real).
var requiredEnv = map[string]string{ //nolint:gosec // a test value, not a credential
	"DATABASE_URL":           testDatabaseURL,
	"JWT_SECRET":             "unit-test-jwt-secret-not-a-real-key-0123456789",
	"REDIS_URL":              "redis://localhost:6379/0",
	"GOOGLE_CLIENT_ID":       "goshop-test.apps.googleusercontent.com",
	"APP_TRUSTED_PROXY_HOPS": "0",
}

// setEnv clears every APP_* variable, PORT and the required variables for
// the test, sets the required ones to requiredEnv, then sets vars over them.
func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	names := []string{"PORT", "DATABASE_URL", "JWT_SECRET", "REDIS_URL", "GOOGLE_CLIENT_ID"}
	for _, kv := range os.Environ() {
		if name, _, _ := strings.Cut(kv, "="); strings.HasPrefix(name, "APP_") {
			names = append(names, name)
		}
	}
	for _, name := range names {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
	}
	for k, v := range requiredEnv {
		if _, ok := vars[k]; !ok {
			t.Setenv(k, v)
		}
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}

// testSecret signs the access tokens of these tests; it is not a real key.
var testSecret = []byte("unit-test-jwt-secret-not-a-real-key-0123456789")

func testConfig(env string) config.Config {
	return config.Config{
		Env:             env,
		LogLevel:        "info",
		RequestTimeout:  time.Second,
		ShutdownTimeout: time.Second,
		Auth: config.Auth{
			JWTSecret: testSecret, AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour,
		},
	}
}

// testRedis is a go-redis client on an in-process fake Redis.
func testRedis(t *testing.T) redis.UniversalClient {
	t.Helper()
	f := newFakeRedis(t)
	c := redis.NewClient(&redis.Options{Addr: f.addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func TestApp_Handler(t *testing.T) {
	a := app.New(testConfig(config.EnvDevelopment), logx.Noop(), (&fakeDB{}).open(t), testRedis(t))
	h := a.Handler()

	tests := []struct {
		path       string
		wantStatus int
		wantBody   string
	}{
		// The routes reach the PostgreSQL repositories: the fake database
		// has no rows, so both lists are empty.
		{path: "/v1/categories", wantStatus: http.StatusOK, wantBody: `{"data":[]}`},
		{path: "/v1/products", wantStatus: http.StatusOK, wantBody: `{"data":[],"page":{"next_cursor":null}}`},
		{path: "/v1/products/kaos-polos-hitam", wantStatus: http.StatusNotFound},
		{path: "/v1/products?limit=0", wantStatus: http.StatusBadRequest},
		{path: "/healthz", wantStatus: http.StatusOK},
		{path: "/readyz", wantStatus: http.StatusOK},
		{path: "/categories", wantStatus: http.StatusNotFound},
		{path: "/products", wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, tt.path, nil))
			testx.AssertEqual(t, rec.Code, tt.wantStatus, "body %s", rec.Body.String())
			testx.AssertTrue(t, rec.Header().Get("X-Request-ID") != "", "the full middleware chain is wired")
			if tt.wantBody != "" {
				testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()), tt.wantBody)
			}
		})
	}
	testx.AssertTrue(t, a.Ready())
}

// The handlers and /readyz use the pool New was given, not one of their own.
func TestApp_UsesTheGivenPool(t *testing.T) {
	db := (&fakeDB{pingErr: errors.New("connection refused"), queryErr: errors.New("connection refused")}).open(t)
	h := app.New(testConfig(config.EnvDevelopment), logx.Noop(), db, testRedis(t)).Handler()

	for _, path := range []string{"/v1/categories", "/v1/products"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil))
		testx.AssertEqual(t, rec.Code, http.StatusInternalServerError, "%s: body %s", path, rec.Body.String())
		testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "%s leaks the cause", path)
	}

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/readyz", nil))
	testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable)
	var probe struct {
		Checks map[string]struct {
			Status string `json:"status"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &probe); err != nil {
		t.Fatalf("decode /readyz %q: %v", rec.Body.String(), err)
	}
	testx.AssertEqual(t, probe.Checks["postgres"].Status, "unavailable")
	testx.AssertEqual(t, probe.Checks["server"].Status, "ok")
	testx.AssertEqual(t, probe.Checks["redis"].Status, "ok", "readiness checks the Redis New was given")
}

// HEAD works on the API and on the probes, with an empty body. It goes
// through a real server: httptest.ResponseRecorder would keep the GET body.
func TestApp_Head(t *testing.T) {
	srv := httptest.NewServer(app.New(testConfig(config.EnvDevelopment), logx.Noop(), (&fakeDB{}).open(t), testRedis(t)).Handler())
	defer srv.Close()

	for _, path := range []string{"/v1/categories", "/healthz", "/readyz"} {
		t.Run(path, func(t *testing.T) {
			req, err := http.NewRequestWithContext(context.Background(), http.MethodHead, srv.URL+path, nil)
			if err != nil {
				t.Fatalf("new request: %v", err)
			}
			resp, err := srv.Client().Do(req)
			if err != nil {
				t.Fatalf("HEAD %s: %v", path, err)
			}
			body, err := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, resp.StatusCode, http.StatusOK)
			testx.AssertEqual(t, len(body), 0, "HEAD response has no body")
			testx.AssertContains(t, resp.Header.Get("Content-Type"), "application/json")
		})
	}
}

func TestApp_ServeDrainsReadiness(t *testing.T) {
	tests := []struct {
		env         string
		wantErrText bool // /readyz shows the check's error text
	}{
		{env: config.EnvDevelopment, wantErrText: true},
		{env: config.EnvProduction, wantErrText: false},
	}
	for _, tt := range tests {
		t.Run(tt.env, func(t *testing.T) {
			var logs bytes.Buffer
			a := app.New(testConfig(tt.env), logx.New(logx.WithOutput(&logs), logx.WithFormat("json")), (&fakeDB{}).open(t), testRedis(t))
			var lc net.ListenConfig
			ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatalf("listen: %v", err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- a.Serve(ctx, ln) }()

			port := ln.Addr().(*net.TCPAddr).Port
			waitHealthy(t, port)
			testx.AssertTrue(t, a.Ready(), "ready while serving")

			cancel()
			select {
			case err := <-done:
				testx.AssertNoError(t, err)
			case <-time.After(5 * time.Second):
				t.Fatal("Serve did not return after cancel")
			}

			testx.AssertFalse(t, a.Ready(), "readiness flipped by shutdown")
			rec := httptest.NewRecorder()
			a.Handler().ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/readyz", nil))
			testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable)
			testx.AssertEqual(t, strings.Contains(rec.Body.String(), "shutting down"), tt.wantErrText, "body %s", rec.Body.String())
			testx.AssertContains(t, logs.String(), `"msg":"api listening"`)
			testx.AssertContains(t, logs.String(), `"addr":"`+ln.Addr().String()+`"`)
		})
	}
}

// waitHealthy polls Probe until the API on port answers, or fails the test.
func waitHealthy(t *testing.T, port int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := app.Probe(context.Background(), port)
		if err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("API on port %d never became healthy: %v", port, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// syncBuffer is a bytes.Buffer safe to read while Run writes logs to it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n, _ := b.buf.Write(p) // bytes.Buffer.Write never fails
	return n, nil
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestRun_Healthcheck(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		wantErr string
	}{
		{name: "healthy", status: http.StatusOK},
		{name: "unhealthy", status: http.StatusServiceUnavailable, wantErr: "answered 503"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
			}))
			defer srv.Close()
			setEnv(t, map[string]string{"APP_ENV": "production", "PORT": strconv.Itoa(portOf(t, srv))})
			var out bytes.Buffer

			err := app.Run(context.Background(), []string{"healthcheck"}, &out)

			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
			} else {
				if err == nil {
					t.Fatalf("Run: want error containing %q, got nil", tt.wantErr)
				}
				testx.AssertContains(t, err.Error(), tt.wantErr)
			}
			testx.AssertEqual(t, out.Len(), 0, "the probe does not start the API or log")
		})
	}
}

func TestRun_Errors(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		args    []string
		wantErr string
	}{
		{
			name:    "config error comes first, even with bad arguments",
			env:     map[string]string{},
			args:    []string{"bogus"},
			wantErr: "config: ",
		},
		{
			name:    "invalid config names the variable",
			env:     map[string]string{"APP_ENV": "production", "PORT": "99999"},
			args:    nil,
			wantErr: "PORT: must be a number between 1 and 65535",
		},
		{
			name:    "unknown argument",
			env:     map[string]string{"APP_ENV": "production"},
			args:    []string{"serve"},
			wantErr: `unknown arguments ["serve"] (usage: api [healthcheck|migrate|expire-orders|cleanup-idempotency-keys|publish-events])`,
		},
		{
			name:    "migrate with extra arguments",
			env:     map[string]string{"APP_ENV": "production"},
			args:    []string{"migrate", "now"},
			wantErr: `unknown arguments ["migrate" "now"] (usage: api [healthcheck|migrate|expire-orders|cleanup-idempotency-keys|publish-events])`,
		},
		{
			name:    "DATABASE_URL is required",
			env:     map[string]string{"APP_ENV": "production", "DATABASE_URL": ""},
			args:    nil,
			wantErr: "DATABASE_URL: is required",
		},
		{
			name:    "healthcheck with extra arguments",
			env:     map[string]string{"APP_ENV": "production"},
			args:    []string{"healthcheck", "now"},
			wantErr: `unknown arguments ["healthcheck" "now"]`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setEnv(t, tt.env)
			var out bytes.Buffer
			err := app.Run(context.Background(), tt.args, &out)
			if err == nil {
				t.Fatalf("Run: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertEqual(t, out.Len(), 0, "nothing starts before the error")
		})
	}
}

// closedDatabaseURL returns a DATABASE_URL for a local port nothing
// listens on, so opening it fails at once with "connection refused".
func closedDatabaseURL(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return "postgres://user:pass@" + addr + "/goshop?sslmode=disable"
}

// Serving and migrating both start by opening the database, and neither
// goes on without it. Serving with a reachable database is tested in
// tests/integration.
func TestRun_DatabaseUnreachable(t *testing.T) {
	tests := []struct {
		name string
		args []string
	}{
		{name: "serve", args: nil},
		{name: "migrate", args: []string{"migrate"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			port := freePort(t)
			setEnv(t, map[string]string{
				"APP_ENV": "production", "PORT": strconv.Itoa(port), "DATABASE_URL": closedDatabaseURL(t),
			})
			var out syncBuffer

			err := app.Run(context.Background(), tt.args, &out)

			if err == nil {
				t.Fatal("Run: want error, got nil")
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "err = %v", err)
			testx.AssertFalse(t, strings.Contains(err.Error(), "user:pass"), "error repeats the URL: %v", err)
			testx.AssertFalse(t, strings.Contains(out.String(), "api listening"), "nothing listens without a database")
			testx.AssertFalse(t, strings.Contains(out.String(), "database migrated"), "nothing is migrated")
		})
	}
}
