//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// forgot asks for a reset email for email and returns the token it
// carries.
func (s *server) forgot(t *testing.T, mailer *recordingMailer, email string) string {
	t.Helper()
	if r := s.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": email}, ""); r.Status != http.StatusAccepted {
		t.Fatalf("POST /v1/auth/forgot-password = %d: %s", r.Status, r.Body)
	}
	return mailer.lastToken(t, email, subjectReset)
}

// resetBody is a ResetPasswordRequest.
func resetBody(token, password string) map[string]string {
	return map[string]string{"token": token, "password": password}
}

// TestResetPassword resets the password of an account with two live
// sessions: 204, both sessions end at once (PostgreSQL and Redis), the old
// password stops working and the new one works, the email counts as
// verified, and the token is used up.
func TestResetPassword(t *testing.T) {
	s, mailer := mailServer(t, nil)
	u, phone := s.newAccount(t, "lupa")
	laptop := s.login(t, u.Email, testPassword)

	token := s.forgot(t, mailer, u.Email)
	id, hash := splitOpaque(t, token)
	if n := s.count(t, `SELECT count(*) FROM user_tokens WHERE id = $1 AND token_hash = $2 AND purpose = 'reset_password'
		AND expires_at BETWEEN now() + interval '29 minutes' AND now() + interval '30 minutes'`, id, hash); n != 1 {
		t.Error("the reset token is not stored as its SHA-256 with a 30-minute expiry")
	}

	resp := s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(token, otherPassword), "")
	if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
		t.Fatalf("POST /v1/auth/reset-password = %d %q, want 204", resp.Status, resp.Body)
	}
	s.assertSessionEnded(t, phone, defaultAccessTTL)
	s.assertSessionEnded(t, laptop, defaultAccessTTL)
	if n := s.liveSessions(t, u.ID); n != 0 {
		t.Errorf("%d live sessions after the reset", n)
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": u.Email, "password": testPassword}, ""),
		http.StatusUnauthorized, "INVALID_CREDENTIALS")
	if p := s.login(t, u.Email, otherPassword); !p.User.EmailVerified {
		t.Error("the reset did not verify the email")
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(token, testPassword), ""),
		http.StatusBadRequest, "TOKEN_INVALID")
	if n := s.unusedTokens(t, u.ID, "reset_password"); n != 0 {
		t.Errorf("%d unused reset tokens after the reset", n)
	}
}

// TestForgotPassword_SaysNothing checks that the answer never tells whether
// the email has an account: 202 with no body for a known and an unknown
// address, and only the known one gets an email.
func TestForgotPassword_SaysNothing(t *testing.T) {
	s, mailer := mailServer(t, nil)
	u, _ := s.newAccount(t, "dikenal")
	unknown := uniqueEmail("tidak-dikenal")

	known := s.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": u.Email}, "")
	missing := s.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": unknown}, "")
	if known.Status != http.StatusAccepted || missing.Status != http.StatusAccepted || len(known.Body) != 0 || len(missing.Body) != 0 {
		t.Fatalf("forgot-password: known %d %q, unknown %d %q; want 202 and no body for both", known.Status, known.Body, missing.Status, missing.Body)
	}
	if len(mailer.tokens(u.Email, subjectReset)) != 1 || len(mailer.messages(unknown)) != 0 {
		t.Errorf("reset emails: %d to the account, %d to the unknown address; want 1 and 0",
			len(mailer.tokens(u.Email, subjectReset)), len(mailer.messages(unknown)))
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{}, ""), http.StatusBadRequest, "VALIDATION_FAILED")
}

// TestResetPassword_Refusals: a new password the policy refuses is a 400
// on details.password and leaves the token usable; an older token, a
// verification token and a malformed one are TOKEN_INVALID; a token past
// its 30 minutes is TOKEN_EXPIRED.
func TestResetPassword_Refusals(t *testing.T) {
	clock := &testClock{}
	s, mailer := mailServer(t, nil, withClock(clock))
	u, _ := s.newAccount(t, "tolak-reset")

	older := s.forgot(t, mailer, u.Email)
	token := s.forgot(t, mailer, u.Email)
	if n := s.unusedTokens(t, u.ID, "reset_password"); n != 1 {
		t.Errorf("%d unused reset tokens after two requests, want only the newest", n)
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(older, otherPassword), ""),
		http.StatusBadRequest, "TOKEN_INVALID")

	details := assertError(t, s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(token, "password123"), ""),
		http.StatusBadRequest, "VALIDATION_FAILED")
	if _, ok := details["password"]; !ok {
		t.Errorf("details = %v, want the password policy under password", details)
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(mailer.lastToken(t, u.Email, subjectVerify), otherPassword), ""),
		http.StatusBadRequest, "TOKEN_INVALID")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody("bukan-token", otherPassword), ""),
		http.StatusBadRequest, "TOKEN_INVALID")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/reset-password", map[string]string{"token": token}, ""),
		http.StatusBadRequest, "VALIDATION_FAILED")

	clock.advance(30*time.Minute + time.Second)
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/reset-password", resetBody(token, otherPassword), ""),
		http.StatusBadRequest, "TOKEN_EXPIRED")
	s.login(t, u.Email, testPassword)
}

// TestRace_RefreshVersusReset (B1) keeps a client refreshing in a loop
// while the password is reset, raceIterations times, the reset landing
// after 0 to 3 rotations. Whatever the interleaving, no session survives
// the reset: 204, no live refresh token of the user, the refresher's
// newest tokens refused, every session revoked in Redis, and only the new
// password logs in.
func TestRace_RefreshVersusReset(t *testing.T) {
	s, mailer := mailServer(t, nil, withUnlimitedRate())
	for i := range raceIterations {
		u, p := s.newAccount(t, fmt.Sprintf("b1-%d", i))
		token := s.forgot(t, mailer, u.Email)
		chain := newRefreshChain(s, p)
		var reset response
		var resetErr error
		together(chain.run, func() {
			chain.waitRotations(i % 4)
			reset, resetErr = s.tryCall(http.MethodPost, "/v1/auth/reset-password", resetBody(token, otherPassword), "", nil)
		})
		if resetErr != nil || reset.Status != http.StatusNoContent {
			t.Fatalf("iteration %d: reset = %d, %v: %s", i, reset.Status, resetErr, reset.Body)
		}
		chain.check(t, i)
		if n := s.liveSessions(t, u.ID); n != 0 {
			t.Fatalf("iteration %d: %d sessions survived the reset", i, n)
		}
		s.assertSessionEnded(t, chain.latest(), defaultAccessTTL)
		assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": u.Email, "password": testPassword}, ""),
			http.StatusUnauthorized, "INVALID_CREDENTIALS")
	}
	assertNoServerErrors(t, s)
}

// TestRace_LoginVersusReset (A6) sends five logins with the old password
// at the same moment as the reset, raceIterations times. A login that
// verified the old hash before the reset committed may still be answered
// 200, but CreateRefreshToken locks the user and refuses a hash that
// changed, and the reset revokes whatever was stored first: at the end no
// session of the user is live, and every pair a login returned is refused.
func TestRace_LoginVersusReset(t *testing.T) {
	s, mailer := mailServer(t, nil, withUnlimitedRate())
	logins, refused := 0, 0
	for i := range raceIterations {
		u := s.register(t, uniqueEmail(fmt.Sprintf("a6r-%d", i)), testPassword, "A6")
		token := s.forgot(t, mailer, u.Email)
		login := func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/login", map[string]string{"email": u.Email, "password": testPassword}, "", nil)
		}
		reset := func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/reset-password", resetBody(token, otherPassword), "", nil)
		}
		results := runTogether(t, login, login, login, login, login, reset)
		if results[5].Status != http.StatusNoContent {
			t.Fatalf("iteration %d: reset = %d: %s", i, results[5].Status, results[5].Body)
		}
		if n := s.liveSessions(t, u.ID); n != 0 {
			t.Fatalf("iteration %d: %d sessions survived the reset", i, n)
		}
		for _, r := range results[:5] {
			if r.Status != http.StatusOK {
				assertError(t, r, http.StatusUnauthorized, "INVALID_CREDENTIALS")
				refused++
				continue
			}
			logins++
			s.assertSessionEnded(t, decodeData[tokenPairOut](t, r.Body), defaultAccessTTL)
		}
	}
	t.Logf("%d logins answered 200 before the reset (all ended), %d refused", logins, refused)
	assertNoServerErrors(t, s)
}

// TestRace_ResetTokens (A2, password reset) races the reset token against
// itself and against new ones, raceIterations times:
//   - two forgot-password requests at once leave exactly one unused token;
//   - five resets with one token at once: exactly one 204, the others
//     TOKEN_INVALID, and the winner's password is the one that works;
//   - a reset racing a new forgot-password: the reset wins (204, the new
//     token is the only unused one) or loses to the replacement
//     (TOKEN_INVALID, the old password still works).
//
// No request may fail with a 5xx or a deadlock.
func TestRace_ResetTokens(t *testing.T) {
	s, mailer := mailServer(t, nil, withUnlimitedRate())
	for i := range raceIterations {
		u, _ := s.newAccount(t, fmt.Sprintf("a2r-issue-%d", i))
		forgot := func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": u.Email}, "", nil)
		}
		for _, r := range runTogether(t, forgot, forgot) {
			if r.Status != http.StatusAccepted {
				t.Fatalf("iteration %d: concurrent forgot-password = %d: %s", i, r.Status, r.Body)
			}
		}
		if n := s.unusedTokens(t, u.ID, "reset_password"); n != 1 {
			t.Errorf("iteration %d: %d unused reset tokens after two concurrent requests, want 1", i, n)
		}

		u, _ = s.newAccount(t, fmt.Sprintf("a2r-use-%d", i))
		token := s.forgot(t, mailer, u.Email)
		passwords := make([]string, 5)
		reqs := make([]func() (response, error), 5)
		for k := range reqs {
			passwords[k] = fmt.Sprintf("sandi-baru-nomor-%d-%d", i, k)
			reqs[k] = func() (response, error) {
				return s.tryCall(http.MethodPost, "/v1/auth/reset-password", resetBody(token, passwords[k]), "", nil)
			}
		}
		results := runTogether(t, reqs...)
		if ok := countStatus(t, results, http.StatusNoContent, http.StatusBadRequest, "TOKEN_INVALID"); ok != 1 {
			t.Fatalf("iteration %d: %d of 5 concurrent resets succeeded, want exactly 1", i, ok)
		}
		for k, r := range results {
			want := http.StatusUnauthorized
			if r.Status == http.StatusNoContent {
				want = http.StatusOK
			}
			if got := s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": u.Email, "password": passwords[k]}, "").Status; got != want {
				t.Errorf("iteration %d: login with reset %d's password = %d, want %d", i, k, got, want)
			}
		}

		u, _ = s.newAccount(t, fmt.Sprintf("a2r-mix-%d", i))
		token = s.forgot(t, mailer, u.Email)
		results = runTogether(t, func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/reset-password", resetBody(token, otherPassword), "", nil)
		}, func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": u.Email}, "", nil)
		})
		if results[1].Status != http.StatusAccepted {
			t.Fatalf("iteration %d: forgot-password = %d: %s", i, results[1].Status, results[1].Body)
		}
		works := testPassword
		switch results[0].Status {
		case http.StatusNoContent:
			works = otherPassword
		case http.StatusBadRequest:
			assertError(t, results[0], http.StatusBadRequest, "TOKEN_INVALID")
		default:
			t.Fatalf("iteration %d: reset racing forgot = %d: %s", i, results[0].Status, results[0].Body)
		}
		if n := s.unusedTokens(t, u.ID, "reset_password"); n != 1 {
			t.Errorf("iteration %d: %d unused reset tokens, want the new one only", i, n)
		}
		s.login(t, u.Email, works)
	}
	assertNoServerErrors(t, s)
}
