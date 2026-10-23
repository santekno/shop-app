//go:build integration

package integration_test

import (
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/jwtx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
)

// signAccess signs claims with key the way the API does, for tokens the
// API itself would never issue.
func signAccess(t *testing.T, key []byte, claims jwtx.Claims) string {
	t.Helper()
	token, err := jwtx.Sign(claims, jwtx.HS256(key))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return token
}

// TestMe_ReturnsCaller checks GET /v1/me with a fresh access token: the
// caller's own account in the contract's UserDetail shape, the same one
// registration returned.
func TestMe_ReturnsCaller(t *testing.T) {
	s := startServer(t, nil)
	u, p := s.newAccount(t, "saya")
	me := assertUserDetail(t, s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken), http.StatusOK, "GET /v1/me")
	if me != u {
		t.Errorf("GET /v1/me = %+v, want the registered account %+v", me, u)
	}
}

// TestGuard_RefusesBadTokens sends every kind of access token the guard
// must refuse: each is 401 UNAUTHORIZED with WWW-Authenticate: Bearer
// realm="goshop", whatever was wrong.
func TestGuard_RefusesBadTokens(t *testing.T) {
	s := startServer(t, nil)
	u, p := s.newAccount(t, "penjaga")
	secret := []byte(testJWTSecret)
	sid := sessionOf(t, p.AccessToken)
	now := time.Now().Truncate(time.Second)
	valid := jwtx.Claims{
		Subject: u.ID, Issuer: auth.Issuer, Audience: []string{auth.Audience}, IssuedAt: now,
		ExpiresAt: now.Add(10 * time.Minute), ID: uuidx.NewV7(),
		Extra: map[string]any{"role": "buyer", "sid": sid},
	}
	with := func(change func(c *jwtx.Claims)) string {
		c := valid
		c.Extra = map[string]any{"role": "buyer", "sid": sid}
		change(&c)
		return signAccess(t, secret, c)
	}
	// alg none: the header says unsigned, the signature is empty.
	none := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`)) + "." +
		strings.Split(p.AccessToken, ".")[1] + "."

	if r := s.call(t, http.MethodGet, "/v1/me", nil, signAccess(t, secret, valid)); r.Status != http.StatusOK {
		t.Fatalf("the control token is refused: %d %s", r.Status, r.Body)
	}
	headers := map[string]string{
		"no header":          "",
		"basic auth":         "Basic dXNlcjpwYXNz",
		"bearer, no token":   "Bearer ",
		"not a JWT":          "Bearer bukan-jwt",
		"another key":        "Bearer " + signAccess(t, []byte("another-signing-key-that-is-32-bytes-long"), valid),
		"alg none":           "Bearer " + none,
		"tampered signature": "Bearer " + p.AccessToken[:len(p.AccessToken)-4] + "AAAA",
		"expired":            "Bearer " + with(func(c *jwtx.Claims) { c.IssuedAt, c.ExpiresAt = now.Add(-time.Hour), now.Add(-time.Minute) }),
		"no exp":             "Bearer " + with(func(c *jwtx.Claims) { c.ExpiresAt = time.Time{} }),
		"other issuer":       "Bearer " + with(func(c *jwtx.Claims) { c.Issuer = "someone-else" }),
		"other audience":     "Bearer " + with(func(c *jwtx.Claims) { c.Audience = []string{"other-app"} }),
		"no subject":         "Bearer " + with(func(c *jwtx.Claims) { c.Subject = "" }),
		"no session":         "Bearer " + with(func(c *jwtx.Claims) { delete(c.Extra, "sid") }),
		"unknown role":       "Bearer " + with(func(c *jwtx.Claims) { c.Extra["role"] = "root" }),
		"refresh token":      "Bearer " + p.RefreshToken,
	}
	for name, header := range headers {
		t.Run(name, func(t *testing.T) {
			h := map[string]string{}
			if header != "" {
				h["Authorization"] = header
			}
			for _, route := range []string{"/v1/me", "/v1/me/addresses"} {
				resp, err := s.tryCall(http.MethodGet, route, nil, "", h)
				if err != nil {
					t.Fatal(err)
				}
				assertError(t, resp, http.StatusUnauthorized, "UNAUTHORIZED")
				if got := resp.Header.Get("WWW-Authenticate"); got != `Bearer realm="goshop"` {
					t.Errorf("%s: WWW-Authenticate = %q", route, got)
				}
			}
		})
	}
}
