package auth

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// testTokens is what a fake login or refresh returns, expiring relative to
// the handler's clock.
func (env *handlerEnv) testTokens() Tokens {
	return Tokens{
		User: testUser(), SessionID: id2,
		AccessToken: "access.jwt.token", AccessExpiresAt: env.now.Add(15 * time.Minute),
		RefreshToken: id3 + ".secret", RefreshExpiresAt: env.now.Add(30 * 24 * time.Hour),
	}
}

func TestHandler_Login(t *testing.T) {
	env := newHandlerEnv(0)
	var gotEmail, gotPassword string
	env.svc.login = func(email, password string) (Tokens, error) {
		gotEmail, gotPassword = email, password
		return env.testTokens(), nil
	}

	rec := do(env.h.Login, context.Background(), `{"email":"Budi@Example.com","password":"kopi susu gula aren"}`)

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, gotEmail, "Budi@Example.com", "the service normalises")
	testx.AssertEqual(t, gotPassword, "kopi susu gula aren")
	body := decodeTokens(t, rec).Data
	testx.AssertEqual(t, body.AccessToken, "access.jwt.token")
	testx.AssertEqual(t, body.TokenType, "Bearer")
	testx.AssertEqual(t, body.ExpiresIn, int64(900))
	testx.AssertEqual(t, body.RefreshToken, id3+".secret")
	testx.AssertEqual(t, body.RefreshExpiresIn, int64(30*24*3600))
	testx.AssertEqual(t, body.User["id"], any(id1))
	// Counted per IP, then per email (hashed), in that order.
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","),
		"login-ip:203.0.113.7,login-email:"+EmailKey("budi@example.com"))
}

func TestHandler_LoginFailures(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantMsg    string
	}{
		{name: "wrong credentials", err: ErrInvalidCredentials, wantStatus: http.StatusUnauthorized,
			wantCode: CodeInvalidCredentials, wantMsg: "email or password is incorrect"},
		{name: "database", err: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			env.svc.login = func(string, string) (Tokens, error) { return Tokens{}, tt.err }
			rec := do(env.h.Login, context.Background(), `{"email":"budi@example.com","password":"x"}`)
			body := assertError(t, rec, tt.wantStatus, tt.wantCode)
			if tt.wantMsg != "" {
				testx.AssertEqual(t, body.Error.Message, tt.wantMsg)
			}
		})
	}
}

// Login decodes first (it needs the email for the per-email limit), then
// counts the attempt, then validates: a malformed attempt costs one too.
func TestHandler_LoginRateLimitOrder(t *testing.T) {
	t.Run("a body that cannot be decoded is not counted", func(t *testing.T) {
		env := newHandlerEnv(0)
		rec := do(env.h.Login, context.Background(), `{`)
		assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertEqual(t, len(env.limiter.seen()), 0)
	})
	t.Run("an invalid body is counted before validation", func(t *testing.T) {
		env := newHandlerEnv(0)
		rec := do(env.h.Login, context.Background(), `{}`)
		body := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertEqual(t, body.Error.Details["email"], any("is required"))
		testx.AssertEqual(t, body.Error.Details["password"], any("is required"))
		testx.AssertEqual(t, len(env.limiter.seen()), 2)
	})
	t.Run("over the limit, an invalid body gets 429, not 400", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.limiter.refuse = map[string]time.Duration{"login-ip": time.Second}
		rec := do(env.h.Login, context.Background(), `{}`)
		assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
		testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "login-ip:203.0.113.7",
			"the per-email limit is not counted once the per-IP one refused")
	})
	t.Run("the per-email limit", func(t *testing.T) {
		env := newHandlerEnv(0)
		env.limiter.refuse = map[string]time.Duration{"login-email": 15 * time.Minute}
		rec := do(env.h.Login, context.Background(), `{"email":"budi@example.com","password":"x"}`)
		assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
		testx.AssertEqual(t, rec.Header().Get("Retry-After"), "900")
		testx.AssertEqual(t, len(env.svc.called), 0)
	})
	t.Run("long values are refused after counting", func(t *testing.T) {
		env := newHandlerEnv(0)
		rec := do(env.h.Login, context.Background(),
			`{"email":"budi@example.com","password":"`+strings.Repeat("p", 1025)+`"}`)
		body := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertEqual(t, body.Error.Details["password"], any("must be at most 1024 characters"))
		testx.AssertEqual(t, len(env.svc.called), 0)
	})
}

func TestSecondsUntil(t *testing.T) {
	now := time.Date(2026, 10, 23, 10, 0, 0, 0, time.UTC)
	testx.AssertEqual(t, secondsUntil(now.Add(90*time.Second), now), int64(90))
	testx.AssertEqual(t, secondsUntil(now.Add(1500*time.Millisecond), now), int64(1), "whole seconds, rounded down")
	testx.AssertEqual(t, secondsUntil(now, now), int64(0))
	testx.AssertEqual(t, secondsUntil(now.Add(-time.Hour), now), int64(0), "never negative")
}
