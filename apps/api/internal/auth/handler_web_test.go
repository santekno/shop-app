package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The web session (Bab 10, ADR 0008): /v1/auth/web/{login,refresh,logout}
// behind requireWebClient, with the refresh token in the goshop_refresh
// cookie.

const webOrigin = "https://shop.example.com"

// The exact Set-Cookie lines. The default handler has Secure on.
const (
	wantRotatedCookie = "goshop_refresh=" + id3 + ".secret; Path=/v1/auth/web; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict"
	wantClearedCookie = "goshop_refresh=; Path=/v1/auth/web; Max-Age=0; HttpOnly; Secure; SameSite=Strict"
)

// newWebEnv is a handlerEnv whose Handler has the given web settings.
func newWebEnv(web WebSession) *handlerEnv {
	env := newHandlerEnv(0)
	now := env.now
	env.h = NewHandler(HandlerDeps{
		Service: env.svc, Validator: httpapi.NewValidator(), Limiter: env.limiter,
		Clock: func() time.Time { return now }, WebSession: web,
	})
	return env
}

// webRouter mounts the handler's public routes under /v1, so the web
// endpoints run behind requireWebClient as in the API.
func webRouter(env *handlerEnv) http.Handler {
	r := chi.NewRouter()
	r.Route("/v1", env.h.Routes)
	return r
}

// webRequest is a POST from the storefront: X-GoShop-Client: web, the
// allowed Origin, a JSON body and the client address 203.0.113.7. change
// adjusts it before it is sent.
func webRequest(ctx context.Context, path, body string, change func(*http.Request)) *http.Request {
	r := httptest.NewRequestWithContext(ctx, http.MethodPost, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set(WebClientHeader, WebClientValue)
	r.Header.Set("Origin", webOrigin)
	r.RemoteAddr = "203.0.113.7:4321"
	if change != nil {
		change(r)
	}
	return r
}

// sendWeb serves r through the router.
func sendWeb(env *handlerEnv, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	webRouter(env).ServeHTTP(rec, r)
	return rec
}

// withCookies adds one goshop_refresh cookie per value, in order, as
// separate cookie pairs in one Cookie header (what a browser sends).
func withCookies(values ...string) func(*http.Request) {
	return func(r *http.Request) {
		pairs := make([]string, 0, len(values))
		for _, v := range values {
			pairs = append(pairs, WebCookieName+"="+v)
		}
		r.Header.Set("Cookie", strings.Join(pairs, "; "))
	}
}

func setCookies(rec *httptest.ResponseRecorder) []string {
	return rec.Result().Header.Values("Set-Cookie")
}

// assertSetCookie checks that the response set exactly the cookie want.
func assertSetCookie(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	got := setCookies(rec)
	testx.AssertEqual(t, len(got), 1, "Set-Cookie: %q", got)
	if len(got) == 1 {
		testx.AssertEqual(t, got[0], want)
	}
}

func assertNoSetCookie(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	testx.AssertEqual(t, len(setCookies(rec)), 0, "Set-Cookie: %q", setCookies(rec))
}

// assertWebSessionBody checks the WebSession body: the access token and
// the user, and no refresh token in any form.
func assertWebSessionBody(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var body struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	keys := make([]string, 0, len(body.Data))
	for k := range body.Data {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	testx.AssertEqual(t, strings.Join(keys, ","), "access_token,expires_in,token_type,user")
	testx.AssertEqual(t, body.Data["access_token"], any("access.jwt.token"))
	testx.AssertEqual(t, body.Data["token_type"], any("Bearer"))
	testx.AssertEqual(t, body.Data["expires_in"], any(float64(900)))
	testx.AssertEqual(t, body.Data["user"].(map[string]any)["id"], any(id1))
	testx.AssertFalse(t, strings.Contains(rec.Body.String(), "secret"), "the refresh token is not in the body: %s", rec.Body.String())
}

func TestWebConstants(t *testing.T) {
	testx.AssertEqual(t, WebCookieName, "goshop_refresh")
	testx.AssertEqual(t, WebCookiePath, "/v1/auth/web")
	testx.AssertEqual(t, WebPathPrefix, "/v1/auth/web/")
	testx.AssertEqual(t, WebClientHeader, "X-GoShop-Client")
	testx.AssertEqual(t, WebClientValue, "web")
}

// requireWebClient refuses before any rate limit, service call or cookie.
func TestHandler_RequireWebClientRefuses(t *testing.T) {
	tests := []struct {
		name       string
		origins    []string
		change     func(*http.Request)
		wantReason string
	}{
		{name: "no client header", origins: []string{webOrigin}, wantReason: "client_header",
			change: func(r *http.Request) { r.Header.Del(WebClientHeader) }},
		{name: "empty client header", origins: []string{webOrigin}, wantReason: "client_header",
			change: func(r *http.Request) { r.Header.Set(WebClientHeader, "") }},
		{name: "another client", origins: []string{webOrigin}, wantReason: "client_header",
			change: func(r *http.Request) { r.Header.Set(WebClientHeader, "mobile") }},
		{name: "the value in another case", origins: []string{webOrigin}, wantReason: "client_header",
			change: func(r *http.Request) { r.Header.Set(WebClientHeader, "Web") }},
		{name: "the header twice, both web", origins: []string{webOrigin}, wantReason: "client_header",
			change: func(r *http.Request) { r.Header.Add(WebClientHeader, WebClientValue) }},
		{name: "a foreign origin", origins: []string{webOrigin}, wantReason: "origin",
			change: func(r *http.Request) { r.Header.Set("Origin", "https://evil.example.com") }},
		{name: "a sibling subdomain", origins: []string{webOrigin}, wantReason: "origin",
			change: func(r *http.Request) { r.Header.Set("Origin", "https://blog.example.com") }},
		{name: "the literal null origin", origins: []string{webOrigin}, wantReason: "origin",
			change: func(r *http.Request) { r.Header.Set("Origin", "null") }},
		{name: "an empty origin", origins: []string{webOrigin}, wantReason: "origin",
			change: func(r *http.Request) { r.Header.Set("Origin", "") }},
		{name: "the allowed origin twice", origins: []string{webOrigin}, wantReason: "origin",
			change: func(r *http.Request) { r.Header.Add("Origin", webOrigin) }},
		{name: "allowed then foreign origin", origins: []string{webOrigin}, wantReason: "origin",
			change: func(r *http.Request) { r.Header.Add("Origin", "https://evil.example.com") }},
		{name: "no configured origins", origins: nil, wantReason: "origin"},
	}
	paths := []string{"/v1/auth/web/login", "/v1/auth/web/refresh", "/v1/auth/web/logout"}
	for _, tt := range tests {
		for _, path := range paths {
			t.Run(tt.name+" "+path, func(t *testing.T) {
				env := newWebEnv(WebSession{AllowedOrigins: tt.origins})
				r := webRequest(context.Background(), path, `{"email":"budi@example.com","password":"x"}`,
					func(r *http.Request) {
						withCookies(id1 + ".s")(r)
						if tt.change != nil {
							tt.change(r)
						}
					})
				rec := sendWeb(env, r)

				body := assertError(t, rec, http.StatusForbidden, "FORBIDDEN")
				testx.AssertEqual(t, body.Error.Details["reason"], any(tt.wantReason))
				assertNoSetCookie(t, rec)
				testx.AssertEqual(t, len(env.limiter.seen()), 0, "no rate-limit count")
				testx.AssertEqual(t, len(env.svc.called), 0, "no service call")
			})
		}
	}
}

func TestHandler_RequireWebClientMessages(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "",
		func(r *http.Request) { r.Header.Del(WebClientHeader) }))
	testx.AssertEqual(t, assertError(t, rec, http.StatusForbidden, "FORBIDDEN").Error.Message,
		"this endpoint needs the X-GoShop-Client: web header")

	rec = sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "",
		func(r *http.Request) { r.Header.Set("Origin", "https://evil.example.com") }))
	testx.AssertEqual(t, assertError(t, rec, http.StatusForbidden, "FORBIDDEN").Error.Message,
		"this origin may not use the web session")
}

// Requests that pass the middleware reach the handler: a refresh without a
// cookie answers 204.
func TestHandler_RequireWebClientPasses(t *testing.T) {
	tests := []struct {
		name    string
		origins []string
		change  func(*http.Request)
	}{
		{name: "the allowed origin", origins: []string{webOrigin}},
		{name: "the allowed origin in another case", origins: []string{webOrigin},
			change: func(r *http.Request) { r.Header.Set("Origin", "HTTPS://SHOP.Example.COM") }},
		{name: "one of several origins", origins: []string{"http://localhost:5173", webOrigin}},
		{name: "no origin (curl, a server)", origins: []string{webOrigin},
			change: func(r *http.Request) { r.Header.Del("Origin") }},
		{name: "no origin and none configured", origins: nil,
			change: func(r *http.Request) { r.Header.Del("Origin") }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: tt.origins})
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "", tt.change))
			testx.AssertEqual(t, rec.Code, http.StatusNoContent, "body %s", rec.Body.String())
		})
	}
}

func TestHandler_WebRoutes(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
	r := chi.NewRouter()
	r.Route("/v1", env.h.Routes)
	for _, p := range []string{"/v1/auth/web/login", "/v1/auth/web/refresh", "/v1/auth/web/logout"} {
		testx.AssertTrue(t, r.Match(chi.NewRouteContext(), http.MethodPost, p), "POST %s is routed", p)
		testx.AssertFalse(t, r.Match(chi.NewRouteContext(), http.MethodGet, p), "GET %s is not", p)
	}
	// The middleware sits on the three routes, not on the prefix: an
	// unknown path is 404 even without the header.
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/nope", "",
		func(r *http.Request) { r.Header.Del(WebClientHeader) }))
	testx.AssertEqual(t, rec.Code, http.StatusNotFound)
	// The JSON endpoints do not need the header.
	env.svc.refresh = func(string) (Tokens, error) { return env.testTokens(), nil }
	rec = sendWeb(env, webRequest(context.Background(), "/v1/auth/refresh", `{"refresh_token":"x"}`,
		func(r *http.Request) { r.Header.Del(WebClientHeader) }))
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	assertNoSetCookie(t, rec)
}

func TestHandler_WebLogin(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
	var gotEmail, gotPassword string
	env.svc.login = func(email, password string) (Tokens, error) {
		gotEmail, gotPassword = email, password
		return env.testTokens(), nil
	}
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/login",
		`{"email":"Budi@Example.com","password":"kopi susu gula aren"}`, withCookies(id4+".old")))

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, gotEmail, "Budi@Example.com")
	testx.AssertEqual(t, gotPassword, "kopi susu gula aren")
	assertSetCookie(t, rec, wantRotatedCookie)
	assertWebSessionBody(t, rec)
	// The same limits and keys as POST /v1/auth/login.
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","),
		"login-ip:203.0.113.7,login-email:"+EmailKey("budi@example.com"))
	testx.AssertEqual(t, strings.Join(env.svc.called, ","), "Login", "the old cookie is not revoked or refreshed")
}

func TestHandler_WebLoginCookieAttributes(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
	env.svc.login = func(string, string) (Tokens, error) { return env.testTokens(), nil }
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/login",
		`{"email":"budi@example.com","password":"x"}`, nil))

	cookies := rec.Result().Cookies()
	testx.AssertEqual(t, len(cookies), 1)
	c := cookies[0]
	testx.AssertEqual(t, c.Name, "goshop_refresh")
	testx.AssertEqual(t, c.Value, id3+".secret")
	testx.AssertEqual(t, c.Path, "/v1/auth/web")
	testx.AssertEqual(t, c.Domain, "", "host-only")
	testx.AssertEqual(t, c.MaxAge, 30*24*3600)
	testx.AssertTrue(t, c.HttpOnly, "HttpOnly")
	testx.AssertTrue(t, c.Secure, "Secure")
	testx.AssertEqual(t, c.SameSite, http.SameSiteStrictMode)
	testx.AssertFalse(t, strings.Contains(strings.ToLower(setCookies(rec)[0]), "domain="), "no Domain attribute")
	testx.AssertFalse(t, strings.Contains(strings.ToLower(setCookies(rec)[0]), "expires="), "Max-Age only")
}

// Max-Age is the token's remaining life in whole seconds, at least 1:
// Go writes no Max-Age for 0, which would make a session cookie.
func TestHandler_WebLoginMaxAge(t *testing.T) {
	tests := []struct {
		name    string
		expires time.Duration
		want    string
	}{
		{name: "90 seconds", expires: 90 * time.Second, want: "Max-Age=90;"},
		{name: "rounded down", expires: 1500 * time.Millisecond, want: "Max-Age=1;"},
		{name: "under a second", expires: 300 * time.Millisecond, want: "Max-Age=1;"},
		{name: "at now", expires: 0, want: "Max-Age=1;"},
		{name: "already past", expires: -time.Hour, want: "Max-Age=1;"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			env.svc.login = func(string, string) (Tokens, error) {
				tok := env.testTokens()
				tok.RefreshExpiresAt = env.now.Add(tt.expires)
				return tok, nil
			}
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/login",
				`{"email":"budi@example.com","password":"x"}`, nil))
			testx.AssertEqual(t, rec.Code, http.StatusOK)
			testx.AssertContains(t, setCookies(rec)[0], tt.want)
		})
	}
}

// APP_AUTH_COOKIE_SECURE=false (development only) leaves Secure off, both
// when setting and when clearing; nothing else changes.
func TestHandler_WebInsecureCookie(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}, InsecureCookie: true})
	env.svc.login = func(string, string) (Tokens, error) { return env.testTokens(), nil }
	env.svc.logout = func(string) error { return nil }

	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/login",
		`{"email":"budi@example.com","password":"x"}`, nil))
	assertSetCookie(t, rec, strings.Replace(wantRotatedCookie, "; Secure", "", 1))

	rec = sendWeb(env, webRequest(context.Background(), "/v1/auth/web/logout", "", withCookies("x")))
	assertSetCookie(t, rec, strings.Replace(wantClearedCookie, "; Secure", "", 1))
}

// The zero WebSession is the safe one: Secure on, every Origin refused.
func TestHandler_WebZeroSettings(t *testing.T) {
	env := newHandlerEnv(0)
	env.svc.login = func(string, string) (Tokens, error) { return env.testTokens(), nil }
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/login",
		`{"email":"budi@example.com","password":"x"}`, func(r *http.Request) { r.Header.Del("Origin") }))
	assertSetCookie(t, rec, wantRotatedCookie)

	rec = sendWeb(env, webRequest(context.Background(), "/v1/auth/web/login",
		`{"email":"budi@example.com","password":"x"}`, nil))
	body := assertError(t, rec, http.StatusForbidden, "FORBIDDEN")
	testx.AssertEqual(t, body.Error.Details["reason"], any("origin"))
}

// A failed web login sets no cookie: the browser keeps whatever it had.
func TestHandler_WebLoginFailures(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		svcErr     error
		refuse     map[string]time.Duration
		limiterErr error
		wantStatus int
		wantCode   string
		wantChecks int
	}{
		{name: "not JSON", body: `{`, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED", wantChecks: 0},
		{name: "invalid", body: `{}`, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED", wantChecks: 2},
		{name: "wrong credentials", body: `{"email":"budi@example.com","password":"x"}`, svcErr: ErrInvalidCredentials,
			wantStatus: http.StatusUnauthorized, wantCode: CodeInvalidCredentials, wantChecks: 2},
		{name: "per-IP limit", body: `{"email":"budi@example.com","password":"x"}`,
			refuse:     map[string]time.Duration{"login-ip": time.Minute},
			wantStatus: http.StatusTooManyRequests, wantCode: "RATE_LIMITED", wantChecks: 1},
		{name: "per-email limit", body: `{"email":"budi@example.com","password":"x"}`,
			refuse:     map[string]time.Duration{"login-email": time.Minute},
			wantStatus: http.StatusTooManyRequests, wantCode: "RATE_LIMITED", wantChecks: 2},
		{name: "limiter down", body: `{"email":"budi@example.com","password":"x"}`, limiterErr: errBoom,
			wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR", wantChecks: 1},
		{name: "database", body: `{"email":"budi@example.com","password":"x"}`, svcErr: errBoom,
			wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR", wantChecks: 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			env.limiter.refuse, env.limiter.err = tt.refuse, tt.limiterErr
			env.svc.login = func(string, string) (Tokens, error) { return Tokens{}, tt.svcErr }
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/login", tt.body, withCookies(id4+".old")))

			assertError(t, rec, tt.wantStatus, tt.wantCode)
			assertNoSetCookie(t, rec)
			testx.AssertEqual(t, len(env.limiter.seen()), tt.wantChecks, "checks %v", env.limiter.seen())
			if tt.refuse != nil {
				testx.AssertEqual(t, rec.Header().Get("Retry-After"), "60")
			}
		})
	}
}

// Login after its refactor into login(): the JSON endpoint still returns
// the refresh token in the body and sets no cookie, even with the web
// settings on the handler.
func TestHandler_LoginUnchangedByWebSession(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
	env.svc.login = func(string, string) (Tokens, error) { return env.testTokens(), nil }
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/login",
		`{"email":"budi@example.com","password":"x"}`, func(r *http.Request) { r.Header.Del(WebClientHeader) }))

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	assertNoSetCookie(t, rec)
	body := decodeTokens(t, rec).Data
	testx.AssertEqual(t, body.RefreshToken, id3+".secret")
	testx.AssertEqual(t, body.RefreshExpiresIn, int64(30*24*3600))
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","),
		"login-ip:203.0.113.7,login-email:"+EmailKey("budi@example.com"))
}

func TestHandler_WebRefreshWithoutCookie(t *testing.T) {
	tests := []struct {
		name   string
		change func(*http.Request)
	}{
		{name: "no cookie"},
		{name: "an empty cookie", change: withCookies("")},
		{name: "two empty cookies", change: withCookies("", "")},
		{name: "only other cookies", change: func(r *http.Request) { r.Header.Set("Cookie", "theme=dark; goshop_refreshx=y") }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "", tt.change))
			testx.AssertEqual(t, rec.Code, http.StatusNoContent)
			testx.AssertEqual(t, rec.Body.Len(), 0)
			assertNoSetCookie(t, rec)
			testx.AssertEqual(t, len(env.limiter.seen()), 0, "a visitor without a session is not counted")
			testx.AssertEqual(t, len(env.svc.called), 0)
		})
	}
}

func TestHandler_WebRefresh(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
	var got string
	env.svc.refresh = func(token string) (Tokens, error) { got = token; return env.testTokens(), nil }
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "", withCookies(id1+".old")))

	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, got, id1+".old")
	assertSetCookie(t, rec, wantRotatedCookie)
	assertWebSessionBody(t, rec)
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "refresh-ip:203.0.113.7")
}

// An empty cookie next to a real one is ignored, so this is one cookie.
func TestHandler_WebRefreshIgnoresEmptyCookies(t *testing.T) {
	env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
	var got string
	env.svc.refresh = func(token string) (Tokens, error) { got = token; return env.testTokens(), nil }
	rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "", withCookies("", id1+".old")))
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, got, id1+".old")
}

// Every 401 clears the cookie; the token is useless.
func TestHandler_WebRefreshEndsSession(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		wantCode string
	}{
		{name: "invalid, revoked or reused", err: ErrRefreshTokenInvalid, wantCode: CodeTokenInvalid},
		{name: "expired", err: ErrRefreshTokenExpired, wantCode: CodeTokenExpired},
		{name: "account gone", err: ErrNoUser, wantCode: "UNAUTHORIZED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			env.svc.refresh = func(string) (Tokens, error) { return Tokens{}, tt.err }
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "", withCookies(id1+".old")))
			assertError(t, rec, http.StatusUnauthorized, tt.wantCode)
			assertSetCookie(t, rec, wantClearedCookie)
		})
	}
}

// 429 and 500 keep the cookie: the token may still be good.
func TestHandler_WebRefreshKeepsCookie(t *testing.T) {
	tests := []struct {
		name        string
		refuse      map[string]time.Duration
		limiterErr  error
		svcErr      error
		wantStatus  int
		wantCode    string
		wantRefresh bool
	}{
		{name: "rate limited", refuse: map[string]time.Duration{"refresh-ip": 90 * time.Second},
			wantStatus: http.StatusTooManyRequests, wantCode: "RATE_LIMITED"},
		{name: "limiter down", limiterErr: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
		{name: "database", svcErr: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR", wantRefresh: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			env.limiter.refuse, env.limiter.err = tt.refuse, tt.limiterErr
			env.svc.refresh = func(string) (Tokens, error) { return Tokens{}, tt.svcErr }
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "", withCookies(id1+".old")))

			assertError(t, rec, tt.wantStatus, tt.wantCode)
			assertNoSetCookie(t, rec)
			testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "refresh-ip:203.0.113.7")
			testx.AssertEqual(t, slices.Contains(env.svc.called, "Refresh"), tt.wantRefresh)
			if tt.refuse != nil {
				testx.AssertEqual(t, rec.Header().Get("Retry-After"), "90")
			}
		})
	}
}

// Several goshop_refresh cookies: one was planted (cookie tossing). Neither
// is used; the API's own cookie is cleared; the attempt still counts.
func TestHandler_WebRefreshSeveralCookies(t *testing.T) {
	for _, n := range []int{2, 3} {
		t.Run(strings.Repeat("x", n), func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			values := []string{id1 + ".planted", id2 + ".mine", id3 + ".other"}[:n]
			ctx, logs := ctxWithLogs()
			rec := sendWeb(env, webRequest(ctx, "/v1/auth/web/refresh", "", withCookies(values...)))

			body := assertError(t, rec, http.StatusUnauthorized, CodeTokenInvalid)
			testx.AssertEqual(t, body.Error.Message, "the token is invalid or has been revoked; log in again")
			assertSetCookie(t, rec, wantClearedCookie)
			testx.AssertEqual(t, len(env.svc.called), 0, "Refresh is not called")
			testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "refresh-ip:203.0.113.7")
			line, ok := findLog(t, logs, "web refresh refused: several goshop_refresh cookies")
			testx.AssertTrue(t, ok, "warning logged: %s", logs.String())
			testx.AssertEqual(t, line["count"], any(float64(n)))
		})
	}
	t.Run("rate limited first", func(t *testing.T) {
		env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
		env.limiter.refuse = map[string]time.Duration{"refresh-ip": time.Minute}
		rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/refresh", "", withCookies("a", "b")))
		assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
		assertNoSetCookie(t, rec)
	})
}

func TestHandler_WebLogout(t *testing.T) {
	tests := []struct {
		name   string
		values []string
		want   []string
	}{
		{name: "no cookie", values: nil, want: nil},
		{name: "one cookie", values: []string{id1 + ".s"}, want: []string{id1 + ".s"}},
		{name: "an empty cookie", values: []string{""}, want: nil},
		{name: "two cookies", values: []string{"a", "b"}, want: []string{"a", "b"}},
		{name: "four cookies", values: []string{"a", "b", "c", "d"}, want: []string{"a", "b", "c", "d"}},
		{name: "five cookies, at most four revoked", values: []string{"a", "b", "c", "d", "e"}, want: []string{"a", "b", "c", "d"}},
		{name: "nine cookies", values: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i"}, want: []string{"a", "b", "c", "d"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			var got []string
			env.svc.logout = func(token string) error { got = append(got, token); return nil }
			var change func(*http.Request)
			if tt.values != nil {
				change = withCookies(tt.values...)
			}
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/logout", "", change))

			testx.AssertEqual(t, rec.Code, http.StatusNoContent, "body %s", rec.Body.String())
			testx.AssertEqual(t, rec.Body.Len(), 0)
			assertSetCookie(t, rec, wantClearedCookie)
			testx.AssertEqual(t, strings.Join(got, ","), strings.Join(tt.want, ","))
			testx.AssertEqual(t, len(env.limiter.seen()), 0, "logout is not rate limited")
		})
	}
}

// When revoking fails the cookie stays, so the client can retry.
func TestHandler_WebLogoutFails(t *testing.T) {
	for _, failAt := range []int{1, 2} {
		t.Run(strings.Repeat("x", failAt), func(t *testing.T) {
			env := newWebEnv(WebSession{AllowedOrigins: []string{webOrigin}})
			calls := 0
			env.svc.logout = func(string) error {
				calls++
				if calls == failAt {
					return errBoom
				}
				return nil
			}
			rec := sendWeb(env, webRequest(context.Background(), "/v1/auth/web/logout", "", withCookies("a", "b", "c")))
			assertError(t, rec, http.StatusInternalServerError, "INTERNAL_ERROR")
			assertNoSetCookie(t, rec)
			testx.AssertEqual(t, calls, failAt, "stops at the first failure")
		})
	}
}

func TestEndsWebSession(t *testing.T) {
	testx.AssertTrue(t, endsWebSession(ErrRefreshTokenInvalid), "invalid")
	testx.AssertTrue(t, endsWebSession(ErrRefreshTokenExpired), "expired")
	testx.AssertTrue(t, endsWebSession(ErrNoUser), "no user")
	testx.AssertFalse(t, endsWebSession(errBoom), "other errors keep the cookie")
	testx.AssertFalse(t, endsWebSession(ErrInvalidCredentials), "a login error is not a refresh error")
}
