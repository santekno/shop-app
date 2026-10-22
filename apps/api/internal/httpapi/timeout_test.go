package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestTimeout_SetsDeadline(t *testing.T) {
	const d = 2 * time.Second
	var deadline time.Time
	var hasDeadline bool
	h := httpapi.Timeout(d)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deadline, hasDeadline = r.Context().Deadline()
		w.WriteHeader(http.StatusNoContent)
	}))

	start := time.Now()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))

	testx.AssertTrue(t, hasDeadline, "handler context has a deadline")
	left := deadline.Sub(start)
	testx.AssertTrue(t, left >= d && left < d+time.Second, "deadline %s away, want about %s", left, d)
	testx.AssertEqual(t, rec.Code, http.StatusNoContent)
}

func TestTimeout(t *testing.T) {
	const d = 20 * time.Millisecond
	tests := []struct {
		name        string
		parentDone  bool // the client went away before the deadline
		handler     http.HandlerFunc
		wantStatus  int
		wantBody    string // exact body, unless wantTimeout
		wantTimeout bool
	}{
		{
			name: "handler past the deadline without writing gets 503 TIMEOUT",
			handler: func(_ http.ResponseWriter, r *http.Request) {
				<-r.Context().Done()
			},
			wantStatus:  http.StatusServiceUnavailable,
			wantTimeout: true,
		},
		{
			name: "handler that wrote before the deadline passed is left alone",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusAccepted)
				<-r.Context().Done()
			},
			wantStatus: http.StatusAccepted,
			wantBody:   "",
		},
		{
			name: "handler that wrote its own error after the deadline is left alone",
			handler: func(w http.ResponseWriter, r *http.Request) {
				<-r.Context().Done()
				w.WriteHeader(http.StatusTeapot)
				_, _ = w.Write([]byte("own answer"))
			},
			wantStatus: http.StatusTeapot,
			wantBody:   "own answer",
		},
		{
			name: "fast handler that wrote nothing gets no 503",
			handler: func(http.ResponseWriter, *http.Request) {
			},
			wantStatus: http.StatusOK, // the recorder's default: nothing was written
			wantBody:   "",
		},
		{
			name:       "cancelled request (not a timeout) gets no 503",
			parentDone: true,
			handler: func(_ http.ResponseWriter, r *http.Request) {
				<-r.Context().Done()
			},
			wantStatus: http.StatusOK,
			wantBody:   "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/categories", nil)
			if tt.parentDone {
				ctx, cancel := context.WithCancel(r.Context())
				cancel()
				r = r.WithContext(ctx)
			}
			rec := httptest.NewRecorder()

			httpapi.Timeout(d)(tt.handler).ServeHTTP(rec, r)

			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			if !tt.wantTimeout {
				testx.AssertEqual(t, rec.Body.String(), tt.wantBody)
				return
			}
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, httpapi.CodeTimeout)
			testx.AssertEqual(t, body.Error.Message, "request timed out")
		})
	}
}
