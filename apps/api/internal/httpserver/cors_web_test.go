package httpserver_test

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

// The web session's CORS (Bab 10, ADR 0008): only requests under
// CredentialedPathPrefix may carry cookies cross-origin; every other path
// keeps the public options, without credentials.

const (
	webShop   = "https://shop.example.com"
	webPrefix = "/v1/auth/web/"
)

// newWebRouter is the router with CredentialedPathPrefix prefix, a web
// session route and a catalog route.
func newWebRouter(t *testing.T, origins []string, prefix string) http.Handler {
	t.Helper()
	return httpserver.NewRouter(httpserver.Options{
		Logger:                 logging.New(io.Discard, false, "error"),
		AllowedOrigins:         origins,
		CredentialedPathPrefix: prefix,
		RequestTimeout:         time.Second,
		Probes:                 func(chi.Router) {},
	}, func(r chi.Router) {
		r.Route("/v1", func(r chi.Router) {
			r.Post("/auth/web/refresh", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
			r.Post("/auth/webhook", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
			r.Get("/products", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
		})
	})
}

func preflight(origin, method, headers string) map[string]string {
	return map[string]string{
		"Origin": origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers,
	}
}

func TestRouter_CORSWebSession(t *testing.T) {
	tests := []struct {
		name        string
		origins     []string
		prefix      string
		method      string
		path        string
		header      map[string]string
		wantOrigin  string
		wantCreds   string
		wantHeaders string
		wantMethods string
		wantExposed string
	}{
		{
			name: "preflight to the web refresh", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/auth/web/refresh",
			header:     preflight(webShop, "POST", "Content-Type, X-GoShop-Client"),
			wantOrigin: webShop, wantCreds: "true", wantHeaders: "Content-Type, X-Goshop-Client", wantMethods: "POST",
		},
		{
			name: "the web refresh itself", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodPost, path: "/v1/auth/web/refresh", header: map[string]string{"Origin": webShop},
			wantOrigin: webShop, wantCreds: "true", wantExposed: "X-Request-Id, Retry-After",
		},
		{
			name: "the allowed origin in another case is echoed as sent", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodPost, path: "/v1/auth/web/refresh", header: map[string]string{"Origin": "https://SHOP.example.com"},
			wantOrigin: "https://SHOP.example.com", wantCreds: "true", wantExposed: "X-Request-Id, Retry-After",
		},
		{
			name: "web preflight for a method other than POST", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/auth/web/refresh", header: preflight(webShop, "DELETE", ""),
		},
		{
			name: "web preflight for the cart token header", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/auth/web/refresh", header: preflight(webShop, "POST", "X-Cart-Token"),
		},
		{
			name: "preflight to the catalog", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/products", header: preflight(webShop, "GET", "Content-Type"),
			wantOrigin: webShop, wantHeaders: "Content-Type", wantMethods: "GET",
		},
		{
			name: "the catalog itself", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodGet, path: "/v1/products", header: map[string]string{"Origin": webShop},
			wantOrigin: webShop, wantExposed: "X-Request-Id, Retry-After, Location, X-Cart-Token, Idempotency-Replayed",
		},
		{
			name: "the catalog does not allow X-GoShop-Client", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/products", header: preflight(webShop, "GET", "X-GoShop-Client"),
		},
		{
			name: "a path that only starts like the prefix", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodPost, path: "/v1/auth/webhook", header: map[string]string{"Origin": webShop},
			wantOrigin: webShop, wantExposed: "X-Request-Id, Retry-After, Location, X-Cart-Token, Idempotency-Replayed",
		},
		{
			name: "a foreign origin's web preflight", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/auth/web/refresh",
			header: preflight("https://evil.example.com", "POST", "Content-Type, X-GoShop-Client"),
		},
		{
			name: "a foreign origin's web request", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodPost, path: "/v1/auth/web/refresh", header: map[string]string{"Origin": "https://evil.example.com"},
		},
		{
			name: "the null origin", origins: []string{webShop}, prefix: webPrefix,
			method: http.MethodPost, path: "/v1/auth/web/refresh", header: map[string]string{"Origin": "null"},
		},
		{
			name: "no prefix: no credentials on the web path", origins: []string{webShop}, prefix: "",
			method: http.MethodPost, path: "/v1/auth/web/refresh", header: map[string]string{"Origin": webShop},
			wantOrigin: webShop, wantExposed: "X-Request-Id, Retry-After, Location, X-Cart-Token, Idempotency-Replayed",
		},
		{
			name: "no prefix: the web preflight gets the public options", origins: []string{webShop}, prefix: "",
			method: http.MethodOptions, path: "/v1/auth/web/refresh", header: preflight(webShop, "POST", "Content-Type"),
			wantOrigin: webShop, wantHeaders: "Content-Type", wantMethods: "POST",
		},
		{
			name: "empty origins deny the web preflight", origins: nil, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/auth/web/refresh", header: preflight(webShop, "POST", "X-GoShop-Client"),
		},
		{
			name: "empty origins deny the web request", origins: []string{}, prefix: webPrefix,
			method: http.MethodPost, path: "/v1/auth/web/refresh", header: map[string]string{"Origin": webShop},
		},
		{
			name: "empty origins deny the catalog preflight", origins: nil, prefix: webPrefix,
			method: http.MethodOptions, path: "/v1/products", header: preflight(webShop, "GET", ""),
		},
		{
			name: "empty origins deny the catalog", origins: nil, prefix: webPrefix,
			method: http.MethodGet, path: "/v1/products", header: map[string]string{"Origin": webShop},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(newWebRouter(t, tt.origins, tt.prefix), tt.method, tt.path, tt.header)
			h := rec.Header()
			testx.AssertEqual(t, h.Get("Access-Control-Allow-Origin"), tt.wantOrigin)
			testx.AssertEqual(t, h.Get("Access-Control-Allow-Credentials"), tt.wantCreds)
			testx.AssertEqual(t, h.Get("Access-Control-Allow-Headers"), tt.wantHeaders)
			testx.AssertEqual(t, h.Get("Access-Control-Allow-Methods"), tt.wantMethods)
			testx.AssertEqual(t, h.Get("Access-Control-Expose-Headers"), tt.wantExposed)
			testx.AssertNotEqual(t, h.Get("Access-Control-Allow-Origin"), "*")
		})
	}
}

// A credentialed answer always varies by Origin, so a shared cache never
// hands one origin's answer to another.
func TestRouter_CORSWebSessionVaryOrigin(t *testing.T) {
	rec := do(newWebRouter(t, []string{webShop}, webPrefix), http.MethodPost, "/v1/auth/web/refresh",
		map[string]string{"Origin": webShop})
	testx.AssertContains(t, strings.Join(rec.Header().Values("Vary"), ","), "Origin")
}
