package httpserver_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// A browser script on an allowed origin may read the request ID, the
// Retry-After of a 429 and the Location of a 201, and nothing else.
func TestRouter_CORSExposedHeaders(t *testing.T) {
	const allowed = "https://shop.example.com"
	h, _ := newRouter(t, []string{allowed}, time.Second)
	rec := do(h, http.MethodGet, "/ok", map[string]string{"Origin": allowed})

	exposed := map[string]bool{}
	for _, name := range strings.Split(rec.Header().Get("Access-Control-Expose-Headers"), ",") {
		exposed[http.CanonicalHeaderKey(strings.TrimSpace(name))] = true
	}
	for _, name := range []string{"X-Request-Id", "Retry-After", "Location"} {
		testx.AssertTrue(t, exposed[name], "%s is exposed: %q", name, rec.Header().Get("Access-Control-Expose-Headers"))
	}
	testx.AssertEqual(t, len(exposed), 3, "exactly these: %v", exposed)
}
