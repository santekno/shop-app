//go:build integration

package integration_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// securityHeaders are the headers httpapi.SecurityHeaders sets on every
// response (OWASP API8).
var securityHeaders = map[string]string{
	"X-Content-Type-Options":  "nosniff",
	"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
	"X-Frame-Options":         "DENY",
	"Referrer-Policy":         "no-referrer",
	"Cache-Control":           "no-store",
}

// hsts is the Strict-Transport-Security value outside development.
const hsts = "max-age=31536000; includeSubDomains"

// TestSecurityHeaders checks the headers on every kind of response a
// browser could see, over the real router: successes with tokens or
// personal data, errors from handlers, the guard, RequireRole, the rate
// limiter and the router, and the probes. HSTS is sent everywhere but in
// development, where the API is plain HTTP on localhost.
func TestSecurityHeaders(t *testing.T) {
	for _, env := range []string{config.EnvDevelopment, config.EnvStaging, config.EnvProduction} {
		t.Run(env, func(t *testing.T) {
			s := startServer(t, map[string]string{"APP_ENV": env})
			_, p := s.newAccount(t, "kepala")
			for range 5 { // use up the five attempts per email, so the next is a 429
				s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": "batas@example.com", "password": wrongPassword}, "")
			}
			responses := map[string]response{
				"login 200":         s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": p.User.Email, "password": testPassword}, ""),
				"me 200":            s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken),
				"me 401":            s.call(t, http.MethodGet, "/v1/me", nil, ""),
				"admin 403":         s.call(t, http.MethodGet, "/v1/admin/products/"+uuidx.NewV7(), nil, p.AccessToken),
				"register 400":      s.call(t, http.MethodPost, "/v1/auth/register", `{}`, ""),
				"login 429":         s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": "batas@example.com", "password": wrongPassword}, ""),
				"logout 204":        s.call(t, http.MethodPost, "/v1/auth/logout", map[string]string{"refresh_token": "x"}, ""),
				"unknown route 404": s.get(t, "/v1/tidak-ada"),
				"wrong method 405":  s.call(t, http.MethodDelete, "/v1/auth/login", nil, ""),
				"catalog 200":       s.get(t, "/v1/categories"),
				"healthz 200":       s.get(t, "/healthz"),
				"readyz 200":        s.get(t, "/readyz"),
			}
			if r := responses["login 429"]; r.Status != http.StatusTooManyRequests {
				t.Fatalf("the rate-limited login = %d, want 429", r.Status)
			}
			for name, r := range responses {
				for h, want := range securityHeaders {
					if got := r.Header.Get(h); got != want {
						t.Errorf("%s: %s = %q, want %q", name, h, got, want)
					}
				}
				got := r.Header.Get("Strict-Transport-Security")
				if want := map[bool]string{true: "", false: hsts}[env == config.EnvDevelopment]; got != want {
					t.Errorf("%s in %s: Strict-Transport-Security = %q, want %q", name, env, got, want)
				}
			}
		})
	}
}

// TestSecurity_NoMassAssignment checks that a client cannot write fields
// the API owns (OWASP API3): a role, a verified flag, an id or an owner in
// a request body is refused as an unknown field, never stored.
func TestSecurity_NoMassAssignment(t *testing.T) {
	s := startServer(t, nil)
	email := uniqueEmail("massal")
	for _, extra := range []string{`"role":"admin"`, `"email_verified":true`, `"id":"` + uuidx.NewV7() + `"`} {
		body := `{"email":"` + email + `","password":"` + testPassword + `","name":"M",` + extra + `}`
		details := assertError(t, s.call(t, http.MethodPost, "/v1/auth/register", body, ""), http.StatusBadRequest, "VALIDATION_FAILED")
		if msg, _ := details["body"].(string); !strings.Contains(msg, "unknown field") {
			t.Errorf("register with %s: details = %v, want an unknown field", extra, details)
		}
	}
	if n := s.count(t, `SELECT count(*) FROM users`); n != 0 {
		t.Fatalf("%d users stored from refused registrations", n)
	}

	u, p := s.newAccount(t, "massal-2")
	for _, body := range []string{`{"role":"admin"}`, `{"email_verified":true}`, `{"id":"` + uuidx.NewV7() + `"}`} {
		assertError(t, s.call(t, http.MethodPatch, "/v1/me", body, p.AccessToken), http.StatusBadRequest, "VALIDATION_FAILED")
	}
	if n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND role = 'buyer' AND email_verified_at IS NULL`, u.ID); n != 1 {
		t.Error("a refused PATCH /v1/me changed the role or the verification")
	}
}

// TestSecurity_NoSecretsInResponses checks that no response of the auth
// flows carries a password, a password hash or a stored token hash, and
// that an oversized body is refused before it is parsed (OWASP API4).
func TestSecurity_NoSecretsInResponses(t *testing.T) {
	s := startServer(t, nil)
	email := uniqueEmail("rahasia")
	bodies := []response{
		s.call(t, http.MethodPost, "/v1/auth/register", map[string]string{"email": email, "password": testPassword, "name": "R"}, ""),
	}
	p := s.login(t, email, testPassword)
	bodies = append(bodies,
		s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken),
		s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": p.RefreshToken}, ""),
		s.call(t, http.MethodPost, "/v1/auth/register", map[string]string{"email": email, "password": testPassword, "name": "R"}, ""),
	)
	for _, r := range bodies {
		body := strings.ToLower(string(r.Body))
		for _, secret := range []string{testPassword, "argon2", "password_hash", "token_hash"} {
			if strings.Contains(body, secret) {
				t.Errorf("a %d response contains %q: %s", r.Status, secret, r.Body)
			}
		}
	}

	huge := `{"email":"` + email + `","password":"` + strings.Repeat("x", 1<<20) + `"}`
	details := assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", huge, ""), http.StatusBadRequest, "VALIDATION_FAILED")
	if msg, _ := details["body"].(string); !strings.Contains(msg, "at most 1048576 bytes") {
		t.Errorf("an over-1-MiB login: details = %v", details)
	}
}
