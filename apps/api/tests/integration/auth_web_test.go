//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/auth"
)

// The web session (Bab 10, ADR 0008): /v1/auth/web/{login,refresh,logout}
// keep the refresh token in the goshop_refresh cookie. These tests drive
// them over real HTTP against real PostgreSQL and Redis, sending the
// cookie by hand exactly as a browser would, so every Set-Cookie the API
// writes is checked rather than absorbed by a cookie jar.

// webOrigin is the storefront origin the web test servers allow.
const webOrigin = "http://localhost:5173"

// webEnv is the environment of a web session test server: the storefront
// origin allowed, plus extra.
func webEnv(extra map[string]string) map[string]string {
	env := map[string]string{"APP_CORS_ALLOWED_ORIGINS": webOrigin}
	for k, v := range extra {
		env[k] = v
	}
	return env
}

// webHeaders is what the storefront sends: X-GoShop-Client: web, its
// Origin, and a goshop_refresh cookie for each value in cookies, in order.
func webHeaders(cookies ...string) http.Header {
	h := http.Header{}
	h.Set(auth.WebClientHeader, auth.WebClientValue)
	h.Set("Origin", webOrigin)
	if len(cookies) > 0 {
		parts := make([]string, len(cookies))
		for i, c := range cookies {
			parts[i] = auth.WebCookieName + "=" + c
		}
		h.Set("Cookie", strings.Join(parts, "; "))
	}
	return h
}

// webPost sends POST path with exactly the headers h (several values of one
// header are sent as several header lines) and body encoded as JSON (nil
// sends no body, a string is sent as it is).
func (s *server) webPost(t *testing.T, path string, body any, h http.Header) response {
	t.Helper()
	var r io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		r = strings.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			t.Fatal(err)
		}
		r = bytes.NewReader(raw)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.URL+path, r)
	if err != nil {
		t.Fatal(err)
	}
	if r != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, vs := range h {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	resp, err := s.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response{Status: resp.StatusCode, Header: resp.Header, Body: raw}
}

// webLogin logs email in through /v1/auth/web/login and returns the
// session's access token and refresh cookie.
func (s *server) webLogin(t *testing.T, email, password string) (string, *http.Cookie) {
	t.Helper()
	resp := s.webPost(t, "/v1/auth/web/login", map[string]string{"email": email, "password": password}, webHeaders())
	access := assertWebSession(t, resp, "POST /v1/auth/web/login")
	return access, refreshCookieOf(t, resp, "POST /v1/auth/web/login")
}

// webRefresh rotates cookie through /v1/auth/web/refresh and returns the
// new access token and cookie.
func (s *server) webRefresh(t *testing.T, cookie string) (string, *http.Cookie) {
	t.Helper()
	resp := s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders(cookie))
	access := assertWebSession(t, resp, "POST /v1/auth/web/refresh")
	return access, refreshCookieOf(t, resp, "POST /v1/auth/web/refresh")
}

// assertWebSession checks a 200 WebSessionDetail body against the contract
// (no refresh token in it) and returns the access token.
func assertWebSession(t *testing.T, resp response, what string) string {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := decodeObject(t, resp.Body)
	assertMatchesSchema(t, top, contractSchema(t, "WebSessionDetail"), what)
	data := decodeObject(t, top["data"])
	assertMatchesSchema(t, data, contractSchema(t, "WebSession"), what+" data")
	assertMatchesSchema(t, decodeObject(t, data["user"]), contractSchema(t, "User"), what+" data.user")
	var out struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(data["access_token"], &out.AccessToken); err != nil || out.AccessToken == "" {
		t.Fatalf("%s: no access_token: %s", what, resp.Body)
	}
	if emailTokenPattern.Match(resp.Body) {
		t.Errorf("%s: the body holds an opaque refresh token: %s", what, resp.Body)
	}
	return out.AccessToken
}

// setCookies returns every goshop_refresh cookie resp sets.
func setCookies(t *testing.T, resp response) []*http.Cookie {
	t.Helper()
	var out []*http.Cookie
	for _, line := range resp.Header.Values("Set-Cookie") {
		c, err := http.ParseSetCookie(line)
		if err != nil {
			t.Fatalf("Set-Cookie %q: %v", line, err)
		}
		if c.Name == auth.WebCookieName {
			out = append(out, c)
		}
	}
	return out
}

// assertCookieAttributes fails unless c carries the cookie's fixed
// attributes: host-only, Path=/v1/auth/web, HttpOnly, Secure (unless
// insecure), SameSite=Strict.
func assertCookieAttributes(t *testing.T, c *http.Cookie, secure bool, what string) {
	t.Helper()
	if c.Path != auth.WebCookiePath || c.Domain != "" || !c.HttpOnly || c.Secure != secure || c.SameSite != http.SameSiteStrictMode {
		t.Errorf("%s: cookie %q, want Path=%s, no Domain, HttpOnly, Secure=%v, SameSite=Strict",
			what, c.Raw, auth.WebCookiePath, secure)
	}
}

// refreshCookieOf returns the one goshop_refresh cookie resp sets, after
// checking it holds an opaque token with the production attributes.
func refreshCookieOf(t *testing.T, resp response, what string) *http.Cookie {
	t.Helper()
	cs := setCookies(t, resp)
	if len(cs) != 1 {
		t.Fatalf("%s: %d goshop_refresh cookies set, want 1: %q", what, len(cs), resp.Header.Values("Set-Cookie"))
	}
	c := cs[0]
	if !emailTokenPattern.MatchString(c.Value) || c.Value != emailTokenPattern.FindString(c.Value) {
		t.Errorf("%s: cookie value %q is not an opaque token", what, c.Value)
	}
	assertCookieAttributes(t, c, true, what)
	return c
}

// assertCookieMaxAge fails unless c lives for ttl, give or take the
// seconds a test takes.
func assertCookieMaxAge(t *testing.T, c *http.Cookie, ttl time.Duration, what string) {
	t.Helper()
	want := int(ttl / time.Second)
	if c.MaxAge > want || c.MaxAge < want-5 {
		t.Errorf("%s: Max-Age %d, want about %d (APP_REFRESH_TOKEN_TTL)", what, c.MaxAge, want)
	}
}

// assertCookieCleared fails unless resp deletes the cookie: one
// goshop_refresh with an empty value, Max-Age=0 and the same attributes.
func assertCookieCleared(t *testing.T, resp response, what string) {
	t.Helper()
	cs := setCookies(t, resp)
	if len(cs) != 1 {
		t.Fatalf("%s: %d goshop_refresh cookies set, want 1 that clears it: %q", what, len(cs), resp.Header.Values("Set-Cookie"))
	}
	c := cs[0]
	// net/http parses Max-Age=0 as MaxAge -1 ("delete now").
	if c.Value != "" || c.MaxAge >= 0 || !strings.Contains(c.Raw, "Max-Age=0") {
		t.Errorf("%s: cookie %q, want an empty value and Max-Age=0", what, c.Raw)
	}
	assertCookieAttributes(t, c, true, what)
}

// assertNoCookie fails when resp sets any goshop_refresh cookie.
func assertNoCookie(t *testing.T, resp response, what string) {
	t.Helper()
	if cs := setCookies(t, resp); len(cs) != 0 {
		t.Errorf("%s: Set-Cookie %q, want none", what, resp.Header.Values("Set-Cookie"))
	}
}

// rateLimitKeys returns the Redis rate-limit counters of the server.
func (s *server) rateLimitKeys(t *testing.T) []string {
	t.Helper()
	keys, err := s.rdb.Keys(t.Context(), "goshop:rl:*").Result()
	if err != nil {
		t.Fatal(err)
	}
	return keys
}

// TestWebSession_LoginRefreshReuse walks one browser session: web login
// sets the cookie (attributes, Max-Age = APP_REFRESH_TOKEN_TTL), its access
// token works, web refresh rotates the cookie within the same session, and
// replaying the old cookie revokes the family: the old and then the new
// cookie get 401 with the cookie cleared, and the session's access token
// gets 401 on /v1/me.
func TestWebSession_LoginRefreshReuse(t *testing.T) {
	const ttl = 2 * time.Hour
	s := startServer(t, webEnv(map[string]string{"APP_REFRESH_TOKEN_TTL": ttl.String()}))
	email := uniqueEmail("web-sesi")
	u := s.register(t, email, testPassword, "Web Sesi")

	access1, c1 := s.webLogin(t, email, testPassword)
	assertCookieMaxAge(t, c1, ttl, "web login")
	sid := sessionOf(t, access1)
	if me := assertUserDetail(t, s.call(t, http.MethodGet, "/v1/me", nil, access1), http.StatusOK, "GET /v1/me"); me.ID != u.ID {
		t.Errorf("GET /v1/me = user %s, want %s", me.ID, u.ID)
	}
	if n := s.liveSessions(t, u.ID); n != 1 {
		t.Errorf("%d live sessions after web login, want 1", n)
	}

	access2, c2 := s.webRefresh(t, c1.Value)
	assertCookieMaxAge(t, c2, ttl, "web refresh")
	if c2.Value == c1.Value || access2 == access1 {
		t.Fatal("web refresh returned the same cookie or access token")
	}
	if got := sessionOf(t, access2); got != sid {
		t.Errorf("rotated access token is session %s, want %s", got, sid)
	}
	if r := s.call(t, http.MethodGet, "/v1/me", nil, access2); r.Status != http.StatusOK {
		t.Fatalf("GET /v1/me with the rotated access token = %d: %s", r.Status, r.Body)
	}
	s.assertNotRevokedInRedis(t, sid)

	// Someone replays the old cookie: the whole family ends.
	old := s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders(c1.Value))
	assertError(t, old, http.StatusUnauthorized, "TOKEN_INVALID")
	assertCookieCleared(t, old, "replayed cookie")
	cur := s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders(c2.Value))
	assertError(t, cur, http.StatusUnauthorized, "TOKEN_INVALID")
	assertCookieCleared(t, cur, "newest cookie after the replay")
	s.assertSessionEnded(t, tokenPairOut{AccessToken: access2, RefreshToken: c2.Value}, defaultAccessTTL)
	assertError(t, s.call(t, http.MethodGet, "/v1/me", nil, access1), http.StatusUnauthorized, "UNAUTHORIZED")
	if !strings.Contains(s.logs.String(), "refresh token reused; session revoked") {
		t.Errorf("the reuse was not logged:\n%s", s.logs.String())
	}
}

// TestWebSession_LoginRefusalsSetNoCookie: a wrong password and an
// invalid body are the JSON login's errors, and neither sets a cookie; a
// cookie sent with web login is ignored (the new one replaces it).
func TestWebSession_LoginRefusalsSetNoCookie(t *testing.T) {
	s := startServer(t, webEnv(nil))
	email := uniqueEmail("web-tolak")
	s.register(t, email, testPassword, "Web Tolak")

	wrong := s.webPost(t, "/v1/auth/web/login", map[string]string{"email": email, "password": wrongPassword}, webHeaders())
	assertError(t, wrong, http.StatusUnauthorized, "INVALID_CREDENTIALS")
	assertNoCookie(t, wrong, "wrong password")
	bad := s.webPost(t, "/v1/auth/web/login", map[string]string{"email": email, "password": ""}, webHeaders())
	assertError(t, bad, http.StatusBadRequest, "VALIDATION_FAILED")
	assertNoCookie(t, bad, "invalid body")

	_, first := s.webLogin(t, email, testPassword)
	resp := s.webPost(t, "/v1/auth/web/login", map[string]string{"email": email, "password": testPassword}, webHeaders(first.Value))
	assertWebSession(t, resp, "web login with a cookie")
	if second := refreshCookieOf(t, resp, "web login with a cookie"); second.Value == first.Value {
		t.Error("web login with a cookie kept the old cookie")
	}
	// The ignored cookie's session is untouched: it still refreshes.
	s.webRefresh(t, first.Value)
}

// TestWebSession_Logout: web logout ends the cookie's session (its refresh
// cookie and its access token are refused) and clears the cookie; another
// session of the account goes on; logging out without a cookie, or with an
// ended one, is still 204 with the cookie cleared.
func TestWebSession_Logout(t *testing.T) {
	s := startServer(t, webEnv(nil))
	email := uniqueEmail("web-keluar")
	u := s.register(t, email, testPassword, "Web Keluar")
	access, c := s.webLogin(t, email, testPassword)
	otherAccess, other := s.webLogin(t, email, testPassword)

	resp := s.webPost(t, "/v1/auth/web/logout", nil, webHeaders(c.Value))
	if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
		t.Fatalf("web logout = %d %q, want 204 and no body", resp.Status, resp.Body)
	}
	assertCookieCleared(t, resp, "web logout")

	after := s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders(c.Value))
	assertError(t, after, http.StatusUnauthorized, "TOKEN_INVALID")
	assertCookieCleared(t, after, "refresh after logout")
	assertError(t, s.call(t, http.MethodGet, "/v1/me", nil, access), http.StatusUnauthorized, "UNAUTHORIZED")
	s.assertRevokedInRedis(t, sessionOf(t, access), defaultAccessTTL)

	if r := s.call(t, http.MethodGet, "/v1/me", nil, otherAccess); r.Status != http.StatusOK {
		t.Errorf("the other session's access token = %d after logout, want 200", r.Status)
	}
	if n := s.liveSessions(t, u.ID); n != 1 {
		t.Errorf("%d live sessions, want the other one only", n)
	}

	for name, h := range map[string]http.Header{"no cookie": webHeaders(), "ended cookie": webHeaders(c.Value)} {
		r := s.webPost(t, "/v1/auth/web/logout", nil, h)
		if r.Status != http.StatusNoContent {
			t.Errorf("web logout with %s = %d, want 204: %s", name, r.Status, r.Body)
		}
		assertCookieCleared(t, r, "web logout with "+name)
	}
	s.webRefresh(t, other.Value)
}

// TestWebSession_RefreshWithoutCookie: a visitor who is not logged in gets
// 204 with no body and no Set-Cookie, an empty cookie counts as none, and
// none of it is counted: more requests than the refresh limit allows all
// pass, and Redis holds no counter.
func TestWebSession_RefreshWithoutCookie(t *testing.T) {
	s := startServer(t, webEnv(nil))
	for i := range auth.LimitRefreshPerIP.Max + 5 {
		h := webHeaders()
		if i%2 == 1 {
			h.Set("Cookie", auth.WebCookieName+"=")
		}
		resp := s.webPost(t, "/v1/auth/web/refresh", nil, h)
		if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
			t.Fatalf("request %d: web refresh without a cookie = %d %q, want 204 and no body", i+1, resp.Status, resp.Body)
		}
		assertNoCookie(t, resp, "web refresh without a cookie")
	}
	if keys := s.rateLimitKeys(t); len(keys) != 0 {
		t.Errorf("rate-limit counters %v after refreshes without a cookie, want none", keys)
	}
}

// TestWebSession_SharedRateLimits: the web endpoints spend the JSON
// endpoints' counters, so switching endpoint does not buy more attempts.
// Each subtest has a server (and Redis database) of its own.
func TestWebSession_SharedRateLimits(t *testing.T) {
	t.Run("login per email", func(t *testing.T) {
		s := startServer(t, webEnv(nil))
		email := uniqueEmail("web-batas")
		s.register(t, email, testPassword, "Web Batas")
		body := map[string]string{"email": email, "password": wrongPassword}
		exhaust(t, auth.LimitLoginPerEmail, func(i int) response {
			if i%2 == 0 {
				return s.call(t, http.MethodPost, "/v1/auth/login", body, "")
			}
			return s.webPost(t, "/v1/auth/web/login", body, webHeaders())
		})
		web := s.webPost(t, "/v1/auth/web/login", map[string]string{"email": email, "password": testPassword}, webHeaders())
		assertRateLimited(t, web, auth.LimitLoginPerEmail.Window, "web login with the right password while limited")
		assertNoCookie(t, web, "limited web login")
		s.assertCounter(t, auth.LimitLoginPerEmail)
	})
	t.Run("login per IP", func(t *testing.T) {
		s := startServer(t, webEnv(nil))
		exhaust(t, auth.LimitLoginPerIP, func(i int) response {
			body := map[string]string{"email": uniqueEmail("web-ip"), "password": testPassword}
			if i%2 == 0 {
				return s.webPost(t, "/v1/auth/web/login", body, webHeaders())
			}
			return s.call(t, http.MethodPost, "/v1/auth/login", body, "")
		})
		assertRateLimited(t, s.call(t, http.MethodPost, "/v1/auth/login",
			map[string]string{"email": uniqueEmail("web-ip"), "password": testPassword}, ""),
			auth.LimitLoginPerIP.Window, "JSON login after the web logins")
		s.assertCounter(t, auth.LimitLoginPerIP)
	})
	t.Run("refresh per IP", func(t *testing.T) {
		s := startServer(t, webEnv(nil))
		exhaust(t, auth.LimitRefreshPerIP, func(i int) response {
			if i%2 == 0 {
				return s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders("bukan-token"))
			}
			return s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": "bukan-token"}, "")
		})
		// 429 keeps the cookie: the token may still be good.
		limited := s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders("bukan-token"))
		assertRateLimited(t, limited, auth.LimitRefreshPerIP.Window, "web refresh after the limit")
		assertNoCookie(t, limited, "limited web refresh")
		if got := limited.Header.Get("Access-Control-Allow-Origin"); got != webOrigin {
			t.Errorf("Access-Control-Allow-Origin on the web 429 = %q, want %q", got, webOrigin)
		}
		s.assertCounter(t, auth.LimitRefreshPerIP)
	})
}

// TestWebSession_CSRFRefusals: without exactly one X-GoShop-Client: web,
// or with an Origin that is not configured, all three endpoints answer 403
// FORBIDDEN with the reason, before anything else: no Set-Cookie, no
// rate-limit counter, no session created or ended. An allowed Origin in
// another case, and no Origin at all, pass.
func TestWebSession_CSRFRefusals(t *testing.T) {
	s := startServer(t, webEnv(nil))
	email := uniqueEmail("web-csrf")
	u := s.register(t, email, testPassword, "Web CSRF")
	_, c := s.webLogin(t, email, testPassword)
	if err := s.rdb.FlushDB(t.Context()).Err(); err != nil { // forget the login's counters
		t.Fatal(err)
	}

	refusals := []struct {
		name   string
		header func(h http.Header)
		reason string
	}{
		{"no client header", func(h http.Header) { h.Del(auth.WebClientHeader) }, "client_header"},
		{"wrong client value", func(h http.Header) { h.Set(auth.WebClientHeader, "mobile") }, "client_header"},
		{"client value in another case", func(h http.Header) { h.Set(auth.WebClientHeader, "Web") }, "client_header"},
		{"two client headers", func(h http.Header) { h.Add(auth.WebClientHeader, auth.WebClientValue) }, "client_header"},
		{"foreign origin", func(h http.Header) { h.Set("Origin", "https://evil.example.com") }, "origin"},
		{"same site, other port", func(h http.Header) { h.Set("Origin", "http://localhost:5174") }, "origin"},
		{"null origin", func(h http.Header) { h.Set("Origin", "null") }, "origin"},
		{"two origins", func(h http.Header) { h.Add("Origin", webOrigin) }, "origin"},
	}
	endpoints := []struct {
		path string
		body any
	}{
		{"/v1/auth/web/login", map[string]string{"email": email, "password": testPassword}},
		{"/v1/auth/web/refresh", nil},
		{"/v1/auth/web/logout", nil},
	}
	for _, ep := range endpoints {
		for _, tt := range refusals {
			t.Run(ep.path+" "+tt.name, func(t *testing.T) {
				h := webHeaders(c.Value)
				tt.header(h)
				resp := s.webPost(t, ep.path, ep.body, h)
				details := assertError(t, resp, http.StatusForbidden, "FORBIDDEN")
				if details["reason"] != tt.reason {
					t.Errorf("details.reason = %v, want %s", details["reason"], tt.reason)
				}
				assertNoCookie(t, resp, tt.name)
			})
		}
	}
	if keys := s.rateLimitKeys(t); len(keys) != 0 {
		t.Errorf("rate-limit counters %v after refused requests, want none", keys)
	}
	if n := s.liveSessions(t, u.ID); n != 1 {
		t.Errorf("%d live sessions after refused requests, want the one from the login", n)
	}

	// The same cookie still works: no refusal touched it. An allowed
	// origin in another case, and a request with no Origin, pass.
	h := webHeaders(c.Value)
	h.Set("Origin", strings.ToUpper(webOrigin))
	assertWebSession(t, s.webPost(t, "/v1/auth/web/login", map[string]string{"email": email, "password": testPassword}, h),
		"web login from the allowed origin in upper case")
	h = webHeaders(c.Value)
	h.Del("Origin")
	assertWebSession(t, s.webPost(t, "/v1/auth/web/refresh", nil, h), "web refresh without Origin")
}

// TestWebSession_CORS: preflights and responses under /v1/auth/web/ allow
// credentials, POST and X-GoShop-Client for the configured origin only;
// every other path keeps the credential-less policy.
func TestWebSession_CORS(t *testing.T) {
	s := startServer(t, webEnv(nil))
	preflight := func(t *testing.T, origin, path, method, headers string) response {
		t.Helper()
		return s.do(t, http.MethodOptions, path, map[string]string{
			"Origin":                         origin,
			"Access-Control-Request-Method":  method,
			"Access-Control-Request-Headers": headers,
		})
	}

	for _, path := range []string{"/v1/auth/web/login", "/v1/auth/web/refresh", "/v1/auth/web/logout"} {
		t.Run("preflight "+path, func(t *testing.T) {
			resp := preflight(t, webOrigin, path, http.MethodPost, "content-type,x-goshop-client")
			if resp.Status != http.StatusOK && resp.Status != http.StatusNoContent {
				t.Fatalf("preflight = %d, want 200 or 204: %s", resp.Status, resp.Body)
			}
			h := resp.Header
			if got := h.Get("Access-Control-Allow-Origin"); got != webOrigin {
				t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, webOrigin)
			}
			if got := h.Get("Access-Control-Allow-Credentials"); got != "true" {
				t.Errorf("Access-Control-Allow-Credentials = %q, want true", got)
			}
			if got := h.Get("Access-Control-Allow-Methods"); got != http.MethodPost {
				t.Errorf("Access-Control-Allow-Methods = %q, want POST", got)
			}
			if got := strings.ToLower(h.Get("Access-Control-Allow-Headers")); !strings.Contains(got, "x-goshop-client") {
				t.Errorf("Access-Control-Allow-Headers = %q, want x-goshop-client", got)
			}
		})
	}
	t.Run("preflight from a foreign origin", func(t *testing.T) {
		assertNoCORS(t, preflight(t, "https://evil.example.com", "/v1/auth/web/refresh", http.MethodPost, "x-goshop-client"))
	})
	t.Run("preflight for a method other than POST", func(t *testing.T) {
		resp := preflight(t, webOrigin, "/v1/auth/web/refresh", http.MethodGet, "x-goshop-client")
		if resp.Header.Get("Access-Control-Allow-Credentials") != "" || resp.Header.Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("GET preflight on a web path got CORS headers: %v", resp.Header)
		}
	})
	t.Run("public paths allow no credentials", func(t *testing.T) {
		for _, path := range []string{"/v1/auth/login", "/v1/auth/refresh", "/v1/categories", "/v1/auth/webx"} {
			resp := preflight(t, webOrigin, path, http.MethodPost, "content-type")
			if got := resp.Header.Get("Access-Control-Allow-Credentials"); got != "" {
				t.Errorf("%s: Access-Control-Allow-Credentials = %q, want none", path, got)
			}
			resp = preflight(t, webOrigin, path, http.MethodPost, "content-type,x-goshop-client")
			if got := strings.ToLower(resp.Header.Get("Access-Control-Allow-Headers")); strings.Contains(got, "x-goshop-client") {
				t.Errorf("%s: Access-Control-Allow-Headers = %q, want no x-goshop-client", path, got)
			}
		}
	})
	t.Run("responses", func(t *testing.T) {
		resp := s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders())
		if resp.Header.Get("Access-Control-Allow-Origin") != webOrigin || resp.Header.Get("Access-Control-Allow-Credentials") != "true" {
			t.Errorf("web refresh: Allow-Origin %q, Allow-Credentials %q; want %s and true",
				resp.Header.Get("Access-Control-Allow-Origin"), resp.Header.Get("Access-Control-Allow-Credentials"), webOrigin)
		}
		assertExposes(t, resp, "X-Request-ID", "Retry-After")
		pub := s.do(t, http.MethodGet, "/v1/categories", map[string]string{"Origin": webOrigin})
		if got := pub.Header.Get("Access-Control-Allow-Credentials"); got != "" {
			t.Errorf("GET /v1/categories: Access-Control-Allow-Credentials = %q, want none", got)
		}
	})
}

// TestWebSession_TwoCookies: a second goshop_refresh cookie can only have
// been planted (cookie tossing), so web refresh uses neither: 401
// TOKEN_INVALID, the cookie cleared, a warning logged, and neither session
// rotated. Web logout revokes every presented session.
func TestWebSession_TwoCookies(t *testing.T) {
	s := startServer(t, webEnv(nil))
	victimEmail, attackerEmail := uniqueEmail("korban"), uniqueEmail("penyerang")
	victim := s.register(t, victimEmail, testPassword, "Korban")
	attacker := s.register(t, attackerEmail, testPassword, "Penyerang")
	victimAccess, vc := s.webLogin(t, victimEmail, testPassword)
	attackerAccess, ac := s.webLogin(t, attackerEmail, testPassword)

	for _, order := range [][]string{{ac.Value, vc.Value}, {vc.Value, ac.Value}} {
		resp := s.webPost(t, "/v1/auth/web/refresh", nil, webHeaders(order...))
		assertError(t, resp, http.StatusUnauthorized, "TOKEN_INVALID")
		assertCookieCleared(t, resp, "two cookies")
	}
	if !strings.Contains(s.logs.String(), "several goshop_refresh cookies") {
		t.Errorf("the planted cookie was not logged:\n%s", s.logs.String())
	}
	if s.liveSessions(t, victim.ID) != 1 || s.liveSessions(t, attacker.ID) != 1 {
		t.Error("a refresh with two cookies rotated or ended a session")
	}
	// Each cookie on its own still works.
	_, vc2 := s.webRefresh(t, vc.Value)
	_, ac2 := s.webRefresh(t, ac.Value)

	resp := s.webPost(t, "/v1/auth/web/logout", nil, webHeaders(ac2.Value, vc2.Value))
	if resp.Status != http.StatusNoContent {
		t.Fatalf("web logout with two cookies = %d, want 204: %s", resp.Status, resp.Body)
	}
	assertCookieCleared(t, resp, "web logout with two cookies")
	for name, id := range map[string]string{"victim": victim.ID, "attacker": attacker.ID} {
		if n := s.liveSessions(t, id); n != 0 {
			t.Errorf("%s has %d live sessions after the logout, want 0", name, n)
		}
	}
	for _, a := range []string{victimAccess, attackerAccess} {
		assertError(t, s.call(t, http.MethodGet, "/v1/me", nil, a), http.StatusUnauthorized, "UNAUTHORIZED")
	}
}

// TestWebSession_InsecureCookieInDevelopment: APP_AUTH_COOKIE_SECURE=false
// (development only) drops Secure and nothing else.
func TestWebSession_InsecureCookieInDevelopment(t *testing.T) {
	s := startServer(t, webEnv(map[string]string{"APP_AUTH_COOKIE_SECURE": "false"}))
	email := uniqueEmail("web-http")
	s.register(t, email, testPassword, "Web HTTP")
	resp := s.webPost(t, "/v1/auth/web/login", map[string]string{"email": email, "password": testPassword}, webHeaders())
	assertWebSession(t, resp, "web login")
	cs := setCookies(t, resp)
	if len(cs) != 1 {
		t.Fatalf("%d cookies, want 1", len(cs))
	}
	assertCookieAttributes(t, cs[0], false, "insecure web login")
	if !strings.Contains(s.logs.String(), "APP_AUTH_COOKIE_SECURE=false") {
		t.Errorf("no start-up warning for the insecure cookie:\n%s", s.logs.String())
	}
}
