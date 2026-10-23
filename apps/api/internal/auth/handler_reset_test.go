package auth

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestHandler_ForgotPassword(t *testing.T) {
	t.Run("202, counted per IP then per email", func(t *testing.T) {
		env := newHandlerEnv(0)
		var got string
		env.svc.forgotPassword = func(email string) error { got = email; return nil }
		rec := do(env.h.ForgotPassword, context.Background(), `{"email":"Budi@example.com"}`)
		testx.AssertEqual(t, rec.Code, http.StatusAccepted, "body %s", rec.Body.String())
		testx.AssertEqual(t, rec.Body.Len(), 0)
		testx.AssertEqual(t, got, "Budi@example.com")
		testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","),
			"forgot-ip:203.0.113.7,forgot-email:"+EmailKey("budi@example.com"))
	})
	t.Run("an undecodable body is not counted", func(t *testing.T) {
		env := newHandlerEnv(0)
		rec := do(env.h.ForgotPassword, context.Background(), `{`)
		assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertEqual(t, len(env.limiter.seen()), 0)
	})
	t.Run("counted before validation", func(t *testing.T) {
		env := newHandlerEnv(0)
		rec := do(env.h.ForgotPassword, context.Background(), `{}`)
		body := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertEqual(t, body.Error.Details["email"], any("is required"))
		testx.AssertEqual(t, len(env.limiter.seen()), 2)
		testx.AssertEqual(t, len(env.svc.called), 0)
	})
	t.Run("over the per-email limit", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.limiter.refuse = map[string]time.Duration{"forgot-email": time.Hour}
		rec := do(env.h.ForgotPassword, context.Background(), `{"email":"budi@example.com"}`)
		assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
		testx.AssertEqual(t, rec.Header().Get("Retry-After"), "3600")
		testx.AssertEqual(t, len(env.svc.called), 0)
	})
	t.Run("the lookup fails", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.svc.forgotPassword = func(string) error { return errBoom }
		rec := do(env.h.ForgotPassword, context.Background(), `{"email":"budi@example.com"}`)
		assertError(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
	})
}

func TestHandler_ResetPassword(t *testing.T) {
	env := newHandlerEnv(0)
	var gotToken, gotPassword string
	env.svc.resetPassword = func(token, password string) error { gotToken, gotPassword = token, password; return nil }

	rec := do(env.h.ResetPassword, context.Background(), `{"token":"`+id1+`.s","password":"kopi susu gula aren"}`)

	testx.AssertEqual(t, rec.Code, http.StatusNoContent, "body %s", rec.Body.String())
	testx.AssertEqual(t, gotToken, id1+".s")
	testx.AssertEqual(t, gotPassword, "kopi susu gula aren")
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "reset-ip:203.0.113.7")
}

func TestHandler_ResetPasswordErrors(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		err        error
		wantStatus int
		wantCode   string
		wantDetail map[string]any
	}{
		{name: "policy", body: `{"token":"x","password":"pendek"}`, wantStatus: http.StatusBadRequest,
			wantCode: "VALIDATION_FAILED", wantDetail: map[string]any{"password": "must be between 8 and 128 characters"}},
		{name: "every field at once", body: `{}`, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED",
			wantDetail: map[string]any{"token": "is required", "password": "is required"}},
		{name: "token invalid", body: `{"token":"x","password":"kopi susu gula aren"}`, err: ErrEmailTokenInvalid,
			wantStatus: http.StatusBadRequest, wantCode: CodeTokenInvalid},
		{name: "token expired", body: `{"token":"x","password":"kopi susu gula aren"}`, err: ErrEmailTokenExpired,
			wantStatus: http.StatusBadRequest, wantCode: CodeTokenExpired},
		{name: "database", body: `{"token":"x","password":"kopi susu gula aren"}`, err: errBoom,
			wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
		{name: "bad body", body: `[1]`, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			env.svc.resetPassword = func(string, string) error { return tt.err }
			rec := do(env.h.ResetPassword, context.Background(), tt.body)
			body := assertError(t, rec, tt.wantStatus, tt.wantCode)
			for k, v := range tt.wantDetail {
				testx.AssertEqual(t, body.Error.Details[k], v, "details[%s]", k)
			}
		})
	}
}

func TestHandler_ResetPasswordRateLimitedBeforeDecoding(t *testing.T) {
	env := newHandlerEnv(0)
	env.limiter.refuse = map[string]time.Duration{"reset-ip": time.Minute}
	rec := do(env.h.ResetPassword, context.Background(), `not json`)
	assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
	testx.AssertEqual(t, len(env.svc.called), 0)
}
