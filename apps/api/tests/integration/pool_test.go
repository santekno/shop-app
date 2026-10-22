//go:build integration

package integration_test

import (
	"context"
	"database/sql"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

const planCacheWarning = "plan_cache_mode is not force_custom_plan"

// withQuery returns dsn with one more query parameter.
func withQuery(t *testing.T, dsn, key, value string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse %s: %v", redact(dsn), err)
	}
	q := u.Query()
	q.Set(key, value)
	u.RawQuery = q.Encode()
	return u.String()
}

// planCacheModes reads plan_cache_mode on n connections of db held at the
// same time, so each is a separate session.
func planCacheModes(t *testing.T, db *sql.DB, n int) []string {
	t.Helper()
	var modes []string
	for range n {
		conn, err := db.Conn(t.Context())
		if err != nil {
			t.Fatalf("conn: %v", err)
		}
		defer func() { _ = conn.Close() }()
		var mode string
		if err := conn.QueryRowContext(t.Context(), "SHOW plan_cache_mode").Scan(&mode); err != nil {
			t.Fatalf("SHOW plan_cache_mode: %v", err)
		}
		modes = append(modes, mode)
	}
	return modes
}

// TestOpen_PlanCacheMode checks the session setting database.Open asks
// for, on every connection of the pool, and the warning it logs when the
// setting did not take.
func TestOpen_PlanCacheMode(t *testing.T) {
	dsn := newDatabase(t)
	tests := []struct {
		name     string
		url      string
		wantMode string
		wantWarn bool
	}{
		{"default URL", dsn, "force_custom_plan", false},
		{"URL that sets plan_cache_mode=auto", withQuery(t, dsn, "plan_cache_mode", "auto"), "auto", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logs := &syncBuffer{}
			db, err := database.Open(t.Context(), config.Database{
				URL: tt.url, MaxOpenConns: 3, MaxIdleConns: 1, ConnMaxLifetime: time.Minute,
			}, logging.New(logs, false, "debug"))
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			defer func() { _ = db.Close() }()

			for i, mode := range planCacheModes(t, db, 3) {
				if mode != tt.wantMode {
					t.Errorf("connection %d: plan_cache_mode = %q, want %q", i, mode, tt.wantMode)
				}
			}

			var warned bool
			for _, line := range logs.jsonLines() {
				if strings.HasPrefix(line["msg"].(string), planCacheWarning) {
					warned = line["level"] == "WARN" && line["plan_cache_mode"] == tt.wantMode
				}
			}
			if warned != tt.wantWarn {
				t.Errorf("WARN %q with plan_cache_mode=%s logged = %v, want %v; logs:\n%s",
					planCacheWarning, tt.wantMode, warned, tt.wantWarn, logs.String())
			}
		})
	}
}

// TestOpen_PoolSize checks that MaxOpenConns is a real limit: with every
// connection in use, the next request for one waits.
func TestOpen_PoolSize(t *testing.T) {
	dsn := newDatabase(t)
	db, err := database.Open(t.Context(), config.Database{
		URL: dsn, MaxOpenConns: 2, MaxIdleConns: 1, ConnMaxLifetime: time.Minute,
	}, logging.New(&syncBuffer{}, false, "info"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = db.Close() }()

	if got := db.Stats().MaxOpenConnections; got != 2 {
		t.Errorf("MaxOpenConnections = %d, want 2", got)
	}
	for range 2 {
		conn, err := db.Conn(t.Context())
		if err != nil {
			t.Fatalf("conn: %v", err)
		}
		defer func() { _ = conn.Close() }()
	}
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	if conn, err := db.Conn(ctx); err == nil {
		_ = conn.Close()
		t.Error("got a third connection from a pool of two")
	}
}

// TestOpen_Unreachable checks that a database that cannot be reached fails
// Open quickly and without the password in the error.
func TestOpen_Unreachable(t *testing.T) {
	const password = "not-a-real-password-7731"
	start := time.Now()
	_, err := database.Open(t.Context(), config.Database{
		URL:          "postgres://goshop:" + password + "@" + closedAddr(t) + "/goshop?sslmode=disable",
		MaxOpenConns: 2, MaxIdleConns: 1, ConnMaxLifetime: time.Minute,
	}, logging.New(&syncBuffer{}, false, "info"))
	if err == nil {
		t.Fatal("Open of a closed port succeeded")
	}
	if strings.Contains(err.Error(), password) {
		t.Errorf("the error shows the password: %v", err)
	}
	if d := time.Since(start); d > 11*time.Second {
		t.Errorf("Open took %s, longer than its connect timeout", d)
	}
}

// freePort returns a TCP port that was free a moment ago.
func freePort(t *testing.T) int {
	t.Helper()
	addr := closedAddr(t)
	_, port, _ := net.SplitHostPort(addr)
	n, err := strconv.Atoi(port)
	if err != nil {
		t.Fatalf("port of %s: %v", addr, err)
	}
	return n
}

// TestRun_Serves runs the whole program, app.Run, against a migrated
// database: it opens the pool, serves, and on cancel shuts down and closes
// the pool last.
func TestRun_Serves(t *testing.T) {
	dsn, _ := newTestDB(t)
	port := freePort(t)
	setEnv(t, map[string]string{"APP_ENV": config.EnvProduction, "PORT": strconv.Itoa(port), "DATABASE_URL": dsn})

	out := &syncBuffer{}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx, nil, out) }()

	base := "http://127.0.0.1:" + strconv.Itoa(port)
	client := &http.Client{Timeout: 2 * time.Second}
	eventually(t, 10*time.Second, func() bool {
		r, err := tryRequest(client, http.MethodGet, base+"/readyz", nil)
		return err == nil && r.Status == http.StatusOK
	}, "Run never became ready; logs:\n%s", out.String())

	ready := doRequest(t, client, http.MethodGet, base+"/readyz", nil)
	if _, checks := assertHealthBody(t, ready, "/readyz"); jsonString(t, checks["postgres"]["status"]) != "ok" {
		t.Errorf("/readyz postgres check is not ok: %s", ready.Body)
	}
	if r := doRequest(t, client, http.MethodGet, base+"/v1/categories", nil); r.Status != http.StatusOK || string(r.Body) != "{\"data\":[]}\n" {
		t.Errorf("GET /v1/categories on an empty database = %d %s, want 200 {\"data\":[]}", r.Status, r.Body)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned %v after cancel, want nil", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("Run did not return after cancel")
	}

	logs := out.String()
	for _, want := range []string{`"msg":"api listening"`, `"msg":"shutdown complete"`, `"msg":"database closed"`} {
		if !strings.Contains(logs, want) {
			t.Errorf("logs lack %s:\n%s", want, logs)
		}
	}
	if strings.Index(logs, `"msg":"database closed"`) < strings.Index(logs, `"msg":"shutdown complete"`) {
		t.Error("the pool was closed before the server finished shutting down")
	}
	if strings.Contains(logs, planCacheWarning) {
		t.Errorf("Run warned about plan_cache_mode on a plain local database:\n%s", logs)
	}
}

// TestRun_ListenError checks that Run fails with the address when the port
// is taken, after the database opened fine.
func TestRun_ListenError(t *testing.T) {
	dsn, _ := newTestDB(t)
	var lc net.ListenConfig
	busy, err := lc.Listen(t.Context(), "tcp", ":0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = busy.Close() }()
	port := strconv.Itoa(busy.Addr().(*net.TCPAddr).Port)
	setEnv(t, map[string]string{"APP_ENV": config.EnvProduction, "PORT": port, "DATABASE_URL": dsn})

	err = app.Run(t.Context(), nil, &syncBuffer{})
	if err == nil || !strings.Contains(err.Error(), "listen on :"+port+": ") {
		t.Fatalf("Run on a taken port: error = %v, want \"listen on :%s: …\"", err, port)
	}
}

// TestReadyz_DatabaseUnreachable serves the app on a pool that cannot
// connect: /readyz turns 503 on the postgres check (error text only in
// development), liveness stays 200, and a catalog request is a plain 500.
func TestReadyz_DatabaseUnreachable(t *testing.T) {
	for _, env := range []string{config.EnvDevelopment, config.EnvProduction} {
		t.Run(env, func(t *testing.T) {
			addr := closedAddr(t)
			dsn := "postgres://goshop:goshop@" + addr + "/goshop?sslmode=disable"
			// sql.Open does not connect, unlike database.Open.
			pool, err := sql.Open("pgx", dsn)
			if err != nil {
				t.Fatalf("sql.Open: %v", err)
			}
			s := startServerWithPool(t, map[string]string{"APP_ENV": env, "DATABASE_URL": dsn}, pool)

			resp := s.get(t, "/readyz")
			if resp.Status != http.StatusServiceUnavailable {
				t.Fatalf("GET /readyz = %d, want 503: %s", resp.Status, resp.Body)
			}
			status, checks := assertHealthBody(t, resp, "/readyz")
			if status != "unavailable" || jsonString(t, checks["postgres"]["status"]) != "unavailable" ||
				jsonString(t, checks["server"]["status"]) != "ok" {
				t.Errorf("/readyz = %s, want postgres unavailable and server ok", resp.Body)
			}
			_, hasText := checks["postgres"]["error"]
			leaks := strings.Contains(string(resp.Body), addr)
			switch env {
			case config.EnvDevelopment:
				if !hasText {
					t.Errorf("development /readyz hides why postgres failed: %s", resp.Body)
				}
			default:
				if hasText || leaks {
					t.Errorf("production /readyz reveals the database error: %s", resp.Body)
				}
			}
			if !strings.Contains(s.logs.String(), "health check failed") {
				t.Errorf("the failed postgres check was not logged:\n%s", s.logs.String())
			}

			if live := s.get(t, "/healthz"); live.Status != http.StatusOK {
				t.Errorf("GET /healthz = %d, want 200: liveness must not depend on the database", live.Status)
			}
			cats := s.get(t, "/v1/categories")
			if cats.Status != http.StatusInternalServerError {
				t.Fatalf("GET /v1/categories = %d, want 500", cats.Status)
			}
			assertErrorBody(t, cats.Body, "INTERNAL_ERROR")
			if strings.Contains(string(cats.Body), addr) || strings.Contains(string(cats.Body), "dial") {
				t.Errorf("the 500 body reveals the driver error: %s", cats.Body)
			}
		})
	}
}

// TestReadyz_DatabaseDropped takes the database away under a running,
// healthy server: readiness follows, and recovers no further because the
// database is gone.
func TestReadyz_DatabaseDropped(t *testing.T) {
	s := startServer(t, map[string]string{"APP_ENV": config.EnvProduction})
	if r := s.get(t, "/readyz"); r.Status != http.StatusOK {
		t.Fatalf("GET /readyz = %d before the drop, want 200: %s", r.Status, r.Body)
	}

	u, err := url.Parse(s.dbURL)
	if err != nil {
		t.Fatalf("parse the test database URL: %v", err)
	}
	admin := openDB(t, testx.PostgresContainer(t))
	mustExec(t, admin, "DROP DATABASE "+strings.TrimPrefix(u.Path, "/")+" WITH (FORCE)")

	eventually(t, 5*time.Second, func() bool {
		return s.get(t, "/readyz").Status == http.StatusServiceUnavailable
	}, "/readyz still 200 after the database was dropped")
	if r := s.get(t, "/v1/categories"); r.Status != http.StatusInternalServerError {
		t.Errorf("GET /v1/categories = %d, want 500", r.Status)
	}
}
