//go:build integration

package integration_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// fakeGoogle is an auth.GoogleVerifier that accepts the ID tokens a test
// registered: a real ID token needs a real Google account, so the HTTP
// boundary to Google is faked here (app.WithGoogleVerifier) and everything
// after it is real.
type fakeGoogle struct {
	mu     sync.Mutex
	tokens map[string]auth.GoogleIdentity
}

// accept makes idToken verify as id.
func (g *fakeGoogle) accept(idToken string, id auth.GoogleIdentity) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.tokens == nil {
		g.tokens = map[string]auth.GoogleIdentity{}
	}
	g.tokens[idToken] = id
}

// Verify implements auth.GoogleVerifier.
func (g *fakeGoogle) Verify(_ context.Context, raw string) (auth.GoogleIdentity, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	id, ok := g.tokens[raw]
	if !ok {
		return auth.GoogleIdentity{}, errors.New("fake google: unknown id token") //nolint:err113 // a fake's own error
	}
	return id, nil
}

// googleServer is a development server that trusts g for Google sign-in.
func googleServer(t *testing.T, g *fakeGoogle, opts ...app.Option) (*server, *recordingMailer) {
	t.Helper()
	return mailServer(t, nil, append(opts, app.WithGoogleVerifier(g))...)
}

// googleLogin posts idToken to /v1/auth/google.
func (s *server) googleLogin(t *testing.T, idToken string) response {
	t.Helper()
	return s.call(t, http.MethodPost, "/v1/auth/google", map[string]string{"id_token": idToken}, "")
}

// TestGoogle_FirstAndLaterSignIn: the first sign-in of a Google account
// creates a buyer with a verified email, no password and one identity row;
// later sign-ins find the same account by Google's subject, never by
// email, each as a new session.
func TestGoogle_FirstAndLaterSignIn(t *testing.T) {
	g := &fakeGoogle{}
	s, mailer := googleServer(t, g)
	email := uniqueEmail("google")
	g.accept("id-1", auth.GoogleIdentity{Subject: "google-sub-1", Email: strings.ToUpper(email), EmailVerified: true, Name: "  Siti Google "})

	first := assertTokenPair(t, s.googleLogin(t, "id-1"), "first Google sign-in")
	if first.User.Email != email || first.User.Name != "Siti Google" || first.User.Role != "buyer" || !first.User.EmailVerified {
		t.Errorf("Google account = %+v, want %s, trimmed name, buyer, verified", first.User, email)
	}
	if n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND password_hash IS NULL`, first.User.ID); n != 1 {
		t.Error("the Google account has a password hash")
	}
	if n := s.count(t, `SELECT count(*) FROM user_identities WHERE user_id = $1 AND provider = 'google' AND subject = 'google-sub-1'`, first.User.ID); n != 1 {
		t.Error("no google identity row for the new account")
	}
	if len(mailer.messages(email)) != 0 {
		t.Error("a verification email went to an address Google already verified")
	}

	// The same subject with a changed email is still the same account.
	g.accept("id-2", auth.GoogleIdentity{Subject: "google-sub-1", Email: uniqueEmail("berganti"), EmailVerified: true, Name: "Siti"})
	again := assertTokenPair(t, s.googleLogin(t, "id-2"), "second Google sign-in")
	if again.User.ID != first.User.ID || sessionOf(t, again.AccessToken) == sessionOf(t, first.AccessToken) {
		t.Errorf("second sign-in: user %s session %s, want user %s in a new session", again.User.ID, sessionOf(t, again.AccessToken), first.User.ID)
	}
	if n := s.count(t, `SELECT count(*) FROM users`); n != 1 {
		t.Errorf("%d users after two sign-ins of one Google account", n)
	}
	s.refresh(t, again.RefreshToken)

	// A Google-only account has no password to log in with, until it sets
	// one through forgot-password.
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": email, "password": testPassword}, ""),
		http.StatusUnauthorized, "INVALID_CREDENTIALS")
	if r := s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(s.forgot(t, mailer, email), testPassword), ""); r.Status != http.StatusNoContent {
		t.Fatalf("reset for the Google account = %d: %s", r.Status, r.Body)
	}
	if p := s.login(t, email, testPassword); p.User.ID != first.User.ID {
		t.Errorf("password login reached user %s, want %s", p.User.ID, first.User.ID)
	}
	if r := s.googleLogin(t, "id-2"); r.Status != http.StatusOK {
		t.Errorf("Google sign-in after setting a password = %d, want it still to work", r.Status)
	}
}

// TestGoogle_Refusals: an ID token Google would not verify is 401
// TOKEN_INVALID, an unverified Google email 400 EMAIL_UNVERIFIED, a
// non-ASCII email 401, an email that already has a password account 409
// EMAIL_TAKEN without linking anything, and a body without id_token 400.
func TestGoogle_Refusals(t *testing.T) {
	g := &fakeGoogle{}
	s, _ := googleServer(t, g)
	taken, _ := s.newAccount(t, "sudah-ada")
	g.accept("unverified", auth.GoogleIdentity{Subject: "sub-unverified", Email: uniqueEmail("belum"), EmailVerified: false})
	g.accept("non-ascii", auth.GoogleIdentity{Subject: "sub-ascii", Email: "siti@contöh.example", EmailVerified: true})
	g.accept("taken", auth.GoogleIdentity{Subject: "sub-taken", Email: taken.Email, EmailVerified: true})

	assertError(t, s.googleLogin(t, "palsu"), http.StatusUnauthorized, "TOKEN_INVALID")
	assertError(t, s.googleLogin(t, "unverified"), http.StatusBadRequest, "EMAIL_UNVERIFIED")
	assertError(t, s.googleLogin(t, "non-ascii"), http.StatusUnauthorized, "TOKEN_INVALID")
	assertError(t, s.googleLogin(t, "taken"), http.StatusConflict, "EMAIL_TAKEN")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/google", map[string]string{}, ""), http.StatusBadRequest, "VALIDATION_FAILED")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/google", map[string]string{"id_token": strings.Repeat("x", 8193)}, ""),
		http.StatusBadRequest, "VALIDATION_FAILED")

	if n := s.count(t, `SELECT count(*) FROM user_identities`); n != 0 {
		t.Errorf("%d identities linked by refused sign-ins", n)
	}
	if n := s.count(t, `SELECT count(*) FROM users`); n != 1 {
		t.Errorf("%d users, want only the password account", n)
	}
	if n := s.liveSessions(t, taken.ID); n != 1 {
		t.Errorf("the password account has %d sessions, want its own login only", n)
	}
}

// TestGoogle_Configuration: without GOOGLE_CLIENT_ID (development only)
// Google sign-in is off and the route answers the router's 404; with one,
// the real go-oidc verifier is wired and refuses a token that is not a
// JWT before any network call.
func TestGoogle_Configuration(t *testing.T) {
	off := startServer(t, nil)
	assertError(t, off.googleLogin(t, "apa-saja"), http.StatusNotFound, "NOT_FOUND")
	if !strings.Contains(off.logs.String(), "google sign-in is off") {
		t.Error("the server did not log that Google sign-in is off")
	}

	on := startServer(t, map[string]string{"APP_ENV": config.EnvProduction})
	assertError(t, on.googleLogin(t, "bukan-jwt"), http.StatusUnauthorized, "TOKEN_INVALID")
	if strings.Contains(on.logs.String(), "google sign-in is off") {
		t.Error("production with GOOGLE_CLIENT_ID logged that Google sign-in is off")
	}
}
