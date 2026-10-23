package auth

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestHandler_Refresh(t *testing.T) {
	env := newHandlerEnv(0)
	var got string
	env.svc.refresh = func(token string) (Tokens, error) { got = token; return env.testTokens(), nil }

	rec := do(env.h.Refresh, context.Background(), `{"refresh_token":"`+id1+`.old"}`)

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, got, id1+".old")
	body := decodeTokens(t, rec).Data
	testx.AssertEqual(t, body.RefreshToken, id3+".secret")
	testx.AssertEqual(t, body.ExpiresIn, int64(900))
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "refresh-ip:203.0.113.7")
}

func TestHandler_RefreshErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{name: "invalid, revoked or reused", err: ErrRefreshTokenInvalid, wantStatus: http.StatusUnauthorized,
			wantCode: CodeTokenInvalid, wantMsg: "the token is invalid or has been revoked; log in again"},
		{name: "expired", err: ErrRefreshTokenExpired, wantStatus: http.StatusUnauthorized,
			wantCode: CodeTokenExpired, wantMsg: "the token has expired; log in again"},
		{name: "account gone", err: ErrNoUser, wantStatus: http.StatusUnauthorized,
			wantCode: "UNAUTHORIZED", wantMsg: "this account no longer exists"},
		{name: "database", err: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			env.svc.refresh = func(string) (Tokens, error) { return Tokens{}, tt.err }
			rec := do(env.h.Refresh, context.Background(), `{"refresh_token":"x"}`)
			body := assertError(t, rec, tt.wantStatus, tt.wantCode)
			if tt.wantMsg != "" {
				testx.AssertEqual(t, body.Error.Message, tt.wantMsg)
			}
		})
	}
}

func TestHandler_RefreshValidation(t *testing.T) {
	tests := []struct{ name, body, want string }{
		{name: "missing", body: `{}`, want: "is required"},
		{name: "empty", body: `{"refresh_token":""}`, want: "is required"},
		{name: "too long", body: `{"refresh_token":"` + strings.Repeat("x", 201) + `"}`, want: "must be at most 200 characters"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			rec := do(env.h.Refresh, context.Background(), tt.body)
			body := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
			testx.AssertEqual(t, body.Error.Details["refresh_token"], any(tt.want))
			testx.AssertEqual(t, len(env.svc.called), 0)
		})
	}
}

func TestHandler_RefreshRateLimitedBeforeDecoding(t *testing.T) {
	env := newHandlerEnv(0)
	env.limiter.refuse = map[string]time.Duration{"refresh-ip": time.Minute}
	rec := do(env.h.Refresh, context.Background(), `not json`)
	assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
	testx.AssertEqual(t, len(env.svc.called), 0)
}

func TestHandler_Logout(t *testing.T) {
	t.Run("204", func(t *testing.T) {
		env := newHandlerEnv(0)
		var got string
		env.svc.logout = func(token string) error { got = token; return nil }
		rec := do(env.h.Logout, context.Background(), `{"refresh_token":"`+id1+`.s"}`)
		testx.AssertEqual(t, rec.Code, http.StatusNoContent)
		testx.AssertEqual(t, rec.Body.Len(), 0)
		testx.AssertEqual(t, got, id1+".s")
		testx.AssertEqual(t, len(env.limiter.seen()), 0, "logout is not rate limited")
	})
	t.Run("validation", func(t *testing.T) {
		env := newHandlerEnv(0)
		rec := do(env.h.Logout, context.Background(), `{}`)
		body := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertEqual(t, body.Error.Details["refresh_token"], any("is required"))
		testx.AssertEqual(t, len(env.svc.called), 0)
	})
	t.Run("bad body", func(t *testing.T) {
		env := newHandlerEnv(0)
		rec := do(env.h.Logout, context.Background(), `[]`)
		assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
	})
	t.Run("redis or database fails", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.svc.logout = func(string) error { return errBoom }
		rec := do(env.h.Logout, context.Background(), `{"refresh_token":"x"}`)
		assertError(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
	})
}
