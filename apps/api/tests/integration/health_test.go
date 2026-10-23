//go:build integration

package integration_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// assertHealthBody checks a probe body against the contract's HealthStatus
// and HealthCheck schemas and returns its status and checks.
func assertHealthBody(t *testing.T, resp response, what string) (string, map[string]map[string]json.RawMessage) {
	t.Helper()
	assertJSONContentType(t, resp.Header, what)
	obj := decodeObject(t, resp.Body)
	assertMatchesSchema(t, obj, contractSchema(t, "HealthStatus"), what)

	var status string
	if err := json.Unmarshal(obj["status"], &status); err != nil || (status != "ok" && status != "unavailable") {
		t.Errorf("%s: status = %s, want \"ok\" or \"unavailable\"", what, obj["status"])
	}

	checks := map[string]map[string]json.RawMessage{}
	if raw, ok := obj["checks"]; ok {
		var byName map[string]json.RawMessage
		if err := json.Unmarshal(raw, &byName); err != nil {
			t.Fatalf("%s: checks is not an object: %s", what, raw)
		}
		checkSchema := contractSchema(t, "HealthCheck")
		for name, c := range byName {
			entry := decodeObject(t, c)
			assertMatchesSchema(t, entry, checkSchema, what+" checks."+name)
			var ms int64
			if err := json.Unmarshal(entry["duration_ms"], &ms); err != nil || ms < 0 {
				t.Errorf("%s: checks.%s.duration_ms = %s, want an integer >= 0", what, name, entry["duration_ms"])
			}
			checks[name] = entry
		}
	}
	return status, checks
}

func jsonString(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("%s is not a JSON string", raw)
	}
	return s
}

// TestHealth_Probes checks both probes of a running, ready server.
func TestHealth_Probes(t *testing.T) {
	s := startServer(t, nil)

	t.Run("healthz", func(t *testing.T) {
		resp := s.get(t, "/healthz")
		if resp.Status != http.StatusOK {
			t.Fatalf("GET /healthz = %d, want 200: %s", resp.Status, resp.Body)
		}
		status, checks := assertHealthBody(t, resp, "/healthz")
		if status != "ok" || len(checks) != 0 {
			t.Errorf("/healthz = %s, want status ok and no checks (liveness checks no dependency)", resp.Body)
		}
		if bytes.Contains(resp.Body, []byte(`"checks"`)) {
			t.Errorf("/healthz has a checks key, the contract omits it when there are no checks: %s", resp.Body)
		}
	})

	t.Run("readyz", func(t *testing.T) {
		resp := s.get(t, "/readyz")
		if resp.Status != http.StatusOK {
			t.Fatalf("GET /readyz = %d, want 200: %s", resp.Status, resp.Body)
		}
		status, checks := assertHealthBody(t, resp, "/readyz")
		if status != "ok" {
			t.Errorf("/readyz status = %q, want ok", status)
		}
		// The readiness checks: "server" (not draining), from Bab 3
		// "postgres" (a ping through the pool) and from Bab 4 "redis" (a
		// PING: sessions and rate limits need it).
		server, ok := checks["server"]
		pg, okPG := checks["postgres"]
		rd, okRedis := checks["redis"]
		if len(checks) != 3 || !ok || !okPG || !okRedis {
			t.Fatalf("/readyz checks = %s, want \"server\", \"postgres\" and \"redis\"", resp.Body)
		}
		if got := jsonString(t, pg["status"]); got != "ok" {
			t.Errorf("checks.postgres.status = %q, want ok", got)
		}
		if got := jsonString(t, rd["status"]); got != "ok" {
			t.Errorf("checks.redis.status = %q, want ok", got)
		}
		if got := jsonString(t, server["status"]); got != "ok" {
			t.Errorf("checks.server.status = %q, want ok", got)
		}
		if _, has := server["error"]; has {
			t.Errorf("checks.server has an error while ready: %s", resp.Body)
		}
	})
}

// TestHealth_HideErrorsOutsideDevelopment drains each kind of server so its
// readiness check fails, then checks what /readyz reveals: the error text in
// development, nothing outside it (the text can contain internal addresses),
// while the failure is still logged.
func TestHealth_HideErrorsOutsideDevelopment(t *testing.T) {
	tests := []struct {
		env      string
		wantText bool
	}{
		{env: config.EnvDevelopment, wantText: true},
		{env: config.EnvStaging, wantText: false},
		{env: config.EnvProduction, wantText: false},
	}
	for _, tt := range tests {
		t.Run(tt.env, func(t *testing.T) {
			s := startServer(t, map[string]string{
				"APP_ENV":         tt.env,
				"APP_DRAIN_DELAY": "1s",
			})
			s.cancel() // what SIGTERM does: start draining

			var resp response
			eventually(t, 800*time.Millisecond, func() bool {
				resp = s.get(t, "/readyz")
				return resp.Status == http.StatusServiceUnavailable
			}, "/readyz never answered 503 after shutdown began")

			status, checks := assertHealthBody(t, resp, "/readyz")
			if status != "unavailable" {
				t.Errorf("status = %q, want unavailable", status)
			}
			server := checks["server"]
			if got := jsonString(t, server["status"]); got != "unavailable" {
				t.Errorf("checks.server.status = %q, want unavailable", got)
			}

			errText, hasText := server["error"]
			switch {
			case tt.wantText && (!hasText || jsonString(t, errText) != "shutting down"):
				t.Errorf("%s: checks.server.error = %s, want \"shutting down\"", tt.env, errText)
			case !tt.wantText && (hasText || bytes.Contains(resp.Body, []byte("shutting down"))):
				t.Errorf("%s: /readyz reveals the check error: %s", tt.env, resp.Body)
			}

			// Hidden from the client, but always in the server log.
			eventually(t, 2*time.Second, func() bool {
				return strings.Contains(s.logs.String(), "health check failed")
			}, "the failed check was not logged:\n%s", s.logs.String())
			if logs := s.logs.String(); !strings.Contains(logs, "shutting down") {
				t.Errorf("the log does not say why the check failed:\n%s", logs)
			}
		})
	}
}
