package auth

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The browser's session (Bab 10, ADR 0008). The web storefront keeps the
// access token in memory and the refresh token in an httpOnly cookie that
// page scripts cannot read; the JSON endpoints stay for the mobile app.
//
// From Bab 12 the admin dashboard uses the same endpoints with a cookie of
// its own (AdminCookieName), chosen by X-GoShop-Client: admin. The two apps
// talk to one API host, so with one cookie a login in either would end the
// other's session, and their refreshes (serialised per origin with Web
// Locks) could race into reuse detection.
const (
	// WebCookieName is the storefront's cookie, which holds the refresh
	// token. Not __Host-: that prefix needs Path=/, which would send the
	// refresh token with every API request.
	WebCookieName = "goshop_refresh"
	// AdminCookieName is the admin dashboard's cookie (Bab 12), with the
	// same path and attributes as WebCookieName.
	AdminCookieName = "goshop_admin_refresh"
	// WebCookiePath scopes the cookie to the web auth endpoints: the
	// browser sends it to /v1/auth/web/* and nowhere else.
	WebCookiePath = "/v1/auth/web"
	// WebPathPrefix is the path every web auth endpoint starts with; CORS
	// allows credentials under it only (httpserver.Options).
	WebPathPrefix = WebCookiePath + "/"
	// WebClientHeader must be WebClientValue or AdminClientValue on every
	// web auth request. A page on another origin cannot add it without a
	// CORS preflight, which the API answers only for its configured
	// origins. Its value also picks the cookie: web the storefront's,
	// admin the dashboard's.
	WebClientHeader  = "X-GoShop-Client"
	WebClientValue   = "web"
	AdminClientValue = "admin"

	// maxLogoutCookies bounds the sessions one logout revokes when a
	// request carries several goshop_refresh cookies.
	maxLogoutCookies = 4
)

// WebSession configures the web auth endpoints.
type WebSession struct {
	// AllowedOrigins is APP_CORS_ALLOWED_ORIGINS: a request whose Origin
	// is not one of them is refused.
	AllowedOrigins []string
	// InsecureCookie leaves Secure off the cookie
	// (APP_AUTH_COOKIE_SECURE=false, development only). The zero value is
	// the safe one.
	InsecureCookie bool
}

// webCookieNames is the cookie each X-GoShop-Client value uses.
var webCookieNames = map[string]string{
	WebClientValue:   WebCookieName,
	AdminClientValue: AdminCookieName,
}

// sessionCookie is the cookie of the request's client. requireWebClient
// has already refused any other value, so the header is one of
// webCookieNames' keys.
func sessionCookie(r *http.Request) string {
	if name, ok := webCookieNames[r.Header.Get(WebClientHeader)]; ok {
		return name
	}
	return WebCookieName
}

// allowsOrigin reports whether origin is one of the configured origins.
// Scheme and host are case-insensitive, as go-chi/cors treats them.
func (s WebSession) allowsOrigin(origin string) bool {
	return slices.ContainsFunc(s.AllowedOrigins, func(o string) bool { return strings.EqualFold(o, origin) })
}

// requireWebClient refuses, with 403 FORBIDDEN and before any rate limit
// or token work, a request without exactly one X-GoShop-Client header of
// web or admin, or with an Origin that is not configured. A request
// without Origin (curl, a server) passes: it carries no cookie a browser
// added.
func (h *Handler) requireWebClient(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if v := r.Header.Values(WebClientHeader); len(v) != 1 || webCookieNames[v[0]] == "" {
			httpapi.Error(w, r, webClientRejected("client_header", "this endpoint needs the X-GoShop-Client header: web or admin"))
			return
		}
		if o := r.Header.Values("Origin"); len(o) > 0 && (len(o) != 1 || !h.web.allowsOrigin(o[0])) {
			httpapi.Error(w, r, webClientRejected("origin", "this origin may not use the web session"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func webClientRejected(reason, message string) *errx.AppError {
	return errx.New(httpapi.CodeForbidden, message).
		WithHTTPStatus(http.StatusForbidden).
		WithDetails(map[string]any{"reason": reason})
}

// WebLogin serves POST /v1/auth/web/login: Login, with the refresh token in
// the cookie instead of the body. A cookie the request carries is ignored;
// the new one replaces it in the browser.
func (h *Handler) WebLogin(w http.ResponseWriter, r *http.Request) {
	tokens, ok := h.login(w, r)
	if !ok {
		return
	}
	h.setRefreshCookie(w, sessionCookie(r), tokens)
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toWebSessionJSON(tokens, h.now())})
}

// WebRefresh serves POST /v1/auth/web/refresh: 204 when there is no cookie
// (a visitor who is not logged in), otherwise Refresh with the cookie's
// token and the rotated token in a new cookie. Every 401 clears the cookie;
// 429 and 500 keep it, because the token may still be good.
func (h *Handler) WebRefresh(w http.ResponseWriter, r *http.Request) {
	name := sessionCookie(r)
	values := refreshCookies(r, name)
	if len(values) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.allow(w, r, limitCheck{LimitRefreshPerIP, h.clientIP(r)}) {
		return
	}
	if len(values) > 1 {
		// The API sets one host-only cookie, so a second one was set by
		// someone else: a sibling subdomain can plant a Domain cookie with
		// this name (cookie tossing) to slip its own session into the
		// victim's browser. Using neither is the only safe choice.
		logx.FromContext(r.Context()).Warn("web refresh refused: several session cookies", "cookie", name, "count", len(values))
		h.clearRefreshCookie(w, name)
		httpapi.Error(w, r, toHTTPError(ErrRefreshTokenInvalid))
		return
	}
	tokens, err := h.svc.Refresh(r.Context(), values[0])
	if err != nil {
		if endsWebSession(err) {
			h.clearRefreshCookie(w, name)
		}
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	h.setRefreshCookie(w, name, tokens)
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toWebSessionJSON(tokens, h.now())})
}

// WebLogout serves POST /v1/auth/web/logout: ends the cookie's session, if
// any, and clears the cookie; 204 either way. When revoking fails the
// cookie stays, so the client can retry.
func (h *Handler) WebLogout(w http.ResponseWriter, r *http.Request) {
	name := sessionCookie(r)
	values := refreshCookies(r, name)
	for _, v := range values[:min(len(values), maxLogoutCookies)] {
		if err := h.svc.Logout(r.Context(), v); err != nil {
			httpapi.Error(w, r, toHTTPError(err))
			return
		}
	}
	h.clearRefreshCookie(w, name)
	w.WriteHeader(http.StatusNoContent)
}

// refreshCookies returns the non-empty values of every cookie called name
// the request carries, in the order the browser sent them. The other
// client's cookie, which the browser sends along (same path), is ignored.
func refreshCookies(r *http.Request, name string) []string {
	var values []string
	for _, c := range r.CookiesNamed(name) {
		if c.Value != "" {
			values = append(values, c.Value)
		}
	}
	return values
}

// endsWebSession reports whether err refuses the token for good, so the
// cookie that holds it is useless: the 401s of Refresh.
func endsWebSession(err error) bool {
	return errors.Is(err, ErrRefreshTokenInvalid) || errors.Is(err, ErrRefreshTokenExpired) ||
		errors.Is(err, ErrNoUser)
}

// setRefreshCookie stores the session's new refresh token. Max-Age comes
// from the token's own expiry, so the cookie and the token end together;
// at least 1, because 0 would make it a session cookie.
func (h *Handler) setRefreshCookie(w http.ResponseWriter, name string, t Tokens) {
	maxAge := max(1, int(secondsUntil(t.RefreshExpiresAt, h.now())))
	http.SetCookie(w, h.refreshCookie(name, t.RefreshToken, maxAge))
}

// clearRefreshCookie tells the browser to delete the cookie (Max-Age=0).
// Name, Path and attributes must match the cookie set, or the browser
// keeps it and stores a second one.
func (h *Handler) clearRefreshCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, h.refreshCookie(name, "", -1))
}

// refreshCookie is the cookie name with value; Domain is never set, so
// only the API's own host receives it.
func (h *Handler) refreshCookie(name, value string, maxAge int) *http.Cookie {
	// gosec cannot see that config refuses APP_AUTH_COOKIE_SECURE=false
	// outside development.
	return &http.Cookie{ //nolint:gosec // G124: Secure is off in development only
		Name:     name,
		Value:    value,
		Path:     WebCookiePath,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   !h.web.InsecureCookie,
		SameSite: http.SameSiteStrictMode,
	}
}

// webSessionJSON is WebSession in api/openapi.yaml: TokenPair without the
// refresh token, which is in the cookie.
type webSessionJSON struct {
	AccessToken string    `json:"access_token"`
	TokenType   string    `json:"token_type"`
	ExpiresIn   int64     `json:"expires_in"`
	User        user.JSON `json:"user"`
}

func toWebSessionJSON(t Tokens, now time.Time) webSessionJSON {
	return webSessionJSON{
		AccessToken: t.AccessToken,
		TokenType:   "Bearer",
		ExpiresIn:   secondsUntil(t.AccessExpiresAt, now),
		User:        user.ToJSON(t.User),
	}
}
