package app_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
)

// portOf returns the port of an httptest server (always on 127.0.0.1).
func portOf(t *testing.T, srv *httptest.Server) int {
	t.Helper()
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse %s: %v", srv.URL, err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("port of %s: %v", srv.URL, err)
	}
	return port
}

// freePort returns a port nothing listens on.
func freePort(t *testing.T) int {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return port
}

func TestProbe(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		wantErr string
	}{
		{name: "200 is healthy", status: http.StatusOK},
		{name: "503 is unhealthy", status: http.StatusServiceUnavailable, wantErr: "/healthz answered 503"},
		{name: "204 is not 200", status: http.StatusNoContent, wantErr: "answered 204"},
		{name: "500", status: http.StatusInternalServerError, wantErr: "answered 500"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotPath, gotMethod string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotPath, gotMethod = r.URL.Path, r.Method
				w.WriteHeader(tt.status)
			}))
			defer srv.Close()

			err := app.Probe(context.Background(), portOf(t, srv))

			testx.AssertEqual(t, gotPath, "/healthz")
			testx.AssertEqual(t, gotMethod, http.MethodGet)
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				return
			}
			if err == nil {
				t.Fatalf("Probe: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), "healthcheck: http://127.0.0.1:")
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestProbe_ConnectionRefused(t *testing.T) {
	err := app.Probe(context.Background(), freePort(t))
	if err == nil {
		t.Fatal("Probe: want error, got nil")
	}
	testx.AssertContains(t, err.Error(), "healthcheck: ")
	testx.AssertContains(t, err.Error(), "connection refused")
}

func TestProbe_Timeout(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	defer close(release)

	tests := []struct {
		name    string
		ctx     func() (context.Context, context.CancelFunc)
		minWait time.Duration
		maxWait time.Duration
	}{
		{
			name: "caller's shorter deadline wins",
			ctx: func() (context.Context, context.CancelFunc) {
				return context.WithTimeout(context.Background(), 50*time.Millisecond)
			},
			minWait: 50 * time.Millisecond,
			maxWait: time.Second,
		},
		{
			name:    "own 3s limit without a caller deadline",
			ctx:     func() (context.Context, context.CancelFunc) { return context.WithCancel(context.Background()) },
			minWait: 3 * time.Second,
			maxWait: 5 * time.Second,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := tt.ctx()
			defer cancel()
			start := time.Now()

			done := make(chan error, 1)
			go func() { done <- app.Probe(ctx, portOf(t, srv)) }()
			var err error
			select {
			case err = <-done:
			case <-time.After(tt.maxWait):
				t.Fatalf("Probe still waiting after %s", tt.maxWait)
			}

			elapsed := time.Since(start)
			testx.AssertTrue(t, errors.Is(err, context.DeadlineExceeded), "err = %v, want deadline exceeded", err)
			testx.AssertTrue(t, elapsed >= tt.minWait && elapsed < tt.maxWait, "Probe gave up after %s", elapsed)
		})
	}
}
