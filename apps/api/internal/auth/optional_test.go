package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/testx"
)

// optionalEnv is a guardEnv whose handler sits behind Guard.Optional.
func optionalEnv() *guardEnv {
	env := newGuardEnv()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		env.reached = true
		env.claims, env.hasIt = ClaimsFrom(r.Context())
		env.userID = ctxx.UserID(r.Context())
		w.WriteHeader(http.StatusNoContent)
	})
	env.handler = NewGuard(env.access, env.revoked).Optional(next)
	return env
}

func TestGuard_Optional(t *testing.T) {
	t.Run("no Authorization header goes on as a guest", func(t *testing.T) {
		env := optionalEnv()
		rec, _ := env.serve("")
		testx.AssertEqual(t, rec.Code, http.StatusNoContent)
		testx.AssertTrue(t, env.reached)
		testx.AssertFalse(t, env.hasIt, "a guest has no claims")
		testx.AssertEqual(t, env.userID, "")
	})
	t.Run("a valid token is the user", func(t *testing.T) {
		env := optionalEnv()
		token, _, err := env.access.Issue(testUser(), id2)
		testx.AssertNoError(t, err)
		rec, _ := env.serve("Bearer " + token)
		testx.AssertEqual(t, rec.Code, http.StatusNoContent)
		testx.AssertTrue(t, env.hasIt)
		testx.AssertEqual(t, env.userID, testUser().ID)
	})
	// A broken token is 401, never a silent switch to the guest's cart.
	for _, authorization := range []string{"Bearer not-a-jwt", "Basic dXNlcjpwYXNz", "Bearer "} {
		t.Run("a bad header is 401: "+authorization, func(t *testing.T) {
			env := optionalEnv()
			rec, _ := env.serve(authorization)
			testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
			testx.AssertFalse(t, env.reached)
			testx.AssertEqual(t, decodeError(t, rec).Error.Code, "UNAUTHORIZED")
		})
	}
	t.Run("a revoked session is 401", func(t *testing.T) {
		env := optionalEnv()
		token, _, err := env.access.Issue(testUser(), id2)
		testx.AssertNoError(t, err)
		testx.AssertNoError(t, env.revoked.Revoke(context.Background(), id2))
		rec, _ := env.serve("Bearer " + token)
		testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
		testx.AssertFalse(t, env.reached)
	})
}

func TestAllow(t *testing.T) {
	limit := Limit{Name: "feature", Max: 1, Window: time.Minute}
	serve := func(l RateLimiter) (*httptest.ResponseRecorder, bool) {
		rec := httptest.NewRecorder()
		r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/cart/items", nil)
		return rec, Allow(rec, r, l, limit, "203.0.113.7")
	}

	t.Run("allowed: nothing is written", func(t *testing.T) {
		l := &fakeLimiter{}
		rec, ok := serve(l)
		testx.AssertTrue(t, ok)
		testx.AssertEqual(t, rec.Body.Len(), 0)
		testx.AssertEqual(t, rec.Header().Get("Retry-After"), "")
		testx.AssertEqual(t, l.seen()[0], "feature:203.0.113.7")
	})
	tests := []struct {
		retry time.Duration
		want  string
	}{
		{retry: 90 * time.Second, want: "90"},
		{retry: 1500 * time.Millisecond, want: "2"}, // rounded up
		{retry: time.Millisecond, want: "1"},
		{retry: 0, want: "1"}, // never "0": the client would retry at once
	}
	for _, tt := range tests {
		t.Run("refused after "+tt.retry.String(), func(t *testing.T) {
			rec, ok := serve(&fakeLimiter{refuse: map[string]time.Duration{"feature": tt.retry}})
			testx.AssertFalse(t, ok)
			testx.AssertEqual(t, rec.Code, http.StatusTooManyRequests)
			testx.AssertEqual(t, rec.Header().Get("Retry-After"), tt.want)
			testx.AssertEqual(t, decodeError(t, rec).Error.Code, "RATE_LIMITED")
		})
	}
	t.Run("a limiter error is 500, not a skipped limit", func(t *testing.T) {
		rec, ok := serve(&fakeLimiter{err: errBoom})
		testx.AssertFalse(t, ok)
		testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
		testx.AssertEqual(t, rec.Header().Get("Retry-After"), "")
		testx.AssertEqual(t, decodeError(t, rec).Error.Code, "INTERNAL_ERROR")
	})
}
