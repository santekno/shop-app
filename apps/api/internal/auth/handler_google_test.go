package auth

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestHandler_GoogleLogin(t *testing.T) {
	env := newHandlerEnv(0)
	var got string
	env.svc.googleLogin = func(idToken string) (Tokens, error) { got = idToken; return env.testTokens(), nil }

	rec := do(env.h.GoogleLogin, context.Background(), `{"id_token":"google.id.token"}`)

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, got, "google.id.token")
	testx.AssertEqual(t, decodeTokens(t, rec).Data.AccessToken, "access.jwt.token")
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "google-ip:203.0.113.7")
}

func TestHandler_GoogleLoginErrors(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		err        error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{name: "token refused", err: ErrGoogleTokenInvalid, wantStatus: http.StatusUnauthorized,
			wantCode: CodeTokenInvalid, wantMsg: "the Google sign-in could not be verified; try again"},
		{name: "email unverified", err: ErrGoogleEmailUnverified, wantStatus: http.StatusBadRequest,
			wantCode: CodeEmailUnverified, wantMsg: "verify the email of your Google account first"},
		// Off looks exactly like a route that does not exist.
		{name: "disabled", err: ErrGoogleDisabled, wantStatus: http.StatusNotFound, wantCode: "NOT_FOUND", wantMsg: "route not found"},
		{name: "email taken", err: ErrEmailTaken, wantStatus: http.StatusConflict, wantCode: CodeEmailTaken},
		{name: "database", err: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
		{name: "no id_token", body: `{}`, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED"},
		{name: "id_token too long", body: `{"id_token":"` + strings.Repeat("x", 8193) + `"}`,
			wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			env.svc.googleLogin = func(string) (Tokens, error) { return Tokens{}, tt.err }
			body := tt.body
			if body == "" {
				body = `{"id_token":"google.id.token"}`
			}
			rec := do(env.h.GoogleLogin, context.Background(), body)
			b := assertError(t, rec, tt.wantStatus, tt.wantCode)
			if tt.wantMsg != "" {
				testx.AssertEqual(t, b.Error.Message, tt.wantMsg)
			}
		})
	}
}

func TestHandler_GoogleLoginRateLimitedBeforeDecoding(t *testing.T) {
	env := newHandlerEnv(0)
	env.limiter.refuse = map[string]time.Duration{"google-ip": time.Minute}
	rec := do(env.h.GoogleLogin, context.Background(), `not json`)
	assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
	testx.AssertEqual(t, len(env.svc.called), 0)
}
