package auth

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestHandler_VerifyEmail(t *testing.T) {
	env := newHandlerEnv(0)
	var got string
	env.svc.verifyEmail = func(token string) error { got = token; return nil }

	rec := do(env.h.VerifyEmail, context.Background(), `{"token":"`+id1+`.secret"}`)

	testx.AssertEqual(t, rec.Code, http.StatusNoContent, "body %s", rec.Body.String())
	testx.AssertEqual(t, got, id1+".secret")
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "verify-email-ip:203.0.113.7")
}

func TestHandler_VerifyEmailErrors(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		err        error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{name: "invalid or used", body: `{"token":"x"}`, err: ErrEmailTokenInvalid, wantStatus: http.StatusBadRequest,
			wantCode: CodeTokenInvalid, wantMsg: "the token is invalid or has already been used"},
		{name: "expired", body: `{"token":"x"}`, err: ErrEmailTokenExpired, wantStatus: http.StatusBadRequest,
			wantCode: CodeTokenExpired, wantMsg: "the token has expired; ask for a new email"},
		{name: "database", body: `{"token":"x"}`, err: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
		{name: "no token", body: `{}`, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED"},
		{name: "token too long", body: `{"token":"` + strings.Repeat("x", 201) + `"}`, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			env.svc.verifyEmail = func(string) error { return tt.err }
			rec := do(env.h.VerifyEmail, context.Background(), tt.body)
			body := assertError(t, rec, tt.wantStatus, tt.wantCode)
			if tt.wantMsg != "" {
				testx.AssertEqual(t, body.Error.Message, tt.wantMsg)
			}
		})
	}
}

func TestHandler_VerifyEmailRateLimitedBeforeDecoding(t *testing.T) {
	env := newHandlerEnv(0)
	env.limiter.refuse = map[string]time.Duration{"verify-email-ip": time.Minute}
	rec := do(env.h.VerifyEmail, context.Background(), `not json`)
	assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
	testx.AssertEqual(t, len(env.svc.called), 0)
}

// ctxAs is a context with the claims Guard.Authenticate would have stored.
func ctxAs(userID string) context.Context {
	return withClaims(context.Background(), AccessClaims{UserID: userID, Role: user.RoleBuyer, SessionID: id2})
}

func TestHandler_ResendVerification(t *testing.T) {
	t.Run("202, limited per user", func(t *testing.T) {
		env := newHandlerEnv(0)
		var got string
		env.svc.resendVerification = func(id string) error { got = id; return nil }
		rec := do(env.h.ResendVerification, ctxAs(id1), ``)
		testx.AssertEqual(t, rec.Code, http.StatusAccepted, "body %s", rec.Body.String())
		testx.AssertEqual(t, got, id1, "the user comes from the token")
		testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "resend-user:"+id1)
	})
	t.Run("over the limit", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.limiter.refuse = map[string]time.Duration{"resend-user": 20 * time.Minute}
		rec := do(env.h.ResendVerification, ctxAs(id1), ``)
		assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
		testx.AssertEqual(t, rec.Header().Get("Retry-After"), "1200")
		testx.AssertEqual(t, len(env.svc.called), 0)
	})
	t.Run("account gone", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.svc.resendVerification = func(string) error { return ErrNoUser }
		rec := do(env.h.ResendVerification, ctxAs(id1), ``)
		body := assertError(t, rec, http.StatusUnauthorized, "UNAUTHORIZED")
		testx.AssertEqual(t, body.Error.Message, "this account no longer exists")
	})
	t.Run("mail fails", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.svc.resendVerification = func(string) error { return errBoom }
		rec := do(env.h.ResendVerification, ctxAs(id1), ``)
		assertError(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
	})
}
