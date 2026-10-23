//go:build integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/auth"
)

// assertAnonymised fails unless userID is an anonymised row with nothing
// personal left: deleted+<id>@invalid, no name, phone or password, and no
// addresses, Google identities, email tokens or live sessions.
func (s *server) assertAnonymised(t *testing.T, userID string) {
	t.Helper()
	n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND email = 'deleted+' || id::text || '@invalid'
		AND name = '' AND phone IS NULL AND password_hash IS NULL AND anonymized_at IS NOT NULL`, userID)
	if n != 1 {
		t.Errorf("user %s is not anonymised", userID)
	}
	for _, table := range []string{"addresses", "user_identities", "user_tokens"} {
		if n := s.count(t, `SELECT count(*) FROM `+table+` WHERE user_id = $1`, userID); n != 0 {
			t.Errorf("%d rows of %s left for the deleted user", n, table)
		}
	}
	if n := s.liveSessions(t, userID); n != 0 {
		t.Errorf("%d live sessions left for the deleted user", n)
	}
}

// TestDeleteAccount deletes an account with two sessions, an address, a
// Google identity and an email token: 204; the row is anonymised and
// keeps its id (orders will point at it); every session ends at once in
// PostgreSQL and Redis; login fails the same way as for an unknown email;
// and the email can register again as a new account.
func TestDeleteAccount(t *testing.T) {
	g := &fakeGoogle{}
	s, _ := googleServer(t, g)
	u, phone := s.newAccount(t, "hapus")
	laptop := s.login(t, u.Email, testPassword)
	assertAddress(t, s.call(t, http.MethodPost, "/v1/me/addresses", addressBody("Rumah", true), phone.AccessToken), http.StatusCreated, "address")
	mustExec(t, s.db, `INSERT INTO user_identities (id, user_id, provider, subject) VALUES (gen_random_uuid(), $1, 'google', 'sub-hapus')`, u.ID)

	resp := s.call(t, http.MethodDelete, "/v1/me", nil, phone.AccessToken)
	if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
		t.Fatalf("DELETE /v1/me = %d %q, want 204", resp.Status, resp.Body)
	}
	s.assertAnonymised(t, u.ID)
	s.assertSessionEnded(t, phone, defaultAccessTTL)
	s.assertSessionEnded(t, laptop, defaultAccessTTL)
	assertError(t, s.call(t, http.MethodDelete, "/v1/me", nil, phone.AccessToken), http.StatusUnauthorized, "UNAUTHORIZED")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": u.Email, "password": testPassword}, ""),
		http.StatusUnauthorized, "INVALID_CREDENTIALS")
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": "deleted+" + u.ID + "@invalid", "password": testPassword}, ""),
		http.StatusUnauthorized, "INVALID_CREDENTIALS")

	// The deleted Google link is gone: the same Google account signs up
	// anew instead of reaching the anonymised row.
	g.accept("lagi", auth.GoogleIdentity{Subject: "sub-hapus", Email: uniqueEmail("google-baru"), EmailVerified: true})
	if p := assertTokenPair(t, s.googleLogin(t, "lagi"), "Google after deletion"); p.User.ID == u.ID {
		t.Error("Google sign-in reached the deleted account")
	}

	again := s.register(t, u.Email, otherPassword, "Hapus Lagi")
	if again.ID == u.ID {
		t.Error("registering the freed email returned the deleted account")
	}
	s.login(t, u.Email, otherPassword)
}

// TestRace_RefreshVersusDelete keeps a client refreshing in a loop while
// the account is deleted, raceIterations times, the deletion landing after
// 0 to 3 rotations. The account ends anonymised with no live session, and
// the refresher's newest tokens are refused.
func TestRace_RefreshVersusDelete(t *testing.T) {
	s := startServer(t, nil, withUnlimitedRate())
	for i := range raceIterations {
		u, p := s.newAccount(t, fmt.Sprintf("hapus-refresh-%d", i))
		chain := newRefreshChain(s, p)
		var del response
		var delErr error
		together(chain.run, func() {
			chain.waitRotations(i % 4)
			// The access token of the original login: its session is the
			// one being rotated, and a rotation does not end it.
			del, delErr = s.tryCall(http.MethodDelete, "/v1/me", nil, p.AccessToken, nil)
		})
		if delErr != nil || del.Status != http.StatusNoContent {
			t.Fatalf("iteration %d: DELETE /v1/me = %d, %v: %s", i, del.Status, delErr, del.Body)
		}
		chain.check(t, i)
		s.assertAnonymised(t, u.ID)
		s.assertSessionEnded(t, chain.latest(), defaultAccessTTL)
	}
	assertNoServerErrors(t, s)
}

// TestRace_LoginVersusDelete (A6, deletion) sends five logins at the same
// moment as the deletion, raceIterations times. CreateRefreshToken locks
// the user and refuses an anonymised one, and the deletion revokes
// whatever was stored first: no session survives, and every pair a login
// returned is refused afterwards. A deletion needs no password hash, so it
// would always beat the five argon2id verifications; iteration i starts it
// (i%5)*20ms later, across the time a login takes, so the test also sees
// logins that finish first and sessions the deletion must end.
func TestRace_LoginVersusDelete(t *testing.T) {
	s := startServer(t, nil, withUnlimitedRate())
	logins, refused := 0, 0
	for i := range raceIterations {
		u, p := s.newAccount(t, fmt.Sprintf("hapus-login-%d", i))
		login := func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/login", map[string]string{"email": u.Email, "password": testPassword}, "", nil)
		}
		delay := time.Duration(i%5) * 20 * time.Millisecond
		del := func() (response, error) {
			time.Sleep(delay)
			return s.tryCall(http.MethodDelete, "/v1/me", nil, p.AccessToken, nil)
		}
		results := runTogether(t, login, login, login, login, login, del)
		if results[5].Status != http.StatusNoContent {
			t.Fatalf("iteration %d: DELETE /v1/me = %d: %s", i, results[5].Status, results[5].Body)
		}
		s.assertAnonymised(t, u.ID)
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
	t.Logf("%d logins answered 200 before the deletion (all ended), %d refused", logins, refused)
	assertNoServerErrors(t, s)
}

// assertUnauthorizedBearer fails unless resp is 401 UNAUTHORIZED with
// WWW-Authenticate: Bearer realm="goshop" (RFC 6750), and returns its
// message.
func assertUnauthorizedBearer(t *testing.T, resp response, what string) string {
	t.Helper()
	assertError(t, resp, http.StatusUnauthorized, "UNAUTHORIZED")
	if got := resp.Header.Get("WWW-Authenticate"); got != `Bearer realm="goshop"` {
		t.Errorf("%s: WWW-Authenticate = %q, want Bearer realm=\"goshop\"", what, got)
	}
	var e struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(resp.Body, &e)
	return e.Error.Message
}

// TestDeleteAccount_StaleAccessToken uses access tokens that are still
// within their 15 minutes after the account was deleted. Normally the
// Redis revocation answers first ("this session has ended"). When that
// revocation is missing (DELETE /v1/me only logs a failed Redis write),
// the handlers find the account gone and answer "this account no longer
// exists". Both paths are 401 with WWW-Authenticate.
func TestDeleteAccount_StaleAccessToken(t *testing.T) {
	s := startServer(t, nil)
	u, phone := s.newAccount(t, "basi")
	laptop := s.login(t, u.Email, testPassword)
	if r := s.call(t, http.MethodDelete, "/v1/me", nil, phone.AccessToken); r.Status != http.StatusNoContent {
		t.Fatalf("DELETE /v1/me = %d: %s", r.Status, r.Body)
	}

	routes := []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/v1/me", nil},
		{http.MethodPatch, "/v1/me", map[string]any{"name": "Hantu"}},
		{http.MethodPost, "/v1/me/addresses", addressBody("Rumah", true)},
		{http.MethodPost, "/v1/auth/verify-email/resend", nil},
	}
	for _, r := range routes {
		msg := assertUnauthorizedBearer(t, s.call(t, r.method, r.path, r.body, phone.AccessToken), r.method+" "+r.path+" (revoked)")
		if !strings.Contains(msg, "session has ended") {
			t.Errorf("%s %s with a revoked session: message %q, want the revocation's", r.method, r.path, msg)
		}
	}

	// Lose the laptop session's revocation, as a failed Redis write would.
	if err := s.rdb.Del(t.Context(), revokedKey(sessionOf(t, laptop.AccessToken))).Err(); err != nil {
		t.Fatal(err)
	}
	for _, r := range routes {
		msg := assertUnauthorizedBearer(t, s.call(t, r.method, r.path, r.body, laptop.AccessToken), r.method+" "+r.path+" (account gone)")
		if !strings.Contains(msg, "no longer exists") {
			t.Errorf("%s %s for a deleted account: message %q, want \"this account no longer exists\"", r.method, r.path, msg)
		}
	}
	s.assertAnonymised(t, u.ID)
}
