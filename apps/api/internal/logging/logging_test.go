package logging_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/logging"
)

func TestNew_Format(t *testing.T) {
	tests := []struct {
		name        string
		development bool
	}{
		{name: "development writes text", development: true},
		{name: "elsewhere writes JSON", development: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out bytes.Buffer
			logging.New(&out, tt.development, "info").Info("hello", "port", 8080)

			line := strings.TrimSpace(out.String())
			var m map[string]any
			isJSON := json.Unmarshal([]byte(line), &m) == nil
			testx.AssertEqual(t, isJSON, !tt.development, "line %q", line)
			if tt.development {
				testx.AssertContains(t, line, "level=INFO")
				testx.AssertContains(t, line, "msg=hello")
				testx.AssertContains(t, line, "service=api")
				testx.AssertContains(t, line, "port=8080")
				return
			}
			testx.AssertEqual(t, m["level"], any("INFO"))
			testx.AssertEqual(t, m["msg"], any("hello"))
			testx.AssertEqual(t, m["service"], any("api"))
			testx.AssertEqual(t, m["port"], any(float64(8080)))
		})
	}
}

func TestNew_Level(t *testing.T) {
	tests := []struct {
		level     string
		wantDebug bool
		wantInfo  bool
		wantWarn  bool
	}{
		{level: "debug", wantDebug: true, wantInfo: true, wantWarn: true},
		{level: "info", wantDebug: false, wantInfo: true, wantWarn: true},
		{level: "warn", wantDebug: false, wantInfo: false, wantWarn: true},
		{level: "error", wantDebug: false, wantInfo: false, wantWarn: false},
	}
	for _, tt := range tests {
		t.Run(tt.level, func(t *testing.T) {
			var out bytes.Buffer
			l := logging.New(&out, false, tt.level)
			l.Debug("d")
			l.Info("i")
			l.Warn("w")
			l.Error("e")
			s := out.String()
			testx.AssertEqual(t, strings.Contains(s, `"msg":"d"`), tt.wantDebug)
			testx.AssertEqual(t, strings.Contains(s, `"msg":"i"`), tt.wantInfo)
			testx.AssertEqual(t, strings.Contains(s, `"msg":"w"`), tt.wantWarn)
			testx.AssertContains(t, s, `"msg":"e"`)
		})
	}
}

func TestMiddleware(t *testing.T) {
	tests := []struct {
		name          string
		ctx           func(context.Context) context.Context
		wantRequestID string // "" means the field is absent
		wantUserID    string
	}{
		{
			name:          "request id",
			ctx:           func(ctx context.Context) context.Context { return ctxx.WithRequestID(ctx, "req-42") },
			wantRequestID: "req-42",
		},
		{
			name: "request and user id",
			ctx: func(ctx context.Context) context.Context {
				return ctxx.WithUserID(ctxx.WithRequestID(ctx, "req-43"), "user-7")
			},
			wantRequestID: "req-43",
			wantUserID:    "user-7",
		},
		{
			name: "no ids, no empty fields",
			ctx:  func(ctx context.Context) context.Context { return ctx },
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out bytes.Buffer
			base := logging.New(&out, false, "info")
			called := false
			h := logging.Middleware(base)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				called = true
				logx.FromContext(r.Context()).Info("in handler")
			}))

			r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			h.ServeHTTP(httptest.NewRecorder(), r.WithContext(tt.ctx(r.Context())))

			testx.AssertTrue(t, called, "next handler runs")
			var m map[string]any
			if err := json.Unmarshal(out.Bytes(), &m); err != nil {
				t.Fatalf("decode %q: %v", out.String(), err)
			}
			testx.AssertEqual(t, m["msg"], any("in handler"))
			testx.AssertEqual(t, m["service"], any("api"), "derived from the base logger")
			assertField(t, m, "request_id", tt.wantRequestID)
			assertField(t, m, "user_id", tt.wantUserID)
		})
	}
}

func assertField(t *testing.T, m map[string]any, key, want string) {
	t.Helper()
	got, ok := m[key]
	if want == "" {
		testx.AssertFalse(t, ok, "field %s should be absent, got %v", key, got)
		return
	}
	testx.AssertEqual(t, got, any(want), key)
}
