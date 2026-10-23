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
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The helpers in this file drive the auth endpoints over real HTTP: the
// tests register, log in and refresh exactly like a client would, and
// read the tokens the API emails from a recording mailer
// (app.WithMailer) or, for the development log mailer, from the log.

// testPassword is a password the policy accepts.
const testPassword = "nasi-goreng-kampung-1" //nolint:gosec // a test account's password, not a secret

// emailTokenPattern matches an opaque token (ADR 0005):
// <uuid>.<base64url of 32 bytes>.
var emailTokenPattern = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}`)

// uniqueEmail returns an address no other test uses.
func uniqueEmail(prefix string) string {
	return prefix + "-" + strings.ToLower(rand.Text()[:12]) + "@example.com"
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
