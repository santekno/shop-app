//go:build integration

package integration_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/auth"
)

// jwtClaims decodes the payload of a JWT without checking it, to see what
// the API put in its access token.
func jwtClaims(t *testing.T, token string) map[string]any {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("access token %q is not a JWT", token)
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("JWT payload is not base64url: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatalf("JWT payload is not JSON: %v", err)
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || !bytes.Contains(header, []byte(`"HS256"`)) {
		t.Errorf("JWT header = %s (%v), want alg HS256", header, err)
	}
	return claims
}

// splitOpaque splits an opaque token into its id and the SHA-256 of its
// secret, which is all PostgreSQL may hold (ADR 0005).
func splitOpaque(t *testing.T, token string) (string, []byte) {
	t.Helper()
	id, enc, ok := strings.Cut(token, ".")
	secret, err := base64.RawURLEncoding.DecodeString(enc)
	if !ok || err != nil || len(secret) != 32 {
		t.Fatalf("token %q is not <uuid>.<base64url of 32 bytes>", token)
	}
	sum := sha256.Sum256(secret)
	return id, sum[:]
}

// TestLogin_IssuesSession logs in over HTTP and checks the TokenPair, the
// access token's claims (HS256, issuer, audience, subject, role, session,
// a 15-minute life) and the refresh token's row: only its SHA-256 hash is
// stored, in a family whose id is the access token's session.
func TestLogin_IssuesSession(t *testing.T) {
	s := startServer(t, nil)
	email := uniqueEmail("login")
	u := s.register(t, email, testPassword, "Login")

	before := time.Now().Truncate(time.Second)
	// The email is trimmed and lower-cased before the lookup.
	p := assertTokenPair(t, s.call(t, http.MethodPost, "/v1/auth/login",
		map[string]string{"email": " " + strings.ToUpper(email) + " ", "password": testPassword}, ""), "login")
	if p.User.ID != u.ID || p.User.Role != "buyer" {
		t.Errorf("login user = %+v, want %s as buyer", p.User, u.ID)
	}
	if p.ExpiresIn < 890 || p.ExpiresIn > 900 {
		t.Errorf("expires_in = %d, want about 900 (APP_ACCESS_TOKEN_TTL 15m)", p.ExpiresIn)
	}
	if want := int64(720 * 3600); p.RefreshExpiresIn < want-10 || p.RefreshExpiresIn > want {
		t.Errorf("refresh_expires_in = %d, want about %d (APP_REFRESH_TOKEN_TTL 720h)", p.RefreshExpiresIn, want)
	}

	c := jwtClaims(t, p.AccessToken)
	aud, _ := c["aud"].([]any)
	iat, _ := c["iat"].(float64)
	exp, _ := c["exp"].(float64)
	sid, _ := c["sid"].(string)
	if c["sub"] != u.ID || c["role"] != "buyer" || c["iss"] != auth.Issuer || !slices.Contains(aud, any(auth.Audience)) ||
		!uuidPattern.MatchString(sid) || c["jti"] == nil {
		t.Errorf("access token claims = %v", c)
	}
	if exp-iat != 900 || time.Unix(int64(iat), 0).Before(before) {
		t.Errorf("iat %v, exp %v: want a token issued now that lives 900 s", iat, exp)
	}

	id, hash := splitOpaque(t, p.RefreshToken)
	var (
		storedHash []byte
		family     string
		expiresAt  time.Time
		live       bool
	)
	err := s.db.QueryRowContext(t.Context(), `SELECT token_hash, family_id::text, expires_at, used_at IS NULL AND revoked_at IS NULL
		FROM refresh_tokens WHERE id = $1 AND user_id = $2`, id, u.ID).Scan(&storedHash, &family, &expiresAt, &live)
	if err != nil {
		t.Fatalf("the refresh token's row: %v", err)
	}
	if !bytes.Equal(storedHash, hash) || family != sid || !live {
		t.Errorf("refresh token row: hash matches %v, family %s (sid %s), live %v", bytes.Equal(storedHash, hash), family, sid, live)
	}
	if d := time.Until(expiresAt); d < 719*time.Hour || d > 720*time.Hour {
		t.Errorf("refresh token expires in %s, want 720h", d)
	}
	// A second login is a second session.
	again := s.login(t, email, testPassword)
	if jwtClaims(t, again.AccessToken)["sid"] == sid || s.liveSessions(t, u.ID) != 2 {
		t.Errorf("a second login reused the session or did not store one: %d live sessions", s.liveSessions(t, u.ID))
	}
}

// TestLogin_Failures checks that every failure looks the same: an unknown
// email, a wrong password and a wrong-case password all answer the same
// 401 INVALID_CREDENTIALS body, and none of them starts a session. A body
// that is not a login at all is a 400.
func TestLogin_Failures(t *testing.T) {
	s := startServer(t, nil, withUnlimitedRate())
	email := uniqueEmail("gagal")
	u := s.register(t, email, testPassword, "Gagal")

	var first []byte
	for _, body := range []map[string]string{
		{"email": email, "password": wrongPassword},
		{"email": uniqueEmail("tidak-ada"), "password": testPassword},
		{"email": email, "password": strings.ToUpper(testPassword)},
		{"email": "bukan email sama sekali", "password": testPassword},
	} {
		resp := s.call(t, http.MethodPost, "/v1/auth/login", body, "")
		assertError(t, resp, http.StatusUnauthorized, "INVALID_CREDENTIALS")
		if first == nil {
			first = resp.Body
		} else if !bytes.Equal(resp.Body, first) {
			t.Errorf("login failures differ, which tells an attacker why:\n%s\n%s", first, resp.Body)
		}
	}
	if n := s.liveSessions(t, u.ID); n != 0 {
		t.Errorf("%d sessions after failed logins", n)
	}

	for _, body := range []any{map[string]string{"email": email}, map[string]string{"password": testPassword}, `[]`,
		map[string]string{"email": email, "password": strings.Repeat("x", 1025)}} {
		assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", body, ""), http.StatusBadRequest, "VALIDATION_FAILED")
	}
}
