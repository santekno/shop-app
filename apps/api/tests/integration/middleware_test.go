//go:build integration

package integration_test

import (
	"net/http"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// generatedRequestID is what the server makes up when the caller sends no
// usable X-Request-ID: 16 random bytes, hex encoded.
var generatedRequestID = regexp.MustCompile(`^[0-9a-f]{32}$`)

// eventually polls cond every 10ms until it holds or limit passes.
func eventually(t *testing.T, limit time.Duration, cond func() bool, msg string, args ...any) {
	t.Helper()
	deadline := time.Now().Add(limit)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf(msg, args...)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestRequestID covers the X-Request-ID rules from the contract over real
// HTTP: a valid caller value (1-128 chars of A-Za-z0-9._:-) is echoed, a
// missing or invalid one is replaced by a generated ID, on success and error
// responses alike.
func TestRequestID(t *testing.T) {
	s := startServer(t, nil)

	max128 := strings.Repeat("aB0._:-", 19)[:128]
	tests := []struct {
		name string
		sent *string // nil: header not sent
		echo bool    // true: the response must carry exactly the sent value
	}{
		{name: "missing is generated", sent: nil},
		{name: "empty is generated", sent: ptr("")},
		{name: "simple value is echoed", sent: ptr("req-123"), echo: true},
		{name: "every allowed character is echoed", sent: ptr("Az09._:-"), echo: true},
		{name: "a UUID is echoed", sent: ptr("0192f3a0-1c2d-7b4e-8a10-3f5e6d7c8b90"), echo: true},
		{name: "128 characters is echoed", sent: ptr(max128), echo: true},
		{name: "129 characters is replaced", sent: ptr(max128 + "a")},
		{name: "space is replaced", sent: ptr("req 123")},
		{name: "slash is replaced", sent: ptr("req/123")},
		{name: "non-ASCII is replaced", sent: ptr("req-ü")},
		{name: "log injection is replaced", sent: ptr(`x","level":"ERROR`)},
	}
	for _, path := range []string{"/v1/categories", "/healthz", "/does-not-exist"} {
		for _, tt := range tests {
			t.Run(path+"/"+tt.name, func(t *testing.T) {
				headers := map[string]string{}
				if tt.sent != nil {
					headers["X-Request-ID"] = *tt.sent
				}
				resp := s.do(t, http.MethodGet, path, headers)
				got := resp.Header.Values("X-Request-ID")
				if len(got) != 1 {
					t.Fatalf("X-Request-ID values = %q, want exactly one", got)
				}
				switch {
				case tt.echo && got[0] != *tt.sent:
					t.Errorf("X-Request-ID = %q, want the caller's %q echoed", got[0], *tt.sent)
				case !tt.echo && !generatedRequestID.MatchString(got[0]):
					t.Errorf("X-Request-ID = %q, want a generated 32-char hex ID", got[0])
				}
			})
		}
	}

	t.Run("generated IDs differ per request", func(t *testing.T) {
		seen := map[string]bool{}
		for range 20 {
			id := s.get(t, "/healthz").Header.Get("X-Request-ID")
			if seen[id] {
				t.Fatalf("generated ID %q was handed out twice", id)
			}
			seen[id] = true
		}
	})
}

// TestRequestID_InAccessLog checks that the ID the client receives is the one
// in the server's access log, so a reported ID leads to the log line.
func TestRequestID_InAccessLog(t *testing.T) {
	s := startServer(t, map[string]string{"APP_ENV": config.EnvProduction})

	tests := []struct {
		name, sent, path string
		wantStatus       float64
	}{
		{name: "caller's ID", sent: "trace-from-client-42", path: "/v1/categories", wantStatus: 200},
		{name: "generated ID", sent: "", path: "/v1/categories", wantStatus: 200},
		{name: "error response", sent: "trace-404", path: "/nope", wantStatus: 404},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			headers := map[string]string{}
			if tt.sent != "" {
				headers["X-Request-ID"] = tt.sent
			}
			id := s.do(t, http.MethodGet, tt.path, headers).Header.Get("X-Request-ID")

			// The access log line is written after the response is sent.
			var line map[string]any
			eventually(t, 2*time.Second, func() bool {
				for _, l := range s.logs.jsonLines() {
					if l["msg"] == "http request" && l["request_id"] == id {
						line = l
						return true
					}
				}
				return false
			}, "no access log line with request_id %q; logs:\n%s", id, s.logs.String())

			if line["path"] != tt.path || line["status"] != tt.wantStatus || line["method"] != http.MethodGet {
				t.Errorf("access log line = %v, want GET %s %v", line, tt.path, tt.wantStatus)
			}
		})
	}
}

// TestCORS checks the CORS policy from APP_CORS_ALLOWED_ORIGINS on the real
// router: listed origins get the CORS headers (preflight, simple requests and
// error responses), any other origin gets none, and an empty list denies
// every origin.
func TestCORS(t *testing.T) {
	const (
		web   = "http://localhost:5173"
		admin = "https://admin.example.com"
		evil  = "https://evil.example.com"
	)
	s := startServer(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": web + ", " + admin})

	preflight := func(t *testing.T, srv *server, origin, path string) response {
		t.Helper()
		return srv.do(t, http.MethodOptions, path, map[string]string{
			"Origin":                         origin,
			"Access-Control-Request-Method":  http.MethodGet,
			"Access-Control-Request-Headers": "X-Request-ID, Content-Type",
		})
	}

	for _, origin := range []string{web, admin} {
		t.Run("preflight from allowed "+origin, func(t *testing.T) {
			resp := preflight(t, s, origin, "/v1/categories")
			if resp.Status != http.StatusOK && resp.Status != http.StatusNoContent {
				t.Fatalf("preflight status = %d, want 200 or 204: %s", resp.Status, resp.Body)
			}
			h := resp.Header
			if got := h.Get("Access-Control-Allow-Origin"); got != origin {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, origin)
			}
			if got := h.Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodGet) {
				t.Errorf("Access-Control-Allow-Methods = %q, want it to include GET", got)
			}
			allowHeaders := strings.ToLower(h.Get("Access-Control-Allow-Headers"))
			for _, want := range []string{"x-request-id", "content-type"} {
				if !strings.Contains(allowHeaders, want) {
					t.Errorf("Access-Control-Allow-Headers = %q, want it to include %s", allowHeaders, want)
				}
			}
			if got := h.Get("Access-Control-Max-Age"); got != "300" {
				t.Errorf("Access-Control-Max-Age = %q, want 300", got)
			}
			if got := h.Get("Access-Control-Allow-Credentials"); got != "" {
				t.Errorf("Access-Control-Allow-Credentials = %q, want none", got)
			}
			if !slices.Contains(h.Values("Vary"), "Origin") {
				t.Errorf("Vary = %q, want it to include Origin", h.Values("Vary"))
			}
		})
	}

	t.Run("preflight from a disallowed origin", func(t *testing.T) {
		resp := preflight(t, s, evil, "/v1/categories")
		assertNoCORS(t, resp)
	})

	t.Run("simple request from an allowed origin", func(t *testing.T) {
		resp := s.do(t, http.MethodGet, "/v1/categories", map[string]string{"Origin": web})
		if resp.Status != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.Status)
		}
		if got := resp.Header.Get("Access-Control-Allow-Origin"); got != web {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, web)
		}
		// The browser only lets the client read the headers it is told
		// it may (exposedHeaders).
		assertExposes(t, resp, exposedHeaders...)
	})

	t.Run("error response to an allowed origin carries CORS headers", func(t *testing.T) {
		resp := s.do(t, http.MethodGet, "/v1/does-not-exist", map[string]string{"Origin": admin})
		if resp.Status != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", resp.Status)
		}
		if got := resp.Header.Get("Access-Control-Allow-Origin"); got != admin {
			t.Errorf("Access-Control-Allow-Origin = %q, want %q so the browser can read the error", got, admin)
		}
	})

	t.Run("simple request from a disallowed origin", func(t *testing.T) {
		resp := s.do(t, http.MethodGet, "/v1/categories", map[string]string{"Origin": evil})
		// CORS is enforced by the browser: the server still answers, but
		// without the headers that would let a page read the response.
		if resp.Status != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.Status)
		}
		assertNoCORS(t, resp)
	})

	t.Run("an origin that only shares a prefix is refused", func(t *testing.T) {
		assertNoCORS(t, preflight(t, s, web+".evil.example.com", "/v1/categories"))
		assertNoCORS(t, preflight(t, s, "http://localhost:5174", "/v1/categories"))
		assertNoCORS(t, preflight(t, s, "https://localhost:5173", "/v1/categories"))
	})

	t.Run("empty list denies every origin", func(t *testing.T) {
		closed := startServer(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": ""})
		assertNoCORS(t, preflight(t, closed, web, "/v1/categories"))
		resp := closed.do(t, http.MethodGet, "/v1/categories", map[string]string{"Origin": web})
		if resp.Status != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.Status)
		}
		assertNoCORS(t, resp)
	})
}

// TestHead checks that HEAD works wherever GET does, through the whole chain:
// the same status, headers and Content-Type as GET, and no body. Unknown
// routes answer HEAD with the same bodiless 404.
func TestHead(t *testing.T) {
	const (
		web  = "http://localhost:5173"
		evil = "https://evil.example.com"
	)
	s := startServer(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": web})

	tests := []struct {
		path       string
		wantStatus int
	}{
		{"/v1/categories", http.StatusOK},
		{"/healthz", http.StatusOK},
		{"/readyz", http.StatusOK},
		{"/does-not-exist", http.StatusNotFound},
		{"/v1/products", http.StatusOK},
		{"/v1/products/no-such-product", http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			get := s.get(t, tt.path)
			head := s.do(t, http.MethodHead, tt.path, nil)

			if get.Status != tt.wantStatus || head.Status != tt.wantStatus {
				t.Fatalf("GET = %d, HEAD = %d, want both %d", get.Status, head.Status, tt.wantStatus)
			}
			if len(head.Body) != 0 {
				t.Errorf("HEAD body = %q, want empty", head.Body)
			}
			if got, want := head.Header.Get("Content-Type"), get.Header.Get("Content-Type"); got != want || got == "" {
				t.Errorf("HEAD Content-Type = %q, want GET's %q", got, want)
			}
			if id := head.Header.Get("X-Request-ID"); !generatedRequestID.MatchString(id) {
				t.Errorf("HEAD X-Request-ID = %q, want a generated ID", id)
			}
			if _, has := head.Header["Allow"]; has {
				t.Errorf("HEAD answered with Allow %q, as if it were a 405", head.Header.Get("Allow"))
			}
		})
	}

	t.Run("caller's request ID is echoed", func(t *testing.T) {
		resp := s.do(t, http.MethodHead, "/v1/categories", map[string]string{"X-Request-ID": "head-check-1"})
		if resp.Status != http.StatusOK {
			t.Fatalf("HEAD /v1/categories = %d, want 200", resp.Status)
		}
		if got := resp.Header.Get("X-Request-ID"); got != "head-check-1" {
			t.Errorf("X-Request-ID = %q, want the caller's value echoed", got)
		}
	})

	// HEAD is a CORS-safelisted method: browsers send it cross-origin
	// without a preflight, so the CORS policy must cover it like GET.
	for _, path := range []string{"/v1/categories", "/healthz"} {
		t.Run("cross-origin from an allowed origin "+path, func(t *testing.T) {
			resp := s.do(t, http.MethodHead, path, map[string]string{"Origin": web})
			if resp.Status != http.StatusOK || len(resp.Body) != 0 {
				t.Fatalf("HEAD %s = %d with %d body bytes, want 200 and no body", path, resp.Status, len(resp.Body))
			}
			if got := resp.Header.Get("Access-Control-Allow-Origin"); got != web {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, web)
			}
			if !slices.Contains(resp.Header.Values("Vary"), "Origin") {
				t.Errorf("Vary = %q, want it to include Origin", resp.Header.Values("Vary"))
			}
		})

		t.Run("cross-origin from a disallowed origin "+path, func(t *testing.T) {
			resp := s.do(t, http.MethodHead, path, map[string]string{"Origin": evil})
			if resp.Status != http.StatusOK {
				t.Fatalf("HEAD %s = %d, want 200", path, resp.Status)
			}
			assertNoCORS(t, resp)
		})
	}
}

// assertNoCORS fails if resp carries any header that grants cross-origin access.
func assertNoCORS(t *testing.T, resp response) {
	t.Helper()
	for _, h := range []string{
		"Access-Control-Allow-Origin", "Access-Control-Allow-Methods",
		"Access-Control-Allow-Headers", "Access-Control-Expose-Headers",
		"Access-Control-Allow-Credentials",
	} {
		if v := resp.Header.Get(h); v != "" {
			t.Errorf("%s = %q, want no CORS header for a disallowed origin", h, v)
		}
	}
}

func ptr[T any](v T) *T { return &v }

// exposedHeaders is every header a browser script may read on a
// cross-origin response: the request ID, Retry-After of a 429, Location of
// a 201, and since Bab 5 the token of a new guest cart and whether a
// checkout was replayed (ADR 0006).
var exposedHeaders = []string{"X-Request-ID", "Retry-After", "Location", "X-Cart-Token", "Idempotency-Replayed"}

// assertExposes fails unless Access-Control-Expose-Headers on resp lists
// exactly names, in any order and case.
func assertExposes(t *testing.T, resp response, names ...string) {
	t.Helper()
	var got []string
	for _, v := range resp.Header.Values("Access-Control-Expose-Headers") {
		for h := range strings.SplitSeq(v, ",") {
			if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
				got = append(got, h)
			}
		}
	}
	want := make([]string, 0, len(names))
	for _, n := range names {
		want = append(want, strings.ToLower(n))
	}
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Errorf("Access-Control-Expose-Headers = %q, want %v", resp.Header.Values("Access-Control-Expose-Headers"), names)
	}
}
