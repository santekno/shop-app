package adminevents_test

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/adminevents"
	"github.com/santekno/shop-app/apps/api/internal/auth"
)

// controlledWriter is a ResponseWriter whose deadlines, writes and flushes
// fail as the test says; http.ResponseController finds its methods.
type controlledWriter struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	writes   int
	failFrom int // the first Write that fails (1-based); 0 never
	writeErr error

	readDeadlineErr  error
	writeDeadlineErr error
	flushErr         error
}

func newControlledWriter() *controlledWriter { return &controlledWriter{header: http.Header{}} }

func (w *controlledWriter) Header() http.Header { return w.header }
func (w *controlledWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *controlledWriter) Write(p []byte) (int, error) {
	w.WriteHeader(http.StatusOK)
	w.writes++
	if w.failFrom > 0 && w.writes >= w.failFrom {
		return 0, w.writeErr
	}
	n, _ := w.body.Write(p) // bytes.Buffer.Write never fails
	return n, nil
}

func (w *controlledWriter) FlushError() error                { return w.flushErr }
func (w *controlledWriter) SetReadDeadline(time.Time) error  { return w.readDeadlineErr }
func (w *controlledWriter) SetWriteDeadline(time.Time) error { return w.writeDeadlineErr }

// serveDirect runs the stream for userA on w, behind the guard, and fails
// the test if it does not return: every case here must end on its own.
func serveDirect(t *testing.T, h *adminevents.Handler, w http.ResponseWriter) {
	t.Helper()
	tokens := auth.NewAccessTokens(testSecret, 15*time.Minute, nil)
	env := &streamEnv{tokens: tokens}
	bearer, _ := env.token(t, userA)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/admin/events", nil)
	req.Header.Set("Authorization", bearer)
	done := make(chan struct{})
	go func() {
		defer close(done)
		auth.NewGuard(tokens, noRevocations{}).Authenticate(http.HandlerFunc(h.Stream)).ServeHTTP(w, req)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Stream did not return")
	}
}

var errBroken = errors.New("broken pipe")

func TestStream_WriterFailures(t *testing.T) {
	tests := []struct {
		name       string
		w          func() *controlledWriter
		heartbeat  time.Duration
		wantStatus int
		wantBody   string
	}{
		{
			name: "the read deadline cannot be lifted",
			w: func() *controlledWriter {
				w := newControlledWriter()
				w.readDeadlineErr = errBroken
				return w
			},
			wantStatus: http.StatusInternalServerError, wantBody: `"code":"INTERNAL_ERROR"`,
		},
		{
			name: "the write deadline cannot be set",
			w: func() *controlledWriter {
				w := newControlledWriter()
				w.writeDeadlineErr = errBroken
				return w
			},
			wantStatus: http.StatusOK, wantBody: "",
		},
		{
			name: "the first write fails",
			w: func() *controlledWriter {
				w := newControlledWriter()
				w.failFrom, w.writeErr = 1, errBroken
				return w
			},
			wantStatus: http.StatusOK, wantBody: "",
		},
		{
			name: "the first flush fails",
			w: func() *controlledWriter {
				w := newControlledWriter()
				w.flushErr = errBroken
				return w
			},
			wantStatus: http.StatusOK, wantBody: ": connected\n\n",
		},
		{
			name: "a heartbeat write fails",
			w: func() *controlledWriter {
				w := newControlledWriter()
				w.failFrom, w.writeErr = 2, errBroken
				return w
			},
			heartbeat:  time.Millisecond,
			wantStatus: http.StatusOK, wantBody: ": connected\n\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sub := &fakeSubscriber{}
			heartbeat := tt.heartbeat
			if heartbeat == 0 {
				heartbeat = noBeat
			}
			h := adminevents.NewHandler(sub, time.Now).WithHeartbeat(heartbeat)
			w := tt.w()
			serveDirect(t, h, w)

			testx.AssertEqual(t, w.status, tt.wantStatus)
			if tt.wantStatus == http.StatusOK {
				testx.AssertEqual(t, w.body.String(), tt.wantBody)
			} else {
				testx.AssertContains(t, w.body.String(), tt.wantBody)
			}
			testx.AssertEqual(t, sub.count(), 1)
			sub.last().waitClosed(t)
		})
	}
}

// Deadlines a writer does not support (http.ErrNotSupported) are no
// reason to fail: the stream runs, here until Shutdown ends it.
func TestStream_DeadlinesNotSupported(t *testing.T) {
	sub := &fakeSubscriber{}
	h := adminevents.NewHandler(sub, time.Now).WithHeartbeat(noBeat)
	h.Shutdown()
	w := newControlledWriter()
	w.readDeadlineErr, w.writeDeadlineErr = http.ErrNotSupported, http.ErrNotSupported
	serveDirect(t, h, w)

	testx.AssertEqual(t, w.status, http.StatusOK)
	testx.AssertEqual(t, w.body.String(), ": connected\n\nevent: end\ndata: {\"reason\":\"shutdown\"}\n\n")
}

// Mounted without the guard, the handler fails closed.
func TestStream_WithoutTheGuard(t *testing.T) {
	sub := &fakeSubscriber{}
	h := adminevents.NewHandler(sub, time.Now)
	rec := httptest.NewRecorder()
	h.Stream(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/admin/events", nil))

	testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
	testx.AssertContains(t, rec.Body.String(), `"code":"UNAUTHORIZED"`)
	testx.AssertContains(t, rec.Body.String(), "missing access token")
	testx.AssertEqual(t, sub.count(), 0)
}
