//go:build integration

package integration_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The admin dashboard's web session (Bab 12 artikel 01): the same
// /v1/auth/web endpoints with X-GoShop-Client: admin keep the refresh token
// in a cookie of their own, goshop_admin_refresh, so one browser can hold
// a storefront session and a dashboard session for the same API host at
// once, and neither app's login, refresh or logout touches the other's.

// adminOrigin is the dashboard's origin.
const adminOrigin = "http://localhost:5174"

// jar is a browser's cookies for the API host: what it sends to
// /v1/auth/web/*.
type jar map[string]string

// header is the Cookie header of j, every cookie in a fixed order.
func (j jar) header() string {
	var parts []string
	for _, name := range []string{auth.WebCookieName, auth.AdminCookieName} {
		if v, ok := j[name]; ok {
			parts = append(parts, name+"="+v)
		}
	}
	return strings.Join(parts, "; ")
}

// take applies resp's Set-Cookie lines to j, as a browser does, and
// returns the names it set.
func (j jar) take(t *testing.T, resp response) []string {
	t.Helper()
	var names []string
	for _, line := range resp.Header.Values("Set-Cookie") {
		c, err := http.ParseSetCookie(line)
		if err != nil {
			t.Fatalf("Set-Cookie %q: %v", line, err)
		}
		assertCookieAttributes(t, c, true, c.Name)
		if c.Value == "" || c.MaxAge < 0 {
			delete(j, c.Name)
		} else {
			j[c.Name] = c.Value
		}
		names = append(names, c.Name)
	}
	return names
}

// appHeaders is what the storefront (client web) or the dashboard (client
// admin) sends from its origin, with every cookie in j.
func appHeaders(client string, j jar) http.Header {
	h := http.Header{}
	h.Set(auth.WebClientHeader, client)
	if client == auth.AdminClientValue {
		h.Set("Origin", adminOrigin)
	} else {
		h.Set("Origin", webOrigin)
	}
	if c := j.header(); c != "" {
		h.Set("Cookie", c)
	}
	return h
}

// TestWebSession_AdminCookieCoexists: an admin logs in to the dashboard
// and to the storefront in one browser. Each app has its cookie; each
// refresh sends both cookies and rotates only its own; a storefront logout
// leaves the dashboard logged in, and the reverse.
func TestWebSession_AdminCookieCoexists(t *testing.T) {
	s := startServer(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": webOrigin + "," + adminOrigin})
	email := uniqueEmail("dua-sesi")
	u := s.register(t, email, testPassword, "Admin Dua Sesi")
	mustExec(t, s.db, `UPDATE users SET role = $2 WHERE id = $1`, u.ID, string(user.RoleAdmin))
	creds := map[string]string{"email": email, "password": testPassword}
	browser := jar{}

	post := func(client, endpoint string, body any) response {
		t.Helper()
		return s.webPost(t, "/v1/auth/web/"+endpoint, body, appHeaders(client, browser))
	}
	expectSet := func(resp response, what string, want ...string) {
		t.Helper()
		if got := browser.take(t, resp); strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s set cookies %v, want %v", what, got, want)
		}
	}

	adminLogin := post(auth.AdminClientValue, "login", creds)
	adminAccess := assertWebSession(t, adminLogin, "admin login")
	expectSet(adminLogin, "admin login", auth.AdminCookieName)
	webLogin := post(auth.WebClientValue, "login", creds)
	assertWebSession(t, webLogin, "storefront login")
	expectSet(webLogin, "storefront login", auth.WebCookieName)
	if s.liveSessions(t, u.ID) != 2 {
		t.Fatalf("live sessions = %d, want 2 (one per app)", s.liveSessions(t, u.ID))
	}
	// The dashboard's token is an admin's: the admin routes take it.
	if r := s.call(t, http.MethodGet, "/v1/admin/products", nil, adminAccess); r.Status != http.StatusOK {
		t.Errorf("GET /v1/admin/products with the dashboard's token = %d", r.Status)
	}

	for range 2 {
		before := jar{}
		for k, v := range browser {
			before[k] = v
		}
		r := post(auth.AdminClientValue, "refresh", nil)
		assertWebSession(t, r, "admin refresh")
		expectSet(r, "admin refresh", auth.AdminCookieName)
		if browser[auth.WebCookieName] != before[auth.WebCookieName] || browser[auth.AdminCookieName] == before[auth.AdminCookieName] {
			t.Error("an admin refresh did not rotate exactly the admin cookie")
		}
		r = post(auth.WebClientValue, "refresh", nil)
		assertWebSession(t, r, "storefront refresh")
		expectSet(r, "storefront refresh", auth.WebCookieName)
	}
	if s.liveSessions(t, u.ID) != 2 {
		t.Errorf("live sessions after the refreshes = %d, want 2", s.liveSessions(t, u.ID))
	}

	// A storefront logout ends the storefront's session only.
	logout := post(auth.WebClientValue, "logout", nil)
	if logout.Status != http.StatusNoContent {
		t.Fatalf("storefront logout = %d: %s", logout.Status, logout.Body)
	}
	expectSet(logout, "storefront logout", auth.WebCookieName)
	if _, ok := browser[auth.WebCookieName]; ok {
		t.Error("the storefront logout did not clear its cookie")
	}
	r := post(auth.AdminClientValue, "refresh", nil)
	assertWebSession(t, r, "admin refresh after the storefront logout")
	expectSet(r, "admin refresh after the storefront logout", auth.AdminCookieName)
	if r := post(auth.WebClientValue, "refresh", nil); r.Status != http.StatusNoContent {
		t.Errorf("storefront refresh without its cookie = %d, want 204", r.Status)
	}

	// And the reverse: log in to the storefront again, then out of the
	// dashboard.
	webLogin = post(auth.WebClientValue, "login", creds)
	assertWebSession(t, webLogin, "storefront login again")
	browser.take(t, webLogin)
	logout = post(auth.AdminClientValue, "logout", nil)
	if logout.Status != http.StatusNoContent {
		t.Fatalf("admin logout = %d: %s", logout.Status, logout.Body)
	}
	expectSet(logout, "admin logout", auth.AdminCookieName)
	r = post(auth.WebClientValue, "refresh", nil)
	assertWebSession(t, r, "storefront refresh after the admin logout")
	if s.liveSessions(t, u.ID) != 1 {
		t.Errorf("live sessions = %d, want 1 (the storefront's)", s.liveSessions(t, u.ID))
	}
}

// TestWebSession_AdminClientRules: the admin client is refused from an
// origin that is not configured and with an unknown client value; an
// admin cookie sent with client web is not the storefront's session.
func TestWebSession_AdminClientRules(t *testing.T) {
	s := startServer(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": webOrigin + "," + adminOrigin})
	email := uniqueEmail("klien-admin")
	s.register(t, email, testPassword, "Klien Admin")
	creds := map[string]string{"email": email, "password": testPassword}

	h := appHeaders(auth.AdminClientValue, jar{})
	h.Set("Origin", "http://localhost:5175")
	assertError(t, s.webPost(t, "/v1/auth/web/login", creds, h), http.StatusForbidden, "FORBIDDEN")
	h = appHeaders(auth.AdminClientValue, jar{})
	h.Set(auth.WebClientHeader, "dasbor")
	assertError(t, s.webPost(t, "/v1/auth/web/login", creds, h), http.StatusForbidden, "FORBIDDEN")

	browser := jar{}
	login := s.webPost(t, "/v1/auth/web/login", creds, appHeaders(auth.AdminClientValue, browser))
	assertWebSession(t, login, "admin login")
	browser.take(t, login)
	// The storefront has no cookie of its own: nothing to refresh, even
	// though the dashboard's cookie travels with the request.
	if r := s.webPost(t, "/v1/auth/web/refresh", nil, appHeaders(auth.WebClientValue, browser)); r.Status != http.StatusNoContent {
		t.Errorf("storefront refresh with only the admin cookie = %d, want 204: %s", r.Status, r.Body)
	}
}
