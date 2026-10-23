package auth

import (
	"context"
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"
)

// A 401 because the account is gone (ErrNoUser) carries WWW-Authenticate
// like the guard's, so a client knows to log in again with a Bearer token;
// a wrong password or a bad refresh token is a 401 with its own code and
// asks for no new scheme.
func TestHandler_UnauthorizedAsksForBearer(t *testing.T) {
	tests := []struct {
		name   string
		call   func(env *handlerEnv) (http.HandlerFunc, context.Context, string)
		code   string
		header string
	}{
		{name: "refresh, account gone", code: "UNAUTHORIZED", header: `Bearer realm="goshop"`,
			call: func(env *handlerEnv) (http.HandlerFunc, context.Context, string) {
				env.svc.refresh = func(string) (Tokens, error) { return Tokens{}, ErrNoUser }
				return env.h.Refresh, context.Background(), `{"refresh_token":"x"}`
			}},
		{name: "resend, account gone", code: "UNAUTHORIZED", header: `Bearer realm="goshop"`,
			call: func(env *handlerEnv) (http.HandlerFunc, context.Context, string) {
				env.svc.resendVerification = func(string) error { return ErrNoUser }
				return env.h.ResendVerification, withClaims(context.Background(), AccessClaims{UserID: id1, SessionID: id2}), ``
			}},
		{name: "google, account gone", code: "UNAUTHORIZED", header: `Bearer realm="goshop"`,
			call: func(env *handlerEnv) (http.HandlerFunc, context.Context, string) {
				env.svc.googleLogin = func(string) (Tokens, error) { return Tokens{}, ErrNoUser }
				return env.h.GoogleLogin, context.Background(), `{"id_token":"x"}`
			}},
		{name: "login, wrong password", code: CodeInvalidCredentials, header: "",
			call: func(env *handlerEnv) (http.HandlerFunc, context.Context, string) {
				env.svc.login = func(string, string) (Tokens, error) { return Tokens{}, ErrInvalidCredentials }
				return env.h.Login, context.Background(), `{"email":"budi@example.com","password":"x"}`
			}},
		{name: "refresh, token invalid", code: CodeTokenInvalid, header: "",
			call: func(env *handlerEnv) (http.HandlerFunc, context.Context, string) {
				env.svc.refresh = func(string) (Tokens, error) { return Tokens{}, ErrRefreshTokenInvalid }
				return env.h.Refresh, context.Background(), `{"refresh_token":"x"}`
			}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			fn, ctx, body := tt.call(env)
			rec := do(fn, ctx, body)
			assertError(t, rec, http.StatusUnauthorized, tt.code)
			testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), tt.header)
		})
	}
}
