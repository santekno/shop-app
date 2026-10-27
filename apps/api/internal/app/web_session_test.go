package app_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// The web session's wiring (Bab 10, ADR 0008): the handler gets the CORS
// origins and APP_AUTH_COOKIE_SECURE, and the router allows credentials
// under /v1/auth/web/ only.
func TestApp_WebSessionWiring(t *testing.T) {
	const shop = "https://shop.example.com"
	tests := []struct {
		name       string
		env        string
		secure     bool
		wantSecure bool
		wantWarn   bool
	}{
		{name: "secure", env: config.EnvProduction, secure: true, wantSecure: true},
		{name: "insecure in development", env: config.EnvDevelopment, secure: false, wantSecure: false, wantWarn: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := testConfig(tt.env)
			cfg.CORSAllowedOrigins = []string{shop}
			if !tt.secure {
				cfg.Auth.CookieSecure = false // the secure case keeps testConfig's default
			}
			var logs bytes.Buffer
			h := app.New(cfg, logx.New(logx.WithOutput(&logs), logx.WithFormat("json")),
				(&fakeDB{}).open(t), testRedis(t)).Handler()

			send := func(origin, cookie string) *httptest.ResponseRecorder {
				r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/auth/web/refresh", nil)
				r.Header.Set("X-GoShop-Client", "web")
				r.Header.Set("Origin", origin)
				if cookie != "" {
					r.Header.Set("Cookie", cookie)
				}
				rec := httptest.NewRecorder()
				h.ServeHTTP(rec, r)
				return rec
			}

			// No cookie: 204, with the credentialed CORS answer.
			rec := send(shop, "")
			testx.AssertEqual(t, rec.Code, http.StatusNoContent, "body %s", rec.Body.String())
			testx.AssertEqual(t, rec.Header().Get("Access-Control-Allow-Origin"), shop)
			testx.AssertEqual(t, rec.Header().Get("Access-Control-Allow-Credentials"), "true")

			// The handler got the origin list.
			rec = send("https://evil.example.com", "")
			testx.AssertEqual(t, rec.Code, http.StatusForbidden)

			// Two cookies are refused without the database, and the
			// cleared cookie shows whether Secure is on.
			rec = send(shop, "goshop_refresh=a; goshop_refresh=b")
			testx.AssertEqual(t, rec.Code, http.StatusUnauthorized, "body %s", rec.Body.String())
			setCookie := rec.Header().Get("Set-Cookie")
			testx.AssertContains(t, setCookie, "goshop_refresh=; Path=/v1/auth/web; Max-Age=0; HttpOnly")
			testx.AssertEqual(t, strings.Contains(setCookie, "; Secure"), tt.wantSecure, "Set-Cookie %q", setCookie)

			// Other routes answer the same origin without credentials.
			r := httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/v1/categories", nil)
			r.Header.Set("Origin", shop)
			r.Header.Set("Access-Control-Request-Method", http.MethodGet)
			other := httptest.NewRecorder()
			h.ServeHTTP(other, r)
			testx.AssertEqual(t, other.Header().Get("Access-Control-Allow-Origin"), shop)
			testx.AssertEqual(t, other.Header().Get("Access-Control-Allow-Credentials"), "")

			testx.AssertEqual(t, strings.Contains(logs.String(),
				"the web session cookie is sent without Secure: APP_AUTH_COOKIE_SECURE=false (development only)"), tt.wantWarn)
		})
	}
}
