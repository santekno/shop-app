//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// mailServer is a development server whose email goes to a recording
// mailer.
func mailServer(t *testing.T, env map[string]string, opts ...app.Option) (*server, *recordingMailer) {
	t.Helper()
	m := &recordingMailer{}
	return startServer(t, env, append(opts, app.WithMailer(m))...), m
}

// unusedTokens counts the email tokens of userID for purpose that can
// still be used.
func (s *server) unusedTokens(t *testing.T, userID, purpose string) int {
	t.Helper()
	return s.count(t, `SELECT count(*) FROM user_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, userID, purpose)
}

// TestVerifyEmail registers, takes the token from the verification email
// and confirms the address: 204, email_verified in /v1/me and in the row,
// the token is used up, and a resend for a verified address sends nothing.
func TestVerifyEmail(t *testing.T) {
	s, mailer := mailServer(t, nil)
	u, p := s.newAccount(t, "verifikasi")
	token := mailer.lastToken(t, u.Email, subjectVerify)
	if n := s.unusedTokens(t, u.ID, "verify_email"); n != 1 {
		t.Fatalf("%d unused verification tokens after registration, want 1", n)
	}
	id, hash := splitOpaque(t, token)
	if n := s.count(t, `SELECT count(*) FROM user_tokens WHERE id = $1 AND token_hash = $2
		AND expires_at BETWEEN now() + interval '23 hours 59 minutes' - $3::interval AND now() + interval '24 hours' + $3::interval`,
		id, hash, clockSkew); n != 1 {
		t.Error("the verification token is not stored as its SHA-256 with a 24-hour expiry")
	}

	resp := s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": token}, "")
	if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
		t.Fatalf("POST /v1/auth/verify-email = %d %q, want 204", resp.Status, resp.Body)
	}
	if me := assertUserDetail(t, s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken), http.StatusOK, "GET /v1/me"); !me.EmailVerified {
		t.Error("email_verified is still false after verification")
	}
	if n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND email_verified_at IS NOT NULL`, u.ID); n != 1 {
		t.Error("users.email_verified_at is not set")
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": token}, ""),
		http.StatusBadRequest, "TOKEN_INVALID")

	sent := len(mailer.messages(u.Email))
	if r := s.call(t, http.MethodPost, "/v1/auth/verify-email/resend", nil, p.AccessToken); r.Status != http.StatusAccepted {
		t.Fatalf("resend for a verified email = %d, want 202: %s", r.Status, r.Body)
	}
	if got := len(mailer.messages(u.Email)); got != sent {
		t.Errorf("resend for a verified email sent %d new emails, want none", got-sent)
	}
}

// TestVerifyEmail_OnlyNewestWorks resends the verification email: the
// older token stops working at once, the newest one verifies.
func TestVerifyEmail_OnlyNewestWorks(t *testing.T) {
	s, mailer := mailServer(t, nil)
	u, p := s.newAccount(t, "terbaru")
	old := mailer.lastToken(t, u.Email, subjectVerify)
	if r := s.call(t, http.MethodPost, "/v1/auth/verify-email/resend", nil, p.AccessToken); r.Status != http.StatusAccepted {
		t.Fatalf("resend = %d: %s", r.Status, r.Body)
	}
	newest := mailer.lastToken(t, u.Email, subjectVerify)
	if newest == old || s.unusedTokens(t, u.ID, "verify_email") != 1 {
		t.Fatalf("resend: new token %v, %d unused tokens; want a new one and only it", newest != old, s.unusedTokens(t, u.ID, "verify_email"))
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": old}, ""),
		http.StatusBadRequest, "TOKEN_INVALID")
	if r := s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": newest}, ""); r.Status != http.StatusNoContent {
		t.Errorf("the newest token = %d, want 204: %s", r.Status, r.Body)
	}
}

// TestVerifyEmail_Refusals: a token past its 24 hours is TOKEN_EXPIRED; a
// malformed one, a password-reset token and one of a deleted account are
// TOKEN_INVALID; a body without a token is VALIDATION_FAILED; resend needs
// a logged-in user.
func TestVerifyEmail_Refusals(t *testing.T) {
	clock := &testClock{}
	s, mailer := mailServer(t, nil, withClock(clock))

	u, _ := s.newAccount(t, "kedaluwarsa")
	expired := mailer.lastToken(t, u.Email, subjectVerify)

	other, _ := s.newAccount(t, "salah-tujuan")
	if r := s.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": other.Email}, ""); r.Status != http.StatusAccepted {
		t.Fatalf("forgot-password = %d", r.Status)
	}
	reset := mailer.lastToken(t, other.Email, subjectReset)
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": reset}, ""),
		http.StatusBadRequest, "TOKEN_INVALID")

	gone, goneTokens := s.newAccount(t, "terhapus")
	goneToken := mailer.lastToken(t, gone.Email, subjectVerify)
	if r := s.call(t, http.MethodDelete, "/v1/me", nil, goneTokens.AccessToken); r.Status != http.StatusNoContent {
		t.Fatalf("DELETE /v1/me = %d", r.Status)
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": goneToken}, ""),
		http.StatusBadRequest, "TOKEN_INVALID")

	for _, token := range []string{"bukan-token", strings.SplitN(expired, ".", 2)[0]} {
		assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": token}, ""),
			http.StatusBadRequest, "TOKEN_INVALID")
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{}, ""), http.StatusBadRequest, "VALIDATION_FAILED")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email/resend", nil, ""), http.StatusUnauthorized, "UNAUTHORIZED")

	clock.advance(24*time.Hour + time.Minute)
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": expired}, ""),
		http.StatusBadRequest, "TOKEN_EXPIRED")
	if n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND email_verified_at IS NULL`, u.ID); n != 1 {
		t.Error("an expired token verified the email")
	}
}

// TestLogMailer checks the mailer the API runs with until Bab 6: in
// development the message, token included, is in the log and the token
// from the log works; in production only the subject is logged, never the
// token or the address.
func TestLogMailer(t *testing.T) {
	t.Run("development logs the token", func(t *testing.T) {
		s := startServer(t, nil)
		u := s.register(t, uniqueEmail("log-dev"), testPassword, "Log Dev")
		logs := s.logs.String()
		token := emailTokenPattern.FindString(logs)
		if token == "" || !strings.Contains(logs, u.Email) || !strings.Contains(logs, "email (development: logged, not sent)") {
			t.Fatalf("the development log has no verification email for %s:\n%s", u.Email, logs)
		}
		if r := s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": token}, ""); r.Status != http.StatusNoContent {
			t.Errorf("the token from the log = %d, want 204: %s", r.Status, r.Body)
		}
	})
	t.Run("production logs the subject only", func(t *testing.T) {
		s := startServer(t, map[string]string{"APP_ENV": config.EnvProduction})
		u := s.register(t, uniqueEmail("log-prod"), testPassword, "Log Prod")
		if r := s.call(t, http.MethodPost, "/v1/auth/forgot-password", map[string]string{"email": u.Email}, ""); r.Status != http.StatusAccepted {
			t.Fatalf("forgot-password = %d", r.Status)
		}
		logs := s.logs.String()
		if emailTokenPattern.MatchString(logs) || strings.Contains(logs, u.Email) {
			t.Errorf("the production log holds a token or the address:\n%s", logs)
		}
		var subjects []string
		for _, line := range s.logs.jsonLines() {
			if line["msg"] == "email not sent: SMTP_HOST is not set" {
				subjects = append(subjects, fmt.Sprint(line["subject"]))
			}
		}
		if len(subjects) != 2 || !strings.HasPrefix(subjects[0], subjectVerify) || !strings.HasPrefix(subjects[1], subjectReset) {
			t.Errorf("logged subjects = %q, want the verification then the reset email", subjects)
		}
	})
}

// TestRace_VerifyTokens (A2, verification) races the verification token
// against itself and against new ones, raceIterations times:
//   - five verifies of one token at once: exactly one 204, the others 400
//     TOKEN_INVALID, and the token used once;
//   - three resends at once: every one 202, and exactly one unused token
//     left (the user row is locked before the old tokens are replaced);
//   - a verify racing a resend: the verify is 204 or TOKEN_INVALID (the
//     resend replaced its token first); when it lost, the newest mailed
//     token still verifies.
//
// No request may fail with a 5xx or a deadlock.
func TestRace_VerifyTokens(t *testing.T) {
	s, mailer := mailServer(t, nil, withUnlimitedRate())
	verify := func(token string) func() (response, error) {
		return func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": token}, "", nil)
		}
	}
	for i := range raceIterations {
		// Five consumers of one token.
		u, _ := s.newAccount(t, fmt.Sprintf("a2v-use-%d", i))
		results := runTogether(t, repeat(5, verify(mailer.lastToken(t, u.Email, subjectVerify)))...)
		if ok := countStatus(t, results, http.StatusNoContent, http.StatusBadRequest, "TOKEN_INVALID"); ok != 1 {
			t.Fatalf("iteration %d: %d of 5 concurrent verifies succeeded, want exactly 1", i, ok)
		}
		if n := s.count(t, `SELECT count(*) FROM user_tokens WHERE user_id = $1 AND used_at IS NOT NULL`, u.ID); n != 1 {
			t.Errorf("iteration %d: %d used tokens, want 1", i, n)
		}

		// Three issuers at once.
		u, p := s.newAccount(t, fmt.Sprintf("a2v-issue-%d", i))
		resend := func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/verify-email/resend", nil, p.AccessToken, nil)
		}
		for _, r := range runTogether(t, resend, resend, resend) {
			if r.Status != http.StatusAccepted {
				t.Fatalf("iteration %d: concurrent resend = %d: %s", i, r.Status, r.Body)
			}
		}
		if n := s.unusedTokens(t, u.ID, "verify_email"); n != 1 {
			t.Errorf("iteration %d: %d unused verification tokens after concurrent resends, want 1", i, n)
		}

		// Issue racing consume.
		u, p = s.newAccount(t, fmt.Sprintf("a2v-mix-%d", i))
		resend = func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/verify-email/resend", nil, p.AccessToken, nil)
		}
		results = runTogether(t, verify(mailer.lastToken(t, u.Email, subjectVerify)), resend)
		if results[1].Status != http.StatusAccepted {
			t.Fatalf("iteration %d: resend = %d: %s", i, results[1].Status, results[1].Body)
		}
		switch results[0].Status {
		case http.StatusNoContent:
		case http.StatusBadRequest:
			assertError(t, results[0], http.StatusBadRequest, "TOKEN_INVALID")
			if r := s.call(t, http.MethodPost, "/v1/auth/verify-email", map[string]string{"token": mailer.lastToken(t, u.Email, subjectVerify)}, ""); r.Status != http.StatusNoContent {
				t.Fatalf("iteration %d: the newest token after a lost race = %d: %s", i, r.Status, r.Body)
			}
		default:
			t.Fatalf("iteration %d: verify racing resend = %d: %s", i, results[0].Status, results[0].Body)
		}
		if n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND email_verified_at IS NOT NULL`, u.ID); n != 1 {
			t.Errorf("iteration %d: the email is not verified at the end", i)
		}
		if n := s.unusedTokens(t, u.ID, "verify_email"); n > 1 {
			t.Errorf("iteration %d: %d unused verification tokens, want at most 1", i, n)
		}
	}
	assertNoServerErrors(t, s)
}

// repeat returns n copies of fn.
func repeat[T any](n int, fn T) []T {
	out := make([]T, n)
	for i := range out {
		out[i] = fn
	}
	return out
}

// runTogether runs the requests at once from a barrier (together) and
// returns their responses in order; a transport error fails the test.
func runTogether(t *testing.T, reqs ...func() (response, error)) []response {
	t.Helper()
	out := make([]response, len(reqs))
	errs := make([]error, len(reqs))
	fns := make([]func(), len(reqs))
	for i, req := range reqs {
		fns[i] = func() { out[i], errs[i] = req() }
	}
	together(fns...)
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	return out
}

// countStatus returns how many responses have status okStatus, and fails
// unless every other one is failStatus with failCode.
func countStatus(t *testing.T, results []response, okStatus, failStatus int, failCode string) int {
	t.Helper()
	ok := 0
	for _, r := range results {
		if r.Status == okStatus {
			ok++
			continue
		}
		assertError(t, r, failStatus, failCode)
	}
	return ok
}
