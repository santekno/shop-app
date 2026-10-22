package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// setEnv clears every APP_* variable and PORT for the test, then sets vars.
func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	names := []string{"PORT"}
	for _, kv := range os.Environ() {
		if name, _, _ := strings.Cut(kv, "="); strings.HasPrefix(name, "APP_") {
			names = append(names, name)
		}
	}
	for _, name := range names {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}

func testConfig(env string) config.Config {
	return config.Config{
		Env:             env,
		LogLevel:        "info",
		RequestTimeout:  time.Second,
		ShutdownTimeout: time.Second,
	}
}

func TestApp_Handler(t *testing.T) {
	a := app.New(testConfig(config.EnvDevelopment), logx.Noop())
	h := a.Handler()

	tests := []struct {
		path       string
		wantStatus int
		check      func(t *testing.T, body []byte)
	}{
		{
			path:       "/v1/categories",
			wantStatus: http.StatusOK,
			check: func(t *testing.T, body []byte) {
				var resp struct {
					Data []struct {
						Slug     string  `json:"slug"`
						ParentID *string `json:"parent_id"`
					} `json:"data"`
				}
				if err := json.Unmarshal(body, &resp); err != nil {
					t.Fatalf("decode: %v", err)
				}
				testx.AssertEqual(t, len(resp.Data), 13, "seeded categories")
				if len(resp.Data) > 0 {
					testx.AssertEqual(t, resp.Data[0].Slug, "elektronik", "sorted by the service")
					testx.AssertTrue(t, resp.Data[0].ParentID == nil)
				}
			},
		},
		{path: "/healthz", wantStatus: http.StatusOK},
		{path: "/readyz", wantStatus: http.StatusOK},
		{path: "/categories", wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, tt.path, nil))
			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			testx.AssertTrue(t, rec.Header().Get("X-Request-ID") != "", "the full middleware chain is wired")
			if tt.check != nil {
				tt.check(t, rec.Body.Bytes())
			}
		})
	}
	testx.AssertTrue(t, a.Ready())
}

// HEAD works on the API and on the probes, with an empty body. It goes
// through a real server: httptest.ResponseRecorder would keep the GET body.
func TestApp_Head(t *testing.T) {
	srv := httptest.NewServer(app.New(testConfig(config.EnvDevelopment), logx.Noop()).Handler())
	defer srv.Close()

	for _, path := range []string{"/v1/categories", "/healthz", "/readyz"} {
		t.Run(path, func(t *testing.T) {
			req, err := http.NewRequestWithContext(context.Background(), http.MethodHead, srv.URL+path, nil)
			if err != nil {
				t.Fatalf("new request: %v", err)
			}
			resp, err := srv.Client().Do(req)
			if err != nil {
				t.Fatalf("HEAD %s: %v", path, err)
			}
			body, err := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, resp.StatusCode, http.StatusOK)
			testx.AssertEqual(t, len(body), 0, "HEAD response has no body")
			testx.AssertContains(t, resp.Header.Get("Content-Type"), "application/json")
		})
	}
}

func TestApp_ServeDrainsReadiness(t *testing.T) {
	tests := []struct {
		env         string
		wantErrText bool // /readyz shows the check's error text
	}{
		{env: config.EnvDevelopment, wantErrText: true},
		{env: config.EnvProduction, wantErrText: false},
	}
	for _, tt := range tests {
		t.Run(tt.env, func(t *testing.T) {
			var logs bytes.Buffer
			a := app.New(testConfig(tt.env), logx.New(logx.WithOutput(&logs), logx.WithFormat("json")))
			var lc net.ListenConfig
			ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatalf("listen: %v", err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- a.Serve(ctx, ln) }()

			port := ln.Addr().(*net.TCPAddr).Port
			waitHealthy(t, port)
			testx.AssertTrue(t, a.Ready(), "ready while serving")

			cancel()
			select {
			case err := <-done:
				testx.AssertNoError(t, err)
			case <-time.After(5 * time.Second):
				t.Fatal("Serve did not return after cancel")
			}

			testx.AssertFalse(t, a.Ready(), "readiness flipped by shutdown")
			rec := httptest.NewRecorder()
			a.Handler().ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/readyz", nil))
			testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable)
			testx.AssertEqual(t, strings.Contains(rec.Body.String(), "shutting down"), tt.wantErrText, "body %s", rec.Body.String())
			testx.AssertContains(t, logs.String(), `"msg":"api listening"`)
			testx.AssertContains(t, logs.String(), `"addr":"`+ln.Addr().String()+`"`)
		})
	}
}

// waitHealthy polls Probe until the API on port answers, or fails the test.
func waitHealthy(t *testing.T, port int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := app.Probe(context.Background(), port)
		if err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("API on port %d never became healthy: %v", port, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// syncBuffer is a bytes.Buffer safe to read while Run writes logs to it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n, _ := b.buf.Write(p) // bytes.Buffer.Write never fails
	return n, nil
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestRun_Serves(t *testing.T) {
	port := freePort(t)
	setEnv(t, map[string]string{"APP_ENV": "production", "PORT": strconv.Itoa(port)})
	var out syncBuffer
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx, nil, &out) }()

	waitHealthy(t, port)
	cancel()
	select {
	case err := <-done:
		testx.AssertNoError(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after cancel")
	}

	// Production logs are JSON, tagged with service and env.
	first, _, _ := strings.Cut(out.String(), "\n")
	var line map[string]any
	if err := json.Unmarshal([]byte(first), &line); err != nil {
		t.Fatalf("first log line %q is not JSON: %v", first, err)
	}
	testx.AssertEqual(t, line["msg"], any("api listening"))
	testx.AssertEqual(t, line["service"], any("api"))
	testx.AssertEqual(t, line["env"], any("production"))
	testx.AssertContains(t, out.String(), `"msg":"shutdown complete"`)
}

func TestRun_Healthcheck(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		wantErr string
	}{
		{name: "healthy", status: http.StatusOK},
		{name: "unhealthy", status: http.StatusServiceUnavailable, wantErr: "answered 503"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
			}))
			defer srv.Close()
			setEnv(t, map[string]string{"APP_ENV": "production", "PORT": strconv.Itoa(portOf(t, srv))})
			var out bytes.Buffer

			err := app.Run(context.Background(), []string{"healthcheck"}, &out)

			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
			} else {
				if err == nil {
					t.Fatalf("Run: want error containing %q, got nil", tt.wantErr)
				}
				testx.AssertContains(t, err.Error(), tt.wantErr)
			}
			testx.AssertEqual(t, out.Len(), 0, "the probe does not start the API or log")
		})
	}
}

func TestRun_Errors(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		args    []string
		wantErr string
	}{
		{
			name:    "config error comes first, even with bad arguments",
			env:     map[string]string{},
			args:    []string{"bogus"},
			wantErr: "config: ",
		},
		{
			name:    "invalid config names the variable",
			env:     map[string]string{"APP_ENV": "production", "PORT": "99999"},
			args:    nil,
			wantErr: "PORT: must be a number between 1 and 65535",
		},
		{
			name:    "unknown argument",
			env:     map[string]string{"APP_ENV": "production"},
			args:    []string{"serve"},
			wantErr: `unknown arguments ["serve"] (usage: api [healthcheck])`,
		},
		{
			name:    "healthcheck with extra arguments",
			env:     map[string]string{"APP_ENV": "production"},
			args:    []string{"healthcheck", "now"},
			wantErr: `unknown arguments ["healthcheck" "now"]`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setEnv(t, tt.env)
			var out bytes.Buffer
			err := app.Run(context.Background(), tt.args, &out)
			if err == nil {
				t.Fatalf("Run: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertEqual(t, out.Len(), 0, "nothing starts before the error")
		})
	}
}

func TestRun_ListenError(t *testing.T) {
	var lc net.ListenConfig
	busy, err := lc.Listen(context.Background(), "tcp", ":0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = busy.Close() }()
	port := busy.Addr().(*net.TCPAddr).Port
	setEnv(t, map[string]string{"APP_ENV": "production", "PORT": strconv.Itoa(port)})

	err = app.Run(context.Background(), nil, &bytes.Buffer{})

	if err == nil {
		t.Fatal("Run: want listen error, got nil")
	}
	testx.AssertContains(t, err.Error(), "listen on :"+strconv.Itoa(port)+": ")
}
