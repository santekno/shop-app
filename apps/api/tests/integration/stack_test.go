//go:build integration

package integration_test

import (
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// stackURLEnv names the base URL of the API container that `make
// test-integration` starts with Docker Compose.
const stackURLEnv = "GOSHOP_API_URL"

// stackAPI returns the base URL of the dockerized API. It fails rather than
// skips when the variable is missing: make test-integration always sets it,
// and a skipped test would let a broken image pass the gate.
func stackAPI(t *testing.T) string {
	t.Helper()
	base := strings.TrimRight(os.Getenv(stackURLEnv), "/")
	if base == "" {
		t.Fatalf("%s is not set. Run `make test-integration`, which starts the Compose api service "+
			"and sets %s=http://127.0.0.1:8080, or start it yourself (`make up`) and export the variable.",
			stackURLEnv, stackURLEnv)
	}
	if u, err := url.Parse(base); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		t.Fatalf("%s=%q is not an http(s) URL", stackURLEnv, base)
	}
	return base
}

// TestStack_API checks the API image as Docker Compose runs it: built from
// apps/api/Dockerfile, configured only by the environment in
// docker-compose.yml, and reachable on the published port.
func TestStack_API(t *testing.T) {
	base := stackAPI(t)
	client := &http.Client{Timeout: 5 * time.Second}
	t.Cleanup(client.CloseIdleConnections)

	t.Run("healthz", func(t *testing.T) {
		resp := doRequest(t, client, http.MethodGet, base+"/healthz", nil)
		if resp.Status != http.StatusOK {
			t.Fatalf("GET /healthz = %d, want 200: %s", resp.Status, resp.Body)
		}
		if status, _ := assertHealthBody(t, resp, "/healthz"); status != "ok" {
			t.Errorf("/healthz status = %q, want ok", status)
		}
	})

	t.Run("head healthz", func(t *testing.T) {
		resp := doRequest(t, client, http.MethodHead, base+"/healthz", nil)
		if resp.Status != http.StatusOK || len(resp.Body) != 0 {
			t.Fatalf("HEAD /healthz = %d with %d body bytes, want 200 and no body", resp.Status, len(resp.Body))
		}
	})

	t.Run("readyz", func(t *testing.T) {
		resp := doRequest(t, client, http.MethodGet, base+"/readyz", nil)
		if resp.Status != http.StatusOK {
			t.Fatalf("GET /readyz = %d, want 200: %s", resp.Status, resp.Body)
		}
		if status, _ := assertHealthBody(t, resp, "/readyz"); status != "ok" {
			t.Errorf("/readyz status = %q, want ok", status)
		}
	})

	t.Run("categories", func(t *testing.T) {
		resp := doRequest(t, client, http.MethodGet, base+"/v1/categories", map[string]string{"X-Request-ID": "stack-check-1"})
		if cats := assertCategoryList(t, resp); len(cats) != seededCategories {
			t.Errorf("got %d categories, want %d", len(cats), seededCategories)
		}
		if got := resp.Header.Get("X-Request-ID"); got != "stack-check-1" {
			t.Errorf("X-Request-ID = %q, want the caller's value echoed", got)
		}
	})

	t.Run("unknown route", func(t *testing.T) {
		resp := doRequest(t, client, http.MethodGet, base+"/v1/products", nil)
		if resp.Status != http.StatusNotFound {
			t.Fatalf("GET /v1/products = %d, want 404 until Bab 3", resp.Status)
		}
		assertErrorBody(t, resp.Body, "NOT_FOUND")
	})
}
