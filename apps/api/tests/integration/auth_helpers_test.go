//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The helpers in this file drive the auth endpoints over real HTTP: the
// tests register, log in and refresh exactly like a client would, and
// read the tokens the API emails from a recording mailer
// (app.WithMailer) or, for the development log mailer, from the log.

// testPassword and otherPassword are passwords the policy accepts;
// wrongPassword is one no test account has.
const (
	wrongPassword = "salah-kata-sandi-9" //nolint:gosec // not a secret

	testPassword  = "nasi-goreng-kampung-1" //nolint:gosec // a test account's password, not a secret
	otherPassword = "soto-betawi-santan-2"  //nolint:gosec // a test account's password, not a secret
)

// emailTokenPattern matches an opaque token (ADR 0005):
// <uuid>.<base64url of 32 bytes>.
var emailTokenPattern = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}`)

// uniqueEmail returns a lower-case address no other test uses.
func uniqueEmail(prefix string) string {
	return strings.ToLower(prefix + "-" + rand.Text()[:12] + "@example.com")
}

// call sends method path with body encoded as JSON (a string is sent as it
// is; nil sends no body) and token as the Bearer token when it is not
// empty. It fails the test on a transport error.
func (s *server) call(t *testing.T, method, path string, body any, token string) response {
	t.Helper()
	resp, err := s.tryCall(method, path, body, token, nil)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// tryCall is call for goroutines: it returns the error instead of failing
// the test. headers are added to the request.
func (s *server) tryCall(method, path string, body any, token string, headers map[string]string) (response, error) {
	var r io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		r = strings.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			return response{}, fmt.Errorf("marshal body: %w", err)
		}
		r = bytes.NewReader(raw)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, s.URL+path, r)
	if err != nil {
		return response{}, fmt.Errorf("new request %s %s: %w", method, path, err)
	}
	if r != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return response{}, fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return response{}, fmt.Errorf("%s %s: read body: %w", method, path, err)
	}
	return response{Status: resp.StatusCode, Header: resp.Header, Body: raw}, nil
}

// userOut is User in api/openapi.yaml.
type userOut struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	Name          string    `json:"name"`
	Phone         *string   `json:"phone"`
	Role          string    `json:"role"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
}

// tokenPairOut is TokenPair in api/openapi.yaml.
type tokenPairOut struct {
	AccessToken      string  `json:"access_token"`
	TokenType        string  `json:"token_type"`
	ExpiresIn        int64   `json:"expires_in"`
	RefreshToken     string  `json:"refresh_token"`
	RefreshExpiresIn int64   `json:"refresh_expires_in"`
	User             userOut `json:"user"`
}

// decodeData decodes {"data": …} into a value of type T.
func decodeData[T any](t *testing.T, body []byte) T {
	t.Helper()
	var out struct {
		Data T `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode {\"data\": …}: %v\n%s", err, body)
	}
	return out.Data
}

// assertUserDetail checks a UserDetail body against the contract and
// returns the user.
func assertUserDetail(t *testing.T, resp response, wantStatus int, what string) userOut {
	t.Helper()
	if resp.Status != wantStatus {
		t.Fatalf("%s = %d, want %d: %s", what, resp.Status, wantStatus, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := decodeObject(t, resp.Body)
	assertMatchesSchema(t, top, contractSchema(t, "UserDetail"), what)
	assertMatchesSchema(t, decodeObject(t, top["data"]), contractSchema(t, "User"), what+" data")
	u := decodeData[userOut](t, resp.Body)
	if !uuidPattern.MatchString(u.ID) {
		t.Errorf("%s: id %q is not a UUID", what, u.ID)
	}
	return u
}

// assertTokenPair checks a TokenPairDetail body against the contract and
// returns the tokens.
func assertTokenPair(t *testing.T, resp response, what string) tokenPairOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := decodeObject(t, resp.Body)
	assertMatchesSchema(t, top, contractSchema(t, "TokenPairDetail"), what)
	data := decodeObject(t, top["data"])
	assertMatchesSchema(t, data, contractSchema(t, "TokenPair"), what+" data")
	assertMatchesSchema(t, decodeObject(t, data["user"]), contractSchema(t, "User"), what+" data.user")
	p := decodeData[tokenPairOut](t, resp.Body)
	if p.TokenType != "Bearer" || p.AccessToken == "" || !emailTokenPattern.MatchString(p.RefreshToken) {
		t.Errorf("%s: token_type %q, access_token %q, refresh_token %q; want Bearer, a JWT and an opaque token",
			what, p.TokenType, p.AccessToken, p.RefreshToken)
	}
	return p
}

// register creates an account over HTTP and returns it.
func (s *server) register(t *testing.T, email, password, name string) userOut {
	t.Helper()
	resp := s.call(t, http.MethodPost, "/v1/auth/register",
		map[string]string{"email": email, "password": password, "name": name}, "")
	return assertUserDetail(t, resp, http.StatusCreated, "POST /v1/auth/register")
}

// login logs in over HTTP and returns the tokens.
func (s *server) login(t *testing.T, email, password string) tokenPairOut {
	t.Helper()
	resp := s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": email, "password": password}, "")
	return assertTokenPair(t, resp, "POST /v1/auth/login")
}

// newAccount registers a fresh account with testPassword and logs it in.
func (s *server) newAccount(t *testing.T, prefix string) (userOut, tokenPairOut) {
	t.Helper()
	email := uniqueEmail(prefix)
	u := s.register(t, email, testPassword, "Pengguna "+prefix)
	return u, s.login(t, email, testPassword)
}

// accountWithRole registers an account, gives it role with SQL (the API
// has no endpoint that changes a role; make seed-admin does it the same
// way) and logs it in, so the access token carries the role.
func (s *server) accountWithRole(t *testing.T, role user.Role) tokenPairOut {
	t.Helper()
	email := uniqueEmail(string(role))
	u := s.register(t, email, testPassword, "Staf "+string(role))
	mustExec(t, s.db, `UPDATE users SET role = $1 WHERE id = $2`, string(role), u.ID)
	return s.login(t, email, testPassword)
}

// actAsStaff makes every later s.send and s.do carry the access token of a
// new admin account, for the tests of the admin catalog routes.
func (s *server) actAsStaff(t *testing.T) {
	t.Helper()
	s.bearer = s.accountWithRole(t, user.RoleAdmin).AccessToken
}

// assertError fails unless resp is status with the contract's Error body
// and code, details optional, and returns the details (nil when absent).
func assertError(t *testing.T, resp response, status int, code string) map[string]any {
	t.Helper()
	if resp.Status != status {
		t.Fatalf("status = %d, want %d %s: %s", resp.Status, status, code, resp.Body)
	}
	assertJSONContentType(t, resp.Header, "error")
	outer := decodeObject(t, resp.Body)
	assertKeys(t, outer, []string{"error"}, "error body")
	errSchema := schema{Required: []string{"code", "message"}, Properties: []string{"code", "message", "details"}, NoAdditionalProperty: true}
	assertMatchesSchema(t, decodeObject(t, outer["error"]), errSchema, `error body "error"`)
	var e struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(outer["error"], &e); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if e.Code != code || e.Message == "" {
		t.Errorf("error = %s %q, want code %s and a message", e.Code, e.Message, code)
	}
	return e.Details
}

// count runs a query on the server's database that returns one integer.
func (s *server) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	return queryInt(t, s.db, query, args...)
}

// unlimited is an auth.RateLimiter that allows everything, for tests that
// send more requests from 127.0.0.1 than the real limits allow and test
// something else (validation tables, races). The rate-limit tests use the
// real Redis limiter.
type unlimited struct{}

// Allow implements auth.RateLimiter.
func (unlimited) Allow(context.Context, auth.Limit, string) (bool, time.Duration, error) {
	return true, 0, nil
}

// withUnlimitedRate is app.WithRateLimiter(unlimited{}).
func withUnlimitedRate() app.Option { return app.WithRateLimiter(unlimited{}) }

// liveSessions counts the refresh tokens of userID that still work: not
// used, not revoked. Each live one is a session that can go on.
func (s *server) liveSessions(t *testing.T, userID string) int {
	t.Helper()
	return s.count(t, `SELECT count(*) FROM refresh_tokens
		WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, userID)
}

// revokedKey is the Redis key of a revoked session (ADR 0005).
func revokedKey(sessionID string) string { return "goshop:session-revoked:" + sessionID }

// sessionOf is the session (refresh-token family) an access token belongs
// to: its sid claim.
func sessionOf(t *testing.T, accessToken string) string {
	t.Helper()
	sid, _ := jwtClaims(t, accessToken)["sid"].(string)
	if sid == "" {
		t.Fatalf("access token has no sid claim")
	}
	return sid
}

// assertRevokedInRedis fails unless session's revocation key is in the
// server's Redis with a TTL of at most one access-token lifetime, after
// which every access token of the session has expired on its own.
func (s *server) assertRevokedInRedis(t *testing.T, session string, accessTTL time.Duration) {
	t.Helper()
	ttl, err := s.rdb.TTL(t.Context(), revokedKey(session)).Result()
	if err != nil {
		t.Fatalf("TTL %s: %v", revokedKey(session), err)
	}
	if ttl <= 0 || ttl > accessTTL {
		t.Errorf("%s: TTL %s, want a key that lives at most %s (-2s means no key)", revokedKey(session), ttl, accessTTL)
	}
}

// assertNotRevokedInRedis fails when session has a revocation key.
func (s *server) assertNotRevokedInRedis(t *testing.T, session string) {
	t.Helper()
	if n, err := s.rdb.Exists(t.Context(), revokedKey(session)).Result(); err != nil || n != 0 {
		t.Errorf("%s exists (%d, err %v), want the session not revoked", revokedKey(session), n, err)
	}
}

// assertSessionEnded fails unless the session of p is over everywhere: its
// refresh token is refused, its access token is refused, no token of its
// family is live in PostgreSQL, and Redis holds its revocation.
func (s *server) assertSessionEnded(t *testing.T, p tokenPairOut, accessTTL time.Duration) {
	t.Helper()
	sid := sessionOf(t, p.AccessToken)
	if n := s.count(t, `SELECT count(*) FROM refresh_tokens WHERE family_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, sid); n != 0 {
		t.Errorf("session %s has %d live refresh tokens, want 0", sid, n)
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": p.RefreshToken}, ""),
		http.StatusUnauthorized, "TOKEN_INVALID")
	me := s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken)
	assertError(t, me, http.StatusUnauthorized, "UNAUTHORIZED")
	s.assertRevokedInRedis(t, sid, accessTTL)
}

// refresh rotates p's refresh token over HTTP and returns the new pair.
func (s *server) refresh(t *testing.T, refreshToken string) tokenPairOut {
	t.Helper()
	resp := s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": refreshToken}, "")
	return assertTokenPair(t, resp, "POST /v1/auth/refresh")
}

// defaultAccessTTL is APP_ACCESS_TOKEN_TTL when a test does not set it.
const defaultAccessTTL = 15 * time.Minute

// testClock is a clock a test moves forward (app.WithClock), so tokens
// expire without waiting. It never goes back: sdk jwtx checks an access
// token's exp against the wall clock (docs/sdk-gaps.md).
type testClock struct{ offset atomic.Int64 }

// now is the wall clock plus every advance so far.
func (c *testClock) now() time.Time { return time.Now().Add(time.Duration(c.offset.Load())) }

// advance moves the clock forward by d.
func (c *testClock) advance(d time.Duration) { c.offset.Add(int64(d)) }

// raceIterations is how many times each race test repeats its race. Each
// iteration is a fresh account, released at a barrier, and judged on the
// state PostgreSQL and Redis end in, never on timing.
const raceIterations = 25

// together runs every fn in a goroutine of its own, releases them all at
// once from a barrier, and waits for every one to return. fns must not
// call t.Fatal; they record what they saw for the test to check after.
func together(fns ...func()) {
	var ready, done sync.WaitGroup
	start := make(chan struct{})
	for _, fn := range fns {
		ready.Add(1)
		done.Add(1)
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			fn()
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()
}

// withClock is app.WithClock(c.now).
func withClock(c *testClock) app.Option { return app.WithClock(c.now) }

// recordingMailer is a mail.Mailer that keeps every message, so a test can
// read the token an email carries.
type recordingMailer struct {
	mu   sync.Mutex
	sent []mail.Message
}

var _ mail.Mailer = (*recordingMailer)(nil)

// Send implements mail.Mailer.
func (m *recordingMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

// messages returns the messages sent to to, oldest first.
func (m *recordingMailer) messages(to string) []mail.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []mail.Message
	for _, msg := range m.sent {
		if msg.To == to {
			out = append(out, msg)
		}
	}
	return out
}

// Subjects of the two emails Bab 4 sends (auth/service.go).
const (
	subjectVerify = "Verifikasi email"
	subjectReset  = "Atur ulang kata sandi"
)

// tokens returns every token emailed to to under a subject starting with
// subject, oldest first.
func (m *recordingMailer) tokens(to, subject string) []string {
	var out []string
	for _, msg := range m.messages(to) {
		if strings.HasPrefix(msg.Subject, subject) {
			if tok := emailTokenPattern.FindString(msg.Body); tok != "" {
				out = append(out, tok)
			}
		}
	}
	return out
}

// lastToken is the newest token emailed to to under subject; it fails the
// test when there is none.
func (m *recordingMailer) lastToken(t *testing.T, to, subject string) string {
	t.Helper()
	toks := m.tokens(to, subject)
	if len(toks) == 0 {
		t.Fatalf("no %q email with a token was sent to %s", subject, to)
	}
	return toks[len(toks)-1]
}
