package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestSecurityHeaders(t *testing.T) {
	want := map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
		"X-Frame-Options":         "DENY",
		"Referrer-Policy":         "no-referrer",
		"Cache-Control":           "no-store",
	}
	tests := []struct {
		name     string
		hsts     bool
		wantHSTS string
	}{
		{name: "outside development", hsts: true, wantHSTS: "max-age=31536000; includeSubDomains"},
		{name: "development (plain HTTP)", hsts: false, wantHSTS: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// The handler fails: error responses carry the headers too.
			h := httpapi.SecurityHeaders(tt.hsts)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				httpapi.Error(w, r, httpapi.NotFoundError("nope"))
			}))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))
			testx.AssertEqual(t, rec.Code, http.StatusNotFound)
			for k, v := range want {
				testx.AssertEqual(t, rec.Header().Get(k), v, "%s", k)
			}
			testx.AssertEqual(t, rec.Header().Get("Strict-Transport-Security"), tt.wantHSTS)
		})
	}
}
