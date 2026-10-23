//go:build integration

// Package integration_test runs the GoShop API the way production does,
// minus Docker: the configuration is read from environment variables by
// config.Load, the pool is opened by database.Open on a real PostgreSQL, the
// app is wired by app.New, and app.Serve listens on a real TCP port. Every
// request goes over HTTP through the real router and the full middleware
// chain, so these tests catch what the httptest-based unit tests cannot:
// wiring, middleware order, real headers, real SQL and graceful shutdown.
//
// Each test gets its own throwaway database (see db_test.go) and a Redis
// logical database of its own (see redis_test.go). Run them with
// `make test-integration`, which starts the Compose stack, exports
// POSTGRES_DSN and REDIS_ADDR, and also serves the tests in stack_test.go.
package integration_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/logging"
	"github.com/santekno/shop-app/apps/api/internal/redisconn"
)

// server is one running API instance on 127.0.0.1 and a random port.
type server struct {
	// URL is the base URL, e.g. http://127.0.0.1:53124.
	URL string
	// db is a pool on the server's own test database, for the test to put
	// fixtures in and check rows, and dbURL is that database's URL; both
	// are empty when the test passed its own DATABASE_URL.
	db    *sql.DB
	dbURL string
	// rdb is the server's Redis client, on the test's own logical
	// database, for the test to check keys with; nil when the test passed
	// its own client.
	rdb *redis.Client
	// bearer, when set, is sent as "Authorization: Bearer <bearer>" by
	// send and do on requests that set no Authorization header.
	bearer string
	app    *app.App
	logs   *syncBuffer
	client *http.Client
	cancel context.CancelFunc
	done   chan error

	stopOnce sync.Once
	stopErr  error
}

// startServer clears every APP_* variable and PORT, sets env (APP_ENV
// defaults to development; see setEnv for the auth variables), loads the
// config exactly like `api` does, opens the pool with database.Open and
// the Redis client with redisconn.Open, and serves app.New(…, opts...) on a
// free port. Unless env sets DATABASE_URL, the app gets a new, migrated,
// empty database of its own (newTestDB), never the shared one; unless it
// sets REDIS_URL, a Redis logical database of its own (newTestRedis). The
// server is stopped when the test ends.
func startServer(t *testing.T, env map[string]string, opts ...app.Option) *server {
	t.Helper()
	env = maps.Clone(env)
	if env == nil {
		env = map[string]string{}
	}
	var fixtures *sql.DB
	if _, ok := env["DATABASE_URL"]; !ok {
		env["DATABASE_URL"], fixtures = newTestDB(t)
	}
	s := startServerWith(t, env, nil, nil, opts...)
	if fixtures != nil {
		s.db, s.dbURL = fixtures, env["DATABASE_URL"]
	}
	return s
}

// startServerWithPool is startServer on pool instead of a pool opened from
// DATABASE_URL, for a pool database.Open would refuse, such as one that
// cannot connect. A nil pool means "open DATABASE_URL"; env must set
// DATABASE_URL either way, because config.Load requires it.
func startServerWithPool(t *testing.T, env map[string]string, pool *sql.DB, opts ...app.Option) *server {
	t.Helper()
	return startServerWith(t, env, pool, nil, opts...)
}

// startServerWith is startServerWithPool that also takes the Redis client:
// nil means "open REDIS_URL" with redisconn.Open, as Run does.
func startServerWith(t *testing.T, env map[string]string, pool *sql.DB, rdb redis.UniversalClient, opts ...app.Option) *server {
	t.Helper()
	setEnv(t, env)

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}

	logs := &syncBuffer{}
	logger := logging.New(logs, cfg.IsDevelopment(), cfg.LogLevel).With("env", cfg.Env)
	if pool == nil {
		pool, err = database.Open(context.Background(), cfg.Database, logger)
		if err != nil {
			t.Fatalf("database.Open: %v", err)
		}
	}
	// Registered before the server's own cleanup, so they run after it:
	// the pool and the Redis client close once the server has stopped, as
	// in Run.
	t.Cleanup(func() { _ = pool.Close() })
	var own *redis.Client
	if rdb == nil {
		own, err = redisconn.Open(context.Background(), cfg.RedisURL)
		if err != nil {
			t.Fatalf("redisconn.Open: %v", err)
		}
		t.Cleanup(func() { _ = own.Close() })
		rdb = own
	}
	a := app.New(cfg, logger, pool, rdb, opts...)

	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	s := &server{
		URL:    "http://" + ln.Addr().String(),
		rdb:    own,
		app:    a,
		logs:   logs,
		client: &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{MaxIdleConnsPerHost: 64}},
		cancel: cancel,
		done:   make(chan error, 1),
	}
	go func() { s.done <- a.Serve(ctx, ln) }()

	t.Cleanup(func() {
		if err := s.stop(cfg.DrainDelay + cfg.ShutdownTimeout + 5*time.Second); err != nil {
			t.Errorf("serve returned %v after shutdown, want nil\nlogs:\n%s", err, logs.String())
		}
		s.client.CloseIdleConnections()
	})
	return s
}

// stop cancels the serve context (what SIGTERM does in main) and waits up to
// limit for Serve to return. It is safe to call more than once.
func (s *server) stop(limit time.Duration) error {
	s.stopOnce.Do(func() {
		s.cancel()
		select {
		case s.stopErr = <-s.done:
		case <-time.After(limit):
			s.stopErr = errors.New("serve did not return in time")
		}
	})
	return s.stopErr
}

// response is a finished HTTP exchange; the body is already read and closed.
type response struct {
	Status int
	Header http.Header
	Body   []byte
}

// do sends method path to s with headers and returns the whole response.
func (s *server) do(t *testing.T, method, path string, headers map[string]string) response {
	t.Helper()
	if _, ok := headers["Authorization"]; !ok && s.bearer != "" {
		headers = maps.Clone(headers)
		if headers == nil {
			headers = map[string]string{}
		}
		headers["Authorization"] = "Bearer " + s.bearer
	}
	return doRequest(t, s.client, method, s.URL+path, headers)
}

// get is do with GET and no extra headers.
func (s *server) get(t *testing.T, path string) response {
	t.Helper()
	return s.do(t, http.MethodGet, path, nil)
}

func doRequest(t *testing.T, client *http.Client, method, url string, headers map[string]string) response {
	t.Helper()
	resp, err := tryRequest(client, method, url, headers)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// tryRequest is doRequest for goroutines: it returns the error instead of
// failing the test.
func tryRequest(client *http.Client, method, url string, headers map[string]string) (response, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return response{}, fmt.Errorf("new request %s %s: %w", method, url, err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return response{}, fmt.Errorf("%s %s: %w", method, url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return response{}, fmt.Errorf("%s %s: read body: %w", method, url, err)
	}
	return response{Status: resp.StatusCode, Header: resp.Header, Body: body}, nil
}

// decodeObject decodes body as a JSON object, keeping each value raw so the
// caller can check exactly which keys exist.
func decodeObject(t *testing.T, body []byte) map[string]json.RawMessage {
	t.Helper()
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil {
		t.Fatalf("body is not a JSON object: %v\n%s", err, body)
	}
	return obj
}

// testJWTSecret signs the access tokens of every in-process test server
// (the value make test-integration also exports). It is a test key only.
const testJWTSecret = "integration-tests-only-signing-key-0123456789"

// testGoogleClientID is the GOOGLE_CLIENT_ID of test servers outside
// development, where config.Load requires one. No test reaches Google:
// sign-in tests replace the verifier (app.WithGoogleVerifier).
const testGoogleClientID = "goshop-integration-tests.apps.googleusercontent.com"

// setEnv clears every APP_* variable, PORT and GOOGLE_CLIENT_ID for the
// test, so a value in the developer's shell cannot leak in, then sets
// vars. Defaults: APP_ENV development, JWT_SECRET testJWTSecret, REDIS_URL
// a Redis logical database of the test's own (newTestRedis), and outside
// development GOOGLE_CLIENT_ID testGoogleClientID and
// APP_TRUSTED_PROXY_HOPS 0. A var set to "" stays empty, for tests of a
// missing variable.
func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	names := []string{"PORT", "GOOGLE_CLIENT_ID"}
	for _, kv := range os.Environ() {
		if name, _, _ := strings.Cut(kv, "="); strings.HasPrefix(name, "APP_") {
			names = append(names, name)
		}
	}
	for _, name := range names {
		t.Setenv(name, "") // restores the old value after the test
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
	}
	env, ok := vars["APP_ENV"]
	if !ok {
		env = config.EnvDevelopment
		t.Setenv("APP_ENV", env)
	}
	if _, ok := vars["JWT_SECRET"]; !ok {
		t.Setenv("JWT_SECRET", testJWTSecret)
	}
	if _, ok := vars["REDIS_URL"]; !ok {
		redisURL, _ := newTestRedis(t)
		t.Setenv("REDIS_URL", redisURL)
	}
	if _, ok := vars["GOOGLE_CLIENT_ID"]; !ok && env != config.EnvDevelopment {
		t.Setenv("GOOGLE_CLIENT_ID", testGoogleClientID)
	}
	// Required outside development; the test servers have no proxy in
	// front of them.
	if _, ok := vars["APP_TRUSTED_PROXY_HOPS"]; !ok && env != config.EnvDevelopment {
		t.Setenv("APP_TRUSTED_PROXY_HOPS", "0")
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}

// syncBuffer is a bytes.Buffer the server's logger and the test can share.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p) //nolint:wrapcheck // bytes.Buffer.Write never fails
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// jsonLines returns every log line that is a JSON object (production and
// staging log JSON; development logs text).
func (b *syncBuffer) jsonLines() []map[string]any {
	var out []map[string]any
	for line := range strings.Lines(b.String()) {
		var m map[string]any
		if json.Unmarshal([]byte(line), &m) == nil {
			out = append(out, m)
		}
	}
	return out
}

// TestServe_FromEnvironment starts the API the way `api` does (config from
// the environment, app.New, Serve on a real listener) and checks that it
// answers and stops cleanly when its context is cancelled.
func TestServe_FromEnvironment(t *testing.T) {
	s := startServer(t, map[string]string{
		"APP_ENV":       config.EnvProduction,
		"APP_LOG_LEVEL": "info",
	})

	resp := s.get(t, "/healthz")
	if resp.Status != http.StatusOK {
		t.Fatalf("GET /healthz = %d, want 200: %s", resp.Status, resp.Body)
	}

	if err := s.stop(15 * time.Second); err != nil {
		t.Fatalf("serve returned %v, want nil after a clean shutdown", err)
	}

	// Production logs are JSON lines carrying the service and env fields.
	var listening, started, complete bool
	for _, line := range s.logs.jsonLines() {
		if line["service"] != "api" || line["env"] != config.EnvProduction {
			t.Errorf("log line without service=api env=production: %v", line)
		}
		switch line["msg"] {
		case "api listening":
			listening = line["addr"] == strings.TrimPrefix(s.URL, "http://")
		case "shutdown started":
			started = true
		case "shutdown complete":
			complete = true
		}
	}
	if !listening || !started || !complete {
		t.Errorf("want logs 'api listening' (with the real addr), 'shutdown started' and 'shutdown complete'; got:\n%s", s.logs.String())
	}

	// The listener is closed: nothing answers on the port any more.
	var d net.Dialer
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if conn, err := d.DialContext(ctx, "tcp", strings.TrimPrefix(s.URL, "http://")); err == nil {
		_ = conn.Close()
		t.Errorf("port %s still accepts connections after shutdown", s.URL)
	}
}
