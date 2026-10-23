package httpserver_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// newRouter builds the router with a few test routes and returns it with the
// buffer its JSON logger writes to.
func newRouter(t *testing.T, origins []string, timeout time.Duration) (http.Handler, *bytes.Buffer) {
	t.Helper()
	var logs bytes.Buffer
	h := httpserver.NewRouter(httpserver.Options{
		Logger:         logging.New(&logs, false, "debug"),
		AllowedOrigins: origins,
		RequestTimeout: timeout,
		Probes: func(r chi.Router) {
			r.Get("/probe", markDeadline)
			// Slower than any timeout used here, yet never cut short.
			r.Get("/probe-slow", func(w http.ResponseWriter, r *http.Request) {
				time.Sleep(3 * timeout)
				markDeadline(w, r)
			})
		},
	}, func(r chi.Router) {
		r.Get("/deadline", markDeadline)
		r.Get("/ok", func(w http.ResponseWriter, r *http.Request) {
			// Handlers get a logger that already carries the request ID.
			logx.FromContext(r.Context()).Info("handler ran")
			_, _ = w.Write([]byte("ok"))
		})
		r.Get("/panic", func(http.ResponseWriter, *http.Request) { panic("boom") })
		r.Get("/slow", func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
		r.Route("/v1", func(r chi.Router) {
			r.Get("/items", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
			r.Post("/items", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
		})
	})
	return h, &logs
}

// markDeadline answers 200 with X-Has-Deadline telling whether the handler's
// context has a deadline, i.e. whether it runs under the timeout middleware.
func markDeadline(w http.ResponseWriter, r *http.Request) {
	_, ok := r.Context().Deadline()
	w.Header().Set("X-Has-Deadline", strconv.FormatBool(ok))
	_, _ = w.Write([]byte("ok"))
}

func do(h http.Handler, method, path string, header map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(context.Background(), method, path, nil)
	for k, v := range header {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) errorBody {
	t.Helper()
	testx.AssertEqual(t, rec.Header().Get("Content-Type"), "application/json; charset=utf-8")
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

func logLines(t *testing.T, logs *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(logs.String()), "\n") {
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		out = append(out, m)
	}
	return out
}

var generatedID = regexp.MustCompile(`^[0-9a-f]{32}$`)

func TestRouter_RequestID(t *testing.T) {
	tests := []struct {
		name     string
		incoming string
		wantEcho bool
	}{
		{name: "client id is echoed", incoming: "client-abc.123", wantEcho: true},
		{name: "missing id is generated", incoming: ""},
		{name: "unsafe id is replaced", incoming: "bad id\twith spaces"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, logs := newRouter(t, nil, time.Second)
			hdr := map[string]string{}
			if tt.incoming != "" {
				hdr["X-Request-ID"] = tt.incoming
			}
			rec := do(h, http.MethodGet, "/ok", hdr)

			testx.AssertEqual(t, rec.Code, http.StatusOK)
			id := rec.Header().Get("X-Request-ID")
			if tt.wantEcho {
				testx.AssertEqual(t, id, tt.incoming)
			} else {
				testx.AssertTrue(t, generatedID.MatchString(id), "generated id %q", id)
			}

			// Both the handler's line and the access log carry the same id.
			lines := logLines(t, logs)
			if len(lines) != 2 {
				t.Fatalf("want handler line + access log, got %d lines: %s", len(lines), logs.String())
			}
			testx.AssertEqual(t, lines[0]["msg"], any("handler ran"))
			testx.AssertEqual(t, lines[0]["request_id"], any(id))
			testx.AssertEqual(t, lines[1]["msg"], any("http request"))
			testx.AssertEqual(t, lines[1]["request_id"], any(id))
			testx.AssertEqual(t, lines[1]["status"], any(float64(200)))
		})
	}
}

func TestRouter_PanicBecomes500(t *testing.T) {
	h, logs := newRouter(t, nil, time.Second)
	rec := do(h, http.MethodGet, "/panic", map[string]string{"X-Request-ID": "req-panic"})

	testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
	body := decodeError(t, rec)
	testx.AssertEqual(t, body.Error.Code, "INTERNAL_ERROR")
	testx.AssertEqual(t, body.Error.Message, "internal server error")
	testx.AssertEqual(t, rec.Header().Get("X-Request-ID"), "req-panic", "a panicking request still gets its id")

	// Recovery logs the panic; the access log, outside it, records the 500.
	var sawPanic, sawAccess bool
	for _, l := range logLines(t, logs) {
		switch l["msg"] {
		case "panic recovered":
			sawPanic = true
			testx.AssertEqual(t, l["error"], any("boom"))
		case "http request":
			sawAccess = true
			testx.AssertEqual(t, l["status"], any(float64(500)))
		}
	}
	testx.AssertTrue(t, sawPanic, "panic is logged")
	testx.AssertTrue(t, sawAccess, "panicking request is in the access log")
}

func TestRouter_NotFoundAndMethodNotAllowed(t *testing.T) {
	tests := []struct {
		name        string
		method      string
		path        string
		wantStatus  int
		wantCode    string
		wantMessage string
		wantAllow   string
	}{
		{name: "unknown route", method: http.MethodGet, path: "/nope", wantStatus: 404, wantCode: "NOT_FOUND", wantMessage: "route not found"},
		{name: "unknown route in a sub-router", method: http.MethodGet, path: "/v1/nope", wantStatus: 404, wantCode: "NOT_FOUND", wantMessage: "route not found"},
		{name: "wrong method", method: http.MethodDelete, path: "/ok", wantStatus: 405, wantCode: "METHOD_NOT_ALLOWED", wantMessage: "method not allowed", wantAllow: "GET, HEAD"},
		{name: "wrong method in a sub-router lists every allowed one", method: http.MethodPut, path: "/v1/items", wantStatus: 405, wantCode: "METHOD_NOT_ALLOWED", wantMessage: "method not allowed", wantAllow: "GET, HEAD, POST"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, _ := newRouter(t, nil, time.Second)
			rec := do(h, tt.method, tt.path, nil)

			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			testx.AssertEqual(t, body.Error.Message, tt.wantMessage)
			testx.AssertEqual(t, rec.Header().Get("Allow"), tt.wantAllow)
			testx.AssertTrue(t, rec.Header().Get("X-Request-ID") != "", "error responses carry the request id")
		})
	}
}

func TestRouter_Timeout(t *testing.T) {
	h, _ := newRouter(t, nil, 20*time.Millisecond)
	rec := do(h, http.MethodGet, "/slow", nil)

	testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable)
	body := decodeError(t, rec)
	testx.AssertEqual(t, body.Error.Code, "TIMEOUT")
}

func TestRouter_CORS(t *testing.T) {
	const allowed = "https://shop.example.com"
	tests := []struct {
		name        string
		origins     []string
		method      string
		path        string
		header      map[string]string
		wantStatus  int
		wantOrigin  string
		wantExposed string
		wantMethods string
	}{
		{
			name:        "allowed origin on a request",
			origins:     []string{allowed},
			method:      http.MethodGet,
			path:        "/ok",
			header:      map[string]string{"Origin": allowed},
			wantStatus:  http.StatusOK,
			wantOrigin:  allowed,
			wantExposed: "X-Request-Id, Retry-After, Location",
		},
		{
			name:        "allowed origin also on an error response",
			origins:     []string{allowed},
			method:      http.MethodGet,
			path:        "/nope",
			header:      map[string]string{"Origin": allowed},
			wantStatus:  http.StatusNotFound,
			wantOrigin:  allowed,
			wantExposed: "X-Request-Id, Retry-After, Location",
		},
		{
			name:        "allowed preflight",
			origins:     []string{allowed},
			method:      http.MethodOptions,
			path:        "/v1/items",
			header:      map[string]string{"Origin": allowed, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type, X-Request-ID"},
			wantStatus:  http.StatusOK,
			wantOrigin:  allowed,
			wantMethods: "POST",
		},
		{
			name:       "other origin is refused",
			origins:    []string{allowed},
			method:     http.MethodGet,
			path:       "/ok",
			header:     map[string]string{"Origin": "https://evil.example.com"},
			wantStatus: http.StatusOK, // the request runs; the browser hides the answer
		},
		{
			name:       "other origin preflight is refused",
			origins:    []string{allowed},
			method:     http.MethodOptions,
			path:       "/v1/items",
			header:     map[string]string{"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"},
			wantStatus: http.StatusOK,
		},
		{
			name:       "empty list denies every origin",
			origins:    nil,
			method:     http.MethodGet,
			path:       "/ok",
			header:     map[string]string{"Origin": allowed},
			wantStatus: http.StatusOK,
		},
		{
			name:       "empty list denies preflight",
			origins:    []string{},
			method:     http.MethodOptions,
			path:       "/v1/items",
			header:     map[string]string{"Origin": allowed, "Access-Control-Request-Method": "GET"},
			wantStatus: http.StatusOK,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, _ := newRouter(t, tt.origins, time.Second)
			rec := do(h, tt.method, tt.path, tt.header)

			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			testx.AssertEqual(t, rec.Header().Get("Access-Control-Allow-Origin"), tt.wantOrigin)
			testx.AssertEqual(t, rec.Header().Get("Access-Control-Expose-Headers"), tt.wantExposed)
			testx.AssertEqual(t, rec.Header().Get("Access-Control-Allow-Methods"), tt.wantMethods)
		})
	}
}

// Probes get every middleware except the request timeout; API routes get it.
func TestRouter_ProbesRunWithoutTimeout(t *testing.T) {
	const timeout = 20 * time.Millisecond
	tests := []struct {
		name         string
		path         string
		wantDeadline string
	}{
		{name: "api route has a deadline", path: "/deadline", wantDeadline: "true"},
		{name: "probe has none", path: "/probe", wantDeadline: "false"},
		{name: "slow probe is not turned into 503 TIMEOUT", path: "/probe-slow", wantDeadline: "false"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, _ := newRouter(t, nil, timeout)
			rec := do(h, http.MethodGet, tt.path, nil)

			testx.AssertEqual(t, rec.Code, http.StatusOK)
			testx.AssertEqual(t, rec.Header().Get("X-Has-Deadline"), tt.wantDeadline)
			testx.AssertTrue(t, rec.Header().Get("X-Request-ID") != "", "probes still get the request id")
		})
	}
}

// HEAD runs the GET handler, and net/http sends no body. A real server is
// used because httptest.ResponseRecorder keeps whatever the handler wrote.
func TestRouter_Head(t *testing.T) {
	h, _ := newRouter(t, nil, time.Second)
	srv := httptest.NewServer(h)
	defer srv.Close()

	tests := []struct {
		path       string
		wantStatus int
	}{
		{path: "/ok", wantStatus: http.StatusOK},
		{path: "/v1/items", wantStatus: http.StatusOK},
		{path: "/probe", wantStatus: http.StatusOK},
		{path: "/nope", wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			req, err := http.NewRequestWithContext(context.Background(), http.MethodHead, srv.URL+tt.path, nil)
			if err != nil {
				t.Fatalf("new request: %v", err)
			}
			resp, err := srv.Client().Do(req)
			if err != nil {
				t.Fatalf("HEAD %s: %v", tt.path, err)
			}
			body, err := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, resp.StatusCode, tt.wantStatus)
			testx.AssertEqual(t, len(body), 0, "HEAD response has no body")
			testx.AssertTrue(t, resp.Header.Get("X-Request-ID") != "", "HEAD gets the full middleware chain")
		})
	}
}
