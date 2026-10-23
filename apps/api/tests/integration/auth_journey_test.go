//go:build integration

package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// TestJourney_EveryAuthSeam runs one account through the whole chapter on
// a production-configured server, with only the outside world replaced
// through the app.Option seams (mail, Google, the clock): register, verify
// the email, log in, rotate, add an address, link nothing by email in
// Google, reset the password after the first session's access token
// expired, and delete the account. Real PostgreSQL, real Redis, the real
// rate limiter and the real revocation store are used throughout.
func TestJourney_EveryAuthSeam(t *testing.T) {
	clock := &testClock{}
	g := &fakeGoogle{}
	mailer := &recordingMailer{}
	s := startServer(t, map[string]string{"APP_ENV": config.EnvProduction},
		withClock(clock), app.WithMailer(mailer), app.WithGoogleVerifier(g))

	email := uniqueEmail("perjalanan")
	u := s.register(t, email, testPassword, "Perjalanan")
	if r := s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": mailer.lastToken(t, email, subjectVerify)}, ""); r.Status != http.StatusNoContent {
		t.Fatalf("verify-email = %d: %s", r.Status, r.Body)
	}
	p := s.login(t, email, testPassword)
	if !p.User.EmailVerified {
		t.Error("login after verification: email_verified is false")
	}
	p = s.refresh(t, p.RefreshToken)
	assertAddress(t, s.call(t, http.MethodPost, "/v1/me/addresses", addressBody("Rumah", false), p.AccessToken), http.StatusCreated, "address")

	g.accept("google-same-email", auth.GoogleIdentity{Subject: "sub-perjalanan", Email: email, EmailVerified: true})
	assertError(t, s.googleLogin(t, "google-same-email"), http.StatusConflict, "EMAIL_TAKEN")

	// 16 minutes later the access token has expired on its own; the
	// refresh token still works, and so does a reset.
	clock.advance(16 * time.Minute)
	assertError(t, s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken), http.StatusUnauthorized, "UNAUTHORIZED")
	p = s.refresh(t, p.RefreshToken)
	if r := s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(s.forgot(t, mailer, email), otherPassword), ""); r.Status != http.StatusNoContent {
		t.Fatalf("reset = %d: %s", r.Status, r.Body)
	}
	s.assertSessionEnded(t, p, defaultAccessTTL)

	p = s.login(t, email, otherPassword)
	if r := s.call(t, http.MethodDelete, "/v1/me", nil, p.AccessToken); r.Status != http.StatusNoContent {
		t.Fatalf("DELETE /v1/me = %d: %s", r.Status, r.Body)
	}
	s.assertAnonymised(t, u.ID)
	s.assertSessionEnded(t, p, defaultAccessTTL)
	if emailTokenPattern.MatchString(s.logs.String()) {
		t.Error("the production log holds a token")
	}
}
