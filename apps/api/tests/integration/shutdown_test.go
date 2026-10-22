//go:build integration

package integration_test

import (
	"context"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestShutdown_DrainThenStop follows graceful shutdown from outside, the way
// a load balancer sees it: once shutdown begins, /readyz turns 503 at once
// while the server keeps answering every request (old and new connections)
// for APP_DRAIN_DELAY; then the listener closes and Serve returns nil.
func TestShutdown_DrainThenStop(t *testing.T) {
	const drain = 1500 * time.Millisecond
	s := startServer(t, map[string]string{
		"APP_DRAIN_DELAY":      "1500ms",
		"APP_SHUTDOWN_TIMEOUT": "2s",
	})

	if resp := s.get(t, "/readyz"); resp.Status != http.StatusOK {
		t.Fatalf("GET /readyz before shutdown = %d, want 200: %s", resp.Status, resp.Body)
	}
	if !s.app.Ready() {
		t.Fatal("app.Ready() = false before shutdown")
	}

	start := time.Now()
	s.cancel() // what SIGTERM does in main

	eventually(t, drain/2, func() bool {
		return s.get(t, "/readyz").Status == http.StatusServiceUnavailable
	}, "/readyz did not turn 503 within %s of shutdown starting", drain/2)
	if s.app.Ready() {
		t.Error("app.Ready() = true while draining")
	}

	// Still serving while draining: liveness stays 200, so the container is
	// not restarted, and real requests keep working, also on a brand-new
	// connection (the listener is still open).
	fresh := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	for _, path := range []string{"/healthz", "/v1/categories"} {
		if resp := s.get(t, path); resp.Status != http.StatusOK {
			t.Errorf("GET %s while draining = %d, want 200", path, resp.Status)
		}
		if resp := doRequest(t, fresh, http.MethodGet, s.URL+path, nil); resp.Status != http.StatusOK {
			t.Errorf("GET %s on a new connection while draining = %d, want 200", path, resp.Status)
		}
	}
	if elapsed := time.Since(start); elapsed >= drain {
		t.Fatalf("the checks above took %s, longer than the drain delay; the test proves nothing", elapsed)
	}

	if err := s.stop(drain + 5*time.Second); err != nil {
		t.Fatalf("serve returned %v, want nil after a clean shutdown", err)
	}
	if elapsed := time.Since(start); elapsed < drain {
		t.Errorf("serve returned after %s, before the %s drain delay", elapsed, drain)
	}

	// After shutdown nothing listens on the port.
	var d net.Dialer
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if conn, err := d.DialContext(ctx, "tcp", strings.TrimPrefix(s.URL, "http://")); err == nil {
		_ = conn.Close()
		t.Error("the port still accepts connections after shutdown")
	}
}

// TestShutdown_NoDrainDelay checks the default APP_DRAIN_DELAY of 0s: the
// server stops right away instead of waiting.
func TestShutdown_NoDrainDelay(t *testing.T) {
	s := startServer(t, nil)
	if resp := s.get(t, "/v1/categories"); resp.Status != http.StatusOK {
		t.Fatalf("GET /v1/categories = %d, want 200", resp.Status)
	}
	start := time.Now()
	if err := s.stop(5 * time.Second); err != nil {
		t.Fatalf("serve returned %v, want nil", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("shutdown with no drain delay took %s, want well under a second", elapsed)
	}
	if s.app.Ready() {
		t.Error("app.Ready() = true after shutdown")
	}
}
