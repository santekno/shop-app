package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/jwtx"
	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestAccessTokens_Issue(t *testing.T) {
	// A clock with nanoseconds: the claims must come back whole seconds.
	now := time.Now().Add(time.Minute).Truncate(time.Second).Add(123456789 * time.Nanosecond)
	tokens := NewAccessTokens(testSecret, 15*time.Minute, func() time.Time { return now })
	u := testUser()
	u.Role = user.RoleSeller

	raw, claims, err := tokens.Issue(u, id2)
	testx.AssertNoError(t, err)

	wantIat := now.Truncate(time.Second)
	testx.AssertEqual(t, claims.UserID, u.ID)
	testx.AssertEqual(t, claims.Role, user.RoleSeller)
	testx.AssertEqual(t, claims.SessionID, id2)
	testx.AssertTrue(t, claims.IssuedAt.Equal(wantIat), "iat %v, want %v", claims.IssuedAt, wantIat)
	testx.AssertTrue(t, claims.ExpiresAt.Equal(wantIat.Add(15*time.Minute)), "exp %v", claims.ExpiresAt)
	testx.AssertTrue(t, uuidx.IsValidUUID(claims.TokenID), "jti %q", claims.TokenID)
	testx.AssertEqual(t, claims.TokenID[14:15], "7", "jti is a UUIDv7: %q", claims.TokenID)

	// What the token itself says, read without the SDK.
	parts := strings.Split(raw, ".")
	testx.AssertEqual(t, len(parts), 3)
	header := decodeSegment(t, parts[0])
	testx.AssertEqual(t, header["alg"], any("HS256"))
	payload := decodeSegment(t, parts[1])
	testx.AssertEqual(t, payload["sub"], any(u.ID))
	testx.AssertEqual(t, payload["iss"], any("goshop-api"))
	aud, _ := payload["aud"].([]any)
	testx.AssertEqual(t, len(aud), 1, "aud = %v", payload["aud"])
	if len(aud) == 1 {
		testx.AssertEqual(t, aud[0], any("goshop"))
	}
	testx.AssertEqual(t, payload["role"], any("seller"))
	testx.AssertEqual(t, payload["sid"], any(id2))
	testx.AssertEqual(t, payload["jti"], any(claims.TokenID))
	testx.AssertEqual(t, payload["iat"], any(float64(wantIat.Unix())))
	testx.AssertEqual(t, payload["exp"], any(float64(wantIat.Add(15*time.Minute).Unix())))

	// And it round-trips through jwtx and Check to the same claims.
	verified, err := jwtx.Verify(raw, tokens.Key())
	testx.AssertNoError(t, err)
	checked, err := tokens.Check(verified)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, checked.UserID, claims.UserID)
	testx.AssertEqual(t, checked.Role, claims.Role)
	testx.AssertEqual(t, checked.SessionID, claims.SessionID)
	testx.AssertEqual(t, checked.TokenID, claims.TokenID)
	testx.AssertTrue(t, checked.IssuedAt.Equal(claims.IssuedAt))
	testx.AssertTrue(t, checked.ExpiresAt.Equal(claims.ExpiresAt))

	// A token signed with another key does not verify.
	_, err = jwtx.Verify(raw, jwtx.HS256([]byte("another-test-key-0123456789abcdef")))
	testx.AssertError(t, err)
}

func TestAccessTokens_IssueGivesEachTokenItsOwnID(t *testing.T) {
	tokens := NewAccessTokens(testSecret, time.Minute, nil) // nil: time.Now
	_, a, err := tokens.Issue(testUser(), id2)
	testx.AssertNoError(t, err)
	_, b, err := tokens.Issue(testUser(), id2)
	testx.AssertNoError(t, err)
	testx.AssertNotEqual(t, a.TokenID, b.TokenID)
	testx.AssertTrue(t, time.Since(a.IssuedAt) < time.Minute, "nil clock is time.Now: iat %v", a.IssuedAt)
}

func TestAccessTokens_IssueWithoutSecret(t *testing.T) {
	_, claims, err := NewAccessTokens(nil, time.Minute, nil).Issue(testUser(), id2)
	testx.AssertError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "sign access token: "), "err = %v", err)
	testx.AssertEqual(t, claims, AccessClaims{})
}

func TestAccessTokens_Check(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	tokens := NewAccessTokens(testSecret, 15*time.Minute, func() time.Time { return now })
	valid := func() *jwtx.Claims {
		return &jwtx.Claims{
			Subject: id1, Issuer: Issuer, Audience: []string{Audience}, ID: id3,
			IssuedAt: now.Add(-time.Minute), ExpiresAt: now.Add(time.Minute),
			Extra: map[string]any{"role": "admin", "sid": id2},
		}
	}
	tests := []struct {
		name   string
		change func(c *jwtx.Claims)
		ok     bool
	}{
		{name: "valid", change: func(*jwtx.Claims) {}, ok: true},
		{name: "another audience as well", change: func(c *jwtx.Claims) { c.Audience = []string{"other", Audience} }, ok: true},
		{name: "every role", change: func(c *jwtx.Claims) { c.Extra["role"] = "buyer" }, ok: true},
		{name: "wrong issuer", change: func(c *jwtx.Claims) { c.Issuer = "someone-else" }},
		{name: "no issuer", change: func(c *jwtx.Claims) { c.Issuer = "" }},
		{name: "wrong audience", change: func(c *jwtx.Claims) { c.Audience = []string{"other"} }},
		{name: "no audience", change: func(c *jwtx.Claims) { c.Audience = nil }},
		{name: "no subject", change: func(c *jwtx.Claims) { c.Subject = "" }},
		{name: "no jti", change: func(c *jwtx.Claims) { c.ID = "" }},
		{name: "no exp", change: func(c *jwtx.Claims) { c.ExpiresAt = time.Time{} }},
		{name: "no iat", change: func(c *jwtx.Claims) { c.IssuedAt = time.Time{} }},
		{name: "no sid", change: func(c *jwtx.Claims) { delete(c.Extra, "sid") }},
		{name: "empty sid", change: func(c *jwtx.Claims) { c.Extra["sid"] = "" }},
		{name: "sid not a string", change: func(c *jwtx.Claims) { c.Extra["sid"] = 42 }},
		{name: "unknown role", change: func(c *jwtx.Claims) { c.Extra["role"] = "superuser" }},
		{name: "no role", change: func(c *jwtx.Claims) { delete(c.Extra, "role") }},
		{name: "role not a string", change: func(c *jwtx.Claims) { c.Extra["role"] = true }},
		{name: "no extra claims", change: func(c *jwtx.Claims) { c.Extra = nil }},
		{name: "expires exactly now", change: func(c *jwtx.Claims) { c.ExpiresAt = now }},
		{name: "expired", change: func(c *jwtx.Claims) { c.ExpiresAt = now.Add(-time.Second) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := valid()
			tt.change(c)
			got, err := tokens.Check(c)
			if !tt.ok {
				testx.AssertTrue(t, errors.Is(err, ErrInvalidToken), "err = %v, want ErrInvalidToken", err)
				testx.AssertEqual(t, got, AccessClaims{})
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, got.UserID, id1)
			testx.AssertEqual(t, got.SessionID, id2)
			testx.AssertEqual(t, got.TokenID, id3)
			testx.AssertEqual(t, string(got.Role), c.Extra["role"].(string))
			testx.AssertTrue(t, got.IssuedAt.Equal(c.IssuedAt))
			testx.AssertTrue(t, got.ExpiresAt.Equal(c.ExpiresAt))
		})
	}

	t.Run("nil claims", func(t *testing.T) {
		_, err := tokens.Check(nil)
		testx.AssertTrue(t, errors.Is(err, ErrInvalidToken), "err = %v", err)
	})
}

// decodeSegment decodes one base64url JSON segment of a JWT.
func decodeSegment(t *testing.T, s string) map[string]any {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("decode segment %q: %v", s, err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal segment %s: %v", b, err)
	}
	return m
}
