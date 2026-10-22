package health_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/healthx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/health"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

type probeResponse struct {
	Status string `json:"status"`
	Checks map[string]struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	} `json:"checks"`
}

func probe(t *testing.T, h *healthx.Handler, path string) (int, probeResponse, string) {
	t.Helper()
	r := chi.NewRouter()
	health.Routes(r, h)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil))
	var body probeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %s body %q: %v", path, rec.Body.String(), err)
	}
	testx.AssertEqual(t, rec.Header().Get("Content-Type"), "application/json")
	return rec.Code, body, rec.Body.String()
}

func TestHandler(t *testing.T) {
	failingDB := healthx.NamedCheck{Name: "postgres", Check: healthx.AlwaysFail("dial tcp 10.0.0.5:5432: refused")}
	okRedis := healthx.NamedCheck{Name: "redis", Check: healthx.AlwaysOK()}

	tests := []struct {
		name       string
		draining   bool
		hideErrors bool
		deps       []healthx.NamedCheck
		wantReady  int
		wantChecks map[string]string // check name → "status|error"
	}{
		{
			name:       "ready",
			wantReady:  http.StatusOK,
			wantChecks: map[string]string{"server": "ok|"},
		},
		{
			name:       "draining shows the reason",
			draining:   true,
			wantReady:  http.StatusServiceUnavailable,
			wantChecks: map[string]string{"server": "unavailable|shutting down"},
		},
		{
			name:       "draining with hidden errors",
			draining:   true,
			hideErrors: true,
			wantReady:  http.StatusServiceUnavailable,
			wantChecks: map[string]string{"server": "unavailable|"},
		},
		{
			name:       "dependencies are checked too",
			deps:       []healthx.NamedCheck{okRedis, failingDB},
			wantReady:  http.StatusServiceUnavailable,
			wantChecks: map[string]string{"server": "ok|", "redis": "ok|", "postgres": "unavailable|dial tcp 10.0.0.5:5432: refused"},
		},
		{
			name:       "dependency error text hidden outside development",
			deps:       []healthx.NamedCheck{failingDB},
			hideErrors: true,
			wantReady:  http.StatusServiceUnavailable,
			wantChecks: map[string]string{"server": "ok|", "postgres": "unavailable|"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			readiness := &health.Readiness{}
			if tt.draining {
				readiness.StartDraining()
			}
			h := health.NewHandler(logging.New(&logs, false, "info"), readiness, tt.hideErrors, tt.deps...)

			// Liveness has no checks: 200 even while draining or a
			// dependency is down, so the container is never restarted for it.
			code, live, _ := probe(t, h, "/healthz")
			testx.AssertEqual(t, code, http.StatusOK)
			testx.AssertEqual(t, live.Status, "ok")
			testx.AssertEqual(t, len(live.Checks), 0)

			code, ready, raw := probe(t, h, "/readyz")
			testx.AssertEqual(t, code, tt.wantReady)
			wantStatus := "ok"
			if tt.wantReady != http.StatusOK {
				wantStatus = "unavailable"
			}
			testx.AssertEqual(t, ready.Status, wantStatus)
			testx.AssertEqual(t, len(ready.Checks), len(tt.wantChecks))
			for name, want := range tt.wantChecks {
				c, ok := ready.Checks[name]
				testx.AssertTrue(t, ok, "check %q missing from %s", name, raw)
				testx.AssertEqual(t, c.Status+"|"+c.Error, want, "check %q", name)
			}
			if tt.hideErrors {
				testx.AssertFalse(t, strings.Contains(raw, "10.0.0.5") || strings.Contains(raw, "shutting down"),
					"error text leaked: %s", raw)
				// ... but it is still logged.
				if tt.draining {
					testx.AssertContains(t, logs.String(), "shutting down")
				} else {
					testx.AssertContains(t, logs.String(), "10.0.0.5")
				}
			}
		})
	}
}

func TestLogged(t *testing.T) {
	boom := errors.New("redis: connection refused")
	tests := []struct {
		name    string
		err     error
		wantLog bool
	}{
		{name: "passing check is not logged", err: nil, wantLog: false},
		{name: "failing check is logged at warn", err: boom, wantLog: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			var gotCtx context.Context
			check := health.Logged(logging.New(&logs, false, "info"), "redis", func(ctx context.Context) error {
				gotCtx = ctx
				return tt.err
			})
			testx.AssertEqual(t, check.Name, "redis")

			ctx := ctxx.WithRequestID(context.Background(), "req-123")
			err := check.Check(ctx)

			//nolint:errorlint // the very same value must come back, not a wrapped one
			testx.AssertTrue(t, err == tt.err, "Check returned %v, want exactly %v", err, tt.err)
			testx.AssertTrue(t, gotCtx == ctx, "the probe's context is passed to the check")
			if !tt.wantLog {
				testx.AssertEqual(t, logs.Len(), 0, "logged %q", logs.String())
				return
			}
			var line map[string]any
			if err := json.Unmarshal(logs.Bytes(), &line); err != nil {
				t.Fatalf("decode log %q: %v", logs.String(), err)
			}
			testx.AssertEqual(t, line["level"], any("WARN"))
			testx.AssertEqual(t, line["msg"], any("health check failed"))
			testx.AssertEqual(t, line["check"], any("redis"))
			testx.AssertEqual(t, line["error"], any("redis: connection refused"))
			testx.AssertEqual(t, line["request_id"], any("req-123"))
		})
	}
}
