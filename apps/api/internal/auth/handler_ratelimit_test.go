package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// Retry-After is whole seconds, rounded up, and at least 1: "0" would tell
// a client to retry at once.
func TestHandler_RetryAfter(t *testing.T) {
	tests := []struct {
		retry time.Duration
		want  string
	}{
		{retry: 0, want: "1"},
		{retry: time.Nanosecond, want: "1"},
		{retry: 999 * time.Millisecond, want: "1"},
		{retry: time.Second, want: "1"},
		{retry: time.Second + time.Millisecond, want: "2"},
		{retry: 90 * time.Second, want: "90"},
		{retry: 15*time.Minute - time.Millisecond, want: "900"},
	}
	for _, tt := range tests {
		t.Run(tt.retry.String(), func(t *testing.T) {
			env := newHandlerEnv(0)
			env.limiter.refuse = map[string]time.Duration{"register-ip": tt.retry}
			rec := do(env.h.Register, context.Background(), `{}`)
			body := assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
			testx.AssertEqual(t, rec.Header().Get("Retry-After"), tt.want)
			testx.AssertEqual(t, body.Error.Message, "too many attempts; try again later")
			testx.AssertEqual(t, body.Error.Details["retry_after_seconds"], any(mustFloat(tt.want)))
		})
	}
}

// A limit that cannot be checked is not skipped: 500, and the request goes
// no further.
func TestHandler_LimiterFailureIsNotSkipped(t *testing.T) {
	handlers := map[string]func(*Handler) http.HandlerFunc{
		"register": func(h *Handler) http.HandlerFunc { return h.Register },
		"login":    func(h *Handler) http.HandlerFunc { return h.Login },
		"refresh":  func(h *Handler) http.HandlerFunc { return h.Refresh },
		"verify":   func(h *Handler) http.HandlerFunc { return h.VerifyEmail },
		"resend":   func(h *Handler) http.HandlerFunc { return h.ResendVerification },
		"forgot":   func(h *Handler) http.HandlerFunc { return h.ForgotPassword },
		"reset":    func(h *Handler) http.HandlerFunc { return h.ResetPassword },
		"google":   func(h *Handler) http.HandlerFunc { return h.GoogleLogin },
	}
	for name, fn := range handlers {
		t.Run(name, func(t *testing.T) {
			env := newHandlerEnv(0)
			env.limiter.err = errBoom
			body := `{"email":"budi@example.com","password":"kopi susu gula aren"}`
			if name == "forgot" { // decoded before counting, so it must decode
				body = `{"email":"budi@example.com"}`
			}
			rec := do(fn(env.h), ctxAs(id1), body)
			assertError(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
			testx.AssertEqual(t, rec.Header().Get("Retry-After"), "")
			testx.AssertEqual(t, len(env.svc.called), 0)
		})
	}
	t.Run("the second check failing stops it too", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.limiter.err, env.limiter.errOnLimit = errBoom, "login-email"
		rec := do(env.h.Login, context.Background(), `{"email":"budi@example.com","password":"x"}`)
		assertError(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
		testx.AssertEqual(t, len(env.svc.called), 0)
	})
}

// The per-IP key is httpapi.ClientIP with the configured trusted hops.
func TestHandler_ClientIPKey(t *testing.T) {
	tests := []struct {
		hops int
		xff  string
		want string
	}{
		{hops: 0, xff: "198.51.100.9", want: "203.0.113.7"}, // header ignored
		{hops: 1, xff: "1.1.1.1, 198.51.100.9", want: "198.51.100.9"},
		{hops: 2, xff: "1.1.1.1, 198.51.100.9", want: "1.1.1.1"},
		{hops: 1, xff: "", want: "203.0.113.7"},
	}
	for _, tt := range tests {
		env := newHandlerEnv(tt.hops)
		env.svc.verifyEmail = func(string) error { return nil }
		r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/auth/verify-email", strings.NewReader(`{"token":"x"}`))
		r.RemoteAddr = "203.0.113.7:4321"
		if tt.xff != "" {
			r.Header.Set("X-Forwarded-For", tt.xff)
		}
		rec := httptest.NewRecorder()
		env.h.VerifyEmail(rec, r)
		testx.AssertEqual(t, rec.Code, http.StatusNoContent)
		testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "verify-email-ip:"+tt.want, "hops %d xff %q", tt.hops, tt.xff)
	}
}

func mustFloat(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		panic(err)
	}
	return f
}
