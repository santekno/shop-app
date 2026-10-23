//go:build integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// TestRefresh_RotatesAndDetectsReuse walks one session through a rotation
// and a replay: the new pair is a new refresh token in the same family,
// the presented one is marked used, and presenting it again revokes the
// whole family in PostgreSQL and in Redis, so even the newest tokens stop
// working.
func TestRefresh_RotatesAndDetectsReuse(t *testing.T) {
	s := startServer(t, nil)
	u, first := s.newAccount(t, "rotasi")
	sid := sessionOf(t, first.AccessToken)

	second := s.refresh(t, first.RefreshToken)
	if second.RefreshToken == first.RefreshToken || second.AccessToken == first.AccessToken {
		t.Fatal("refresh returned the same tokens")
	}
	if got := sessionOf(t, second.AccessToken); got != sid || second.User.ID != u.ID {
		t.Errorf("rotated pair: session %s user %s, want session %s user %s", got, second.User.ID, sid, u.ID)
	}
	firstID, _ := splitOpaque(t, first.RefreshToken)
	secondID, _ := splitOpaque(t, second.RefreshToken)
	if n := s.count(t, `SELECT count(*) FROM refresh_tokens WHERE id = $1 AND used_at IS NOT NULL AND revoked_at IS NULL`, firstID); n != 1 {
		t.Error("the presented refresh token is not marked used")
	}
	if n := s.count(t, `SELECT count(*) FROM refresh_tokens WHERE id = $1 AND family_id = $2 AND used_at IS NULL
		AND expires_at > (SELECT expires_at FROM refresh_tokens WHERE id = $3)`, secondID, sid, firstID); n != 1 {
		t.Error("the new refresh token is not a live token of the same family with a later expiry")
	}
	if r := s.call(t, http.MethodGet, "/v1/me", nil, second.AccessToken); r.Status != http.StatusOK {
		t.Fatalf("GET /v1/me with the rotated access token = %d: %s", r.Status, r.Body)
	}
	s.assertNotRevokedInRedis(t, sid)

	// The replay: someone else had a copy of the first token.
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": first.RefreshToken}, ""),
		http.StatusUnauthorized, "TOKEN_INVALID")
	if n := s.count(t, `SELECT count(*) FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL`, sid); n != 0 {
		t.Errorf("%d tokens of the replayed family are not revoked", n)
	}
	s.assertSessionEnded(t, second, defaultAccessTTL)
	if !strings.Contains(s.logs.String(), "refresh token reused; session revoked") {
		t.Errorf("the reuse was not logged:\n%s", s.logs.String())
	}
}

// TestRefresh_Refusals checks the refresh tokens that never rotate: 401
// TOKEN_INVALID for a malformed, unknown or wrong-secret token (a guess at
// a real id does not end the real session), TOKEN_EXPIRED after
// APP_REFRESH_TOKEN_TTL, and 400 for a body that is not a refresh.
func TestRefresh_Refusals(t *testing.T) {
	clock := &testClock{}
	s := startServer(t, map[string]string{"APP_REFRESH_TOKEN_TTL": "1h"}, withClock(clock))
	_, p := s.newAccount(t, "tolak")
	id, _ := splitOpaque(t, p.RefreshToken)

	for name, token := range map[string]string{
		"not a token":  "bukan-token",
		"no secret":    id,
		"short secret": id + ".YWJj",
		"unknown id":   uuidx.NewV7() + "." + strings.Repeat("A", 43),
		"wrong secret": id + "." + strings.Repeat("A", 43),
	} {
		t.Run(name, func(t *testing.T) {
			assertError(t, s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": token}, ""),
				http.StatusUnauthorized, "TOKEN_INVALID")
		})
	}
	// None of those touched the real session.
	if r := s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken); r.Status != http.StatusOK {
		t.Errorf("GET /v1/me after refused refreshes = %d, want the session alive: %s", r.Status, r.Body)
	}

	for _, body := range []any{map[string]string{}, map[string]string{"refresh_token": strings.Repeat("x", 201)}, `{"refresh_token":1}`} {
		assertError(t, s.call(t, http.MethodPost, "/v1/auth/refresh", body, ""), http.StatusBadRequest, "VALIDATION_FAILED")
	}

	clock.advance(time.Hour + time.Minute)
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": p.RefreshToken}, ""),
		http.StatusUnauthorized, "TOKEN_EXPIRED")
}

// TestLogout_EndsOnlyThatSession logs out without an access token: the
// session's refresh and access tokens stop at once (PostgreSQL and the
// Redis key), another session of the same account goes on, and logging out
// a garbage, unknown or already-ended token is still 204.
func TestLogout_EndsOnlyThatSession(t *testing.T) {
	s := startServer(t, nil)
	email := uniqueEmail("keluar")
	u := s.register(t, email, testPassword, "Keluar")
	phone := s.login(t, email, testPassword)
	laptop := s.login(t, email, testPassword)

	resp := s.call(t, http.MethodPost, "/v1/auth/logout", map[string]string{"refresh_token": phone.RefreshToken}, "")
	if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
		t.Fatalf("POST /v1/auth/logout = %d %q, want 204 and no body", resp.Status, resp.Body)
	}
	s.assertSessionEnded(t, phone, defaultAccessTTL)

	if r := s.call(t, http.MethodGet, "/v1/me", nil, laptop.AccessToken); r.Status != http.StatusOK {
		t.Errorf("the other session's access token = %d after logout, want 200", r.Status)
	}
	s.assertNotRevokedInRedis(t, sessionOf(t, laptop.AccessToken))
	if n := s.liveSessions(t, u.ID); n != 1 {
		t.Errorf("%d live sessions, want the laptop's only", n)
	}

	for _, token := range []string{phone.RefreshToken, "bukan-token", uuidx.NewV7() + "." + strings.Repeat("A", 43)} {
		if r := s.call(t, http.MethodPost, "/v1/auth/logout", map[string]string{"refresh_token": token}, ""); r.Status != http.StatusNoContent {
			t.Errorf("logout of %q = %d, want 204", token, r.Status)
		}
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/logout", map[string]string{}, ""), http.StatusBadRequest, "VALIDATION_FAILED")
	s.refresh(t, laptop.RefreshToken)
}

// TestRace_ConcurrentRefreshIsReuse sends the same refresh token twice at
// once, raceIterations times. The two transactions take the token's row
// one after the other, so exactly one rotates and the other is a replay:
// one 200, one 401 TOKEN_INVALID, and the whole session is revoked,
// including the winner's new tokens. This is why clients must keep one
// refresh in flight.
func TestRace_ConcurrentRefreshIsReuse(t *testing.T) {
	s := startServer(t, nil, withUnlimitedRate())
	for i := range raceIterations {
		_, p := s.newAccount(t, fmt.Sprintf("ganda-%d", i))
		var results [2]response
		var errs [2]error
		together(
			func() {
				results[0], errs[0] = s.tryCall(http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": p.RefreshToken}, "", nil)
			},
			func() {
				results[1], errs[1] = s.tryCall(http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": p.RefreshToken}, "", nil)
			},
		)
		if errs[0] != nil || errs[1] != nil {
			t.Fatalf("iteration %d: %v %v", i, errs[0], errs[1])
		}
		var winner *tokenPairOut
		for _, r := range results {
			switch r.Status {
			case http.StatusOK:
				if winner != nil {
					t.Fatalf("iteration %d: both refreshes of one token succeeded", i)
				}
				pair := decodeData[tokenPairOut](t, r.Body)
				winner = &pair
			case http.StatusUnauthorized:
				assertError(t, r, http.StatusUnauthorized, "TOKEN_INVALID")
			default:
				t.Fatalf("iteration %d: refresh = %d: %s", i, r.Status, r.Body)
			}
		}
		if winner == nil {
			t.Fatalf("iteration %d: neither refresh succeeded", i)
		}
		s.assertSessionEnded(t, *winner, defaultAccessTTL)
	}
	assertNoServerErrors(t, s)
}

// TestRace_RefreshVersusLogout (A1) keeps a client refreshing in a loop
// while the same session logs out, raceIterations times. The logout lands
// after 0 to 3 rotations and overlaps the next one. Whatever the
// interleaving, logout wins: 204, no live token in the family, the
// refresher's last refresh and access tokens are refused, and the session
// is revoked in Redis. The logout presents the original (already used)
// token on even iterations and the newest one on odd ones; both identify
// the family.
func TestRace_RefreshVersusLogout(t *testing.T) {
	s := startServer(t, nil, withUnlimitedRate())
	for i := range raceIterations {
		_, p := s.newAccount(t, fmt.Sprintf("a1-%d", i))
		chain := newRefreshChain(s, p)
		var logout response
		var logoutErr error
		together(chain.run, func() {
			chain.waitRotations(i % 4)
			token := p.RefreshToken
			if i%2 == 1 {
				token = chain.latest().RefreshToken
			}
			logout, logoutErr = s.tryCall(http.MethodPost, "/v1/auth/logout", map[string]string{"refresh_token": token}, "", nil)
		})
		if logoutErr != nil || logout.Status != http.StatusNoContent {
			t.Fatalf("iteration %d: logout = %d, %v: %s", i, logout.Status, logoutErr, logout.Body)
		}
		chain.check(t, i)
		s.assertSessionEnded(t, chain.latest(), defaultAccessTTL)
	}
	assertNoServerErrors(t, s)
}

// refreshChain is a client that refreshes its session in a loop, always
// with its newest token, until a refresh fails.
type refreshChain struct {
	s         *server
	cur       atomic.Pointer[tokenPairOut]
	rotations chan struct{}
	failed    atomic.Pointer[response]
	err       atomic.Pointer[error]
}

// maxRotations bounds a chain that is never stopped.
const maxRotations = 200

func newRefreshChain(s *server, p tokenPairOut) *refreshChain {
	c := &refreshChain{s: s, rotations: make(chan struct{}, maxRotations)}
	c.cur.Store(&p)
	return c
}

// run refreshes until a refresh is refused or maxRotations is reached.
func (c *refreshChain) run() {
	defer close(c.rotations)
	for range maxRotations {
		resp, err := c.s.tryCall(http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": c.latest().RefreshToken}, "", nil)
		if err != nil {
			c.err.Store(&err)
			return
		}
		if resp.Status != http.StatusOK {
			c.failed.Store(&resp)
			return
		}
		next, err := decodePair(resp.Body)
		if err != nil {
			c.err.Store(&err)
			return
		}
		c.cur.Store(&next)
		c.rotations <- struct{}{}
	}
}

// latest is the newest pair the chain holds.
func (c *refreshChain) latest() tokenPairOut { return *c.cur.Load() }

// waitRotations returns once the chain has rotated n times, or has
// stopped, or after 10 seconds.
func (c *refreshChain) waitRotations(n int) {
	timeout := time.After(10 * time.Second)
	for range n {
		select {
		case _, ok := <-c.rotations:
			if !ok {
				return
			}
		case <-timeout:
			return
		}
	}
}

// check fails unless the chain ended on a refused refresh (401
// TOKEN_INVALID), not on a transport error, a 5xx or maxRotations.
func (c *refreshChain) check(t *testing.T, iteration int) {
	t.Helper()
	if err := c.err.Load(); err != nil {
		t.Fatalf("iteration %d: refresher: %v", iteration, *err)
	}
	failed := c.failed.Load()
	if failed == nil {
		t.Fatalf("iteration %d: the refresher was never stopped", iteration)
	}
	assertError(t, *failed, http.StatusUnauthorized, "TOKEN_INVALID")
}

// decodePair decodes a TokenPairDetail body outside a test goroutine.
func decodePair(body []byte) (tokenPairOut, error) {
	var out struct {
		Data tokenPairOut `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return tokenPairOut{}, fmt.Errorf("decode the token pair: %w", err)
	}
	return out.Data, nil
}

// assertNoServerErrors fails when the server logged an error (every 5xx
// is logged at ERROR), a deadlock or a serialization failure: a race may
// refuse a request, never crash one.
func assertNoServerErrors(t *testing.T, s *server) {
	t.Helper()
	assertNoErrorLog(t, s)
	for line := range strings.Lines(s.logs.String()) {
		for _, bad := range []string{"SQLSTATE 40P01", "deadlock detected", "SQLSTATE 40001", "could not serialize"} {
			if strings.Contains(line, bad) {
				t.Errorf("the server logged %q during the race: %s", bad, line)
			}
		}
	}
}
