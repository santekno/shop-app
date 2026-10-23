package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/santekno/sdk/testx"
)

const testClientID = "goshop-test.apps.googleusercontent.com"

// googleKeys is a local stand-in for Google: an RSA key whose public half
// the verifier trusts, so ID tokens can be signed here without a network.
type googleKeys struct {
	key *rsa.PrivateKey
	now time.Time
}

func newGoogleKeys(t *testing.T) *googleKeys {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	testx.AssertNoError(t, err)
	return &googleKeys{key: key, now: time.Now().Truncate(time.Second)}
}

// verifier is OIDCGoogleVerifier exactly as NewGoogleVerifier builds it,
// except that the keys are this test's instead of Google's JWKS.
func (g *googleKeys) verifier() *OIDCGoogleVerifier {
	keys := &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&g.key.PublicKey}}
	return &OIDCGoogleVerifier{verifier: oidc.NewVerifier("https://accounts.google.com", keys, &oidc.Config{
		ClientID:             testClientID,
		SupportedSigningAlgs: []string{oidc.RS256},
		Now:                  func() time.Time { return g.now },
	})}
}

// claims are the claims of a valid Google ID token.
func (g *googleKeys) claims() map[string]any {
	return map[string]any{
		"iss": "https://accounts.google.com", "aud": testClientID, "sub": "google-sub-1",
		"iat": g.now.Add(-time.Minute).Unix(), "exp": g.now.Add(time.Hour).Unix(),
		"email": "Budi@Gmail.com", "email_verified": true, "name": "Budi Santoso",
	}
}

// sign makes an RS256 JWT of claims with key.
func sign(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()
	enc := func(v any) string {
		b, err := json.Marshal(v)
		testx.AssertNoError(t, err)
		return base64.RawURLEncoding.EncodeToString(b)
	}
	signing := enc(map[string]any{"alg": "RS256", "typ": "JWT", "kid": "test"}) + "." + enc(claims)
	sum := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	testx.AssertNoError(t, err)
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestOIDCGoogleVerifier_Verify(t *testing.T) {
	g := newGoogleKeys(t)
	v := g.verifier()

	id, err := v.Verify(context.Background(), sign(t, g.key, g.claims()))

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, id, GoogleIdentity{
		Subject: "google-sub-1", Email: "Budi@Gmail.com", EmailVerified: true, Name: "Budi Santoso",
	})
}

func TestOIDCGoogleVerifier_Refusals(t *testing.T) {
	g := newGoogleKeys(t)
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	testx.AssertNoError(t, err)

	tests := []struct {
		name    string
		key     *rsa.PrivateKey
		change  func(c map[string]any)
		wantMsg string
	}{
		{name: "another app's token", change: func(c map[string]any) { c["aud"] = "other.apps.googleusercontent.com" }},
		{name: "another issuer", change: func(c map[string]any) { c["iss"] = "https://evil.example.com" }},
		{name: "expired", change: func(c map[string]any) { c["exp"] = g.now.Add(-time.Second).Unix() }},
		{name: "signed by someone else", key: other, change: func(map[string]any) {}},
		{name: "no subject", change: func(c map[string]any) { delete(c, "sub") }, wantMsg: "google id token invalid: no subject"},
		{name: "claims of the wrong type", change: func(c map[string]any) { c["email_verified"] = map[string]any{} }, wantMsg: "read claims"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := g.claims()
			tt.change(c)
			key := g.key
			if tt.key != nil {
				key = tt.key
			}
			id, err := g.verifier().Verify(context.Background(), sign(t, key, c))
			testx.AssertTrue(t, errors.Is(err, ErrGoogleTokenInvalid), "err = %v", err)
			testx.AssertEqual(t, id, GoogleIdentity{})
			if tt.wantMsg != "" {
				testx.AssertContains(t, err.Error(), tt.wantMsg)
			}
		})
	}
}

// NewGoogleVerifier makes no network call, and a malformed token is refused
// before any key would be fetched.
func TestNewGoogleVerifier_MalformedToken(t *testing.T) {
	v := NewGoogleVerifier(testClientID, nil)
	id, err := v.Verify(context.Background(), "not.a.jwt")
	testx.AssertTrue(t, errors.Is(err, ErrGoogleTokenInvalid), "err = %v", err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "google id token invalid: "), "the reason is wrapped: %v", err)
	testx.AssertEqual(t, id, GoogleIdentity{})
}
