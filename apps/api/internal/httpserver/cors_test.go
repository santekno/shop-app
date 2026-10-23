package httpserver_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// A browser script on an allowed origin may read the request ID, the
// Retry-After of a 429, the Location of a 201 and the X-Cart-Token of a
// new guest cart, and nothing else.
func TestRouter_CORSExposedHeaders(t *testing.T) {
	const allowed = "https://shop.example.com"
	h, _ := newRouter(t, []string{allowed}, time.Second)
	rec := do(h, http.MethodGet, "/ok", map[string]string{"Origin": allowed})

	exposed := map[string]bool{}
	for _, name := range strings.Split(rec.Header().Get("Access-Control-Expose-Headers"), ",") {
		exposed[http.CanonicalHeaderKey(strings.TrimSpace(name))] = true
	}
	for _, name := range []string{"X-Request-Id", "Retry-After", "Location", "X-Cart-Token"} {
		testx.AssertTrue(t, exposed[name], "%s is exposed: %q", name, rec.Header().Get("Access-Control-Expose-Headers"))
	}
	testx.AssertEqual(t, len(exposed), 4, "exactly these: %v", exposed)
}

// A browser on an allowed origin may send the guest cart's X-Cart-Token
// (ADR 0006); a header that is not on the list is still refused.
func TestRouter_CORSAllowedRequestHeaders(t *testing.T) {
	const allowed = "https://shop.example.com"
	h, _ := newRouter(t, []string{allowed}, time.Second)
	tests := []struct {
		name    string
		request string
		want    string
	}{
		{name: "the guest cart token", request: "X-Cart-Token", want: "X-Cart-Token"},
		{name: "with the usual headers", request: "Authorization, Content-Type, X-Cart-Token", want: "Authorization, Content-Type, X-Cart-Token"},
		{name: "a header not on the list", request: "X-Not-Allowed", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(h, http.MethodOptions, "/v1/cart", map[string]string{
				"Origin": allowed, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": tt.request,
			})
			testx.AssertEqual(t, rec.Header().Get("Access-Control-Allow-Headers"), tt.want)
		})
	}
}
