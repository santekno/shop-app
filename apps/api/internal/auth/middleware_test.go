package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/jwtx"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// guardEnv is a Guard on in-memory revocations, with a handler behind it
// that records what it saw.
type guardEnv struct {
	access  *AccessTokens
	revoked *fakeRevocations
	handler http.Handler
	reached bool
	claims  AccessClaims
	hasIt   bool
	userID  string
}

func newGuardEnv() *guardEnv {
	env := &guardEnv{
		access:  NewAccessTokens(testSecret, 15*time.Minute, nil),
		revoked: newFakeRevocations(),
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		env.reached = true
		env.claims, env.hasIt = ClaimsFrom(r.Context())
		env.userID = ctxx.UserID(r.Context())
		logx.FromContext(r.Context()).Info("handler ran")
		w.WriteHeader(http.StatusNoContent)
	})
	env.handler = NewGuard(env.access, env.revoked).Authenticate(next)
	return env
}

// serve sends GET with the Authorization header (none when empty), logging
// to the returned buffer.
func (env *guardEnv) serve(authorization string) (*httptest.ResponseRecorder, string) {
	ctx, logs := ctxWithLogs()
	r := httptest.NewRequestWithContext(ctx, http.MethodGet, "/v1/me", nil)
	if authorization != "" {
		r.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, r)
	return rec, logs.String()
}

func TestGuard_Authenticate(t *testing.T) {
	env := newGuardEnv()
	u := testUser()
	u.Role = user.RoleSeller
	token, issued, err := env.access.Issue(u, id2)
	testx.AssertNoError(t, err)

	rec, logs := env.serve("Bearer " + token)

	testx.AssertEqual(t, rec.Code, http.StatusNoContent, "body %s", rec.Body.String())
	testx.AssertTrue(t, env.reached)
	testx.AssertTrue(t, env.hasIt, "ClaimsFrom finds the claims")
	testx.AssertEqual(t, env.claims.UserID, u.ID)
	testx.AssertEqual(t, env.claims.Role, user.RoleSeller)
	testx.AssertEqual(t, env.claims.SessionID, id2)
	testx.AssertEqual(t, env.claims.TokenID, issued.TokenID)
	testx.AssertEqual(t, env.userID, u.ID, "ctxx.UserID is the caller")
	testx.AssertContains(t, logs, `"user_id":"`+u.ID+`"`)
	testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), "")
}

func TestGuard_AuthenticateRefusals(t *testing.T) {
	env := newGuardEnv()
	good, _, err := env.access.Issue(testUser(), id2)
	testx.AssertNoError(t, err)
	other, _, err := NewAccessTokens([]byte("another-test-key-0123456789abcdef"), time.Minute, nil).Issue(testUser(), id2)
	testx.AssertNoError(t, err)
	// Signed with the right key but not a token this API issues.
	foreign, err := jwtx.Sign(jwtx.Claims{
		Subject: id1, Issuer: "another-service", Audience: []string{Audience}, ID: id3,
		IssuedAt: time.Now(), ExpiresAt: time.Now().Add(time.Minute),
		Extra: map[string]any{"role": "admin", "sid": id2},
	}, env.access.Key())
	testx.AssertNoError(t, err)
	noExp, err := jwtx.Sign(jwtx.Claims{
		Subject: id1, Issuer: Issuer, Audience: []string{Audience}, ID: id3, IssuedAt: time.Now(),
		Extra: map[string]any{"role": "admin", "sid": id2},
	}, env.access.Key())
	testx.AssertNoError(t, err)

	tests := []struct {
		name          string
		authorization string
		wantMessage   string
	}{
		{name: "no header", authorization: "", wantMessage: "missing Authorization header"},
		{name: "not Bearer", authorization: "Basic dXNlcjpwYXNz", wantMessage: "invalid Authorization header format"},
		{name: "Bearer without a token", authorization: "Bearer ", wantMessage: "invalid Authorization header format"},
		{name: "garbage", authorization: "Bearer not-a-jwt", wantMessage: "invalid or expired token"},
		{name: "another key", authorization: "Bearer " + other, wantMessage: "invalid or expired token"},
		{name: "another issuer", authorization: "Bearer " + foreign, wantMessage: "invalid or expired token"},
		{name: "no exp", authorization: "Bearer " + noExp, wantMessage: "invalid or expired token"},
		{name: "tampered", authorization: "Bearer " + tamper(good), wantMessage: "invalid or expired token"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env.reached = false
			rec, _ := env.serve(tt.authorization)
			testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
			testx.AssertFalse(t, env.reached, "the handler ran")
			testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, "UNAUTHORIZED")
			testx.AssertEqual(t, body.Error.Message, tt.wantMessage)
		})
	}
}

func TestGuard_AuthenticateRevokedSession(t *testing.T) {
	env := newGuardEnv()
	token, _, err := env.access.Issue(testUser(), id2)
	testx.AssertNoError(t, err)
	testx.AssertNoError(t, env.revoked.Revoke(context.Background(), id2))

	rec, _ := env.serve("Bearer " + token)

	testx.AssertEqual(t, rec.Code, http.StatusUnauthorized)
	testx.AssertFalse(t, env.reached)
	testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`)
	body := decodeError(t, rec)
	testx.AssertEqual(t, body.Error.Code, "UNAUTHORIZED")
	testx.AssertEqual(t, body.Error.Message, "this session has ended; log in again")

	// Another session of the same user still works.
	other, _, err := env.access.Issue(testUser(), id3)
	testx.AssertNoError(t, err)
	rec, _ = env.serve("Bearer " + other)
	testx.AssertEqual(t, rec.Code, http.StatusNoContent)
}

// When Redis cannot answer, the request fails closed: 500, logged, and the
// handler never runs with a possibly revoked token.
func TestGuard_AuthenticateFailsClosed(t *testing.T) {
	env := newGuardEnv()
	env.revoked.checkErr = errBoom
	token, _, err := env.access.Issue(testUser(), id2)
	testx.AssertNoError(t, err)

	rec, logs := env.serve("Bearer " + token)

	testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
	testx.AssertFalse(t, env.reached, "the handler ran without the revocation check")
	testx.AssertEqual(t, decodeError(t, rec).Error.Code, "INTERNAL_ERROR")
	testx.AssertContains(t, logs, `"error":"boom"`)
}

func TestClaimsFrom_Empty(t *testing.T) {
	c, ok := ClaimsFrom(context.Background())
	testx.AssertFalse(t, ok)
	testx.AssertEqual(t, c, AccessClaims{})
}

// tamper changes one character in the middle of tok's signature. The last
// base64url character of an HS256 signature carries padding bits a decoder
// ignores, so changing the end can leave the signature valid; a character
// in the middle always changes a signature byte.
func tamper(tok string) string {
	b := []byte(tok)
	i := strings.LastIndex(tok, ".") + 10
	if b[i] == 'A' {
		b[i] = 'B'
	} else {
		b[i] = 'A'
	}
	return string(b)
}
