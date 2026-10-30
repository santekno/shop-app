//go:build integration

package integration_test

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// repoRoot is the repository root, seen from this package's directory.
var repoRoot = filepath.Join("..", "..", "..", "..")

// adminProbe is an admin route whose handler answers 404 for a random id:
// staff reach the handler (404), a buyer is stopped at RequireRole (403).
func adminProbe() string { return "/v1/admin/products/" + uuidx.NewV7() }

// TestRBAC_RoleChangeAtNextRefresh changes a role in PostgreSQL under a
// live session. The access token keeps the role it was issued with until
// the next refresh (ADR 0005), in both directions: a promoted buyer is
// still refused until they refresh, a demoted seller still allowed.
func TestRBAC_RoleChangeAtNextRefresh(t *testing.T) {
	s := startServer(t, nil)
	u, p := s.newAccount(t, "naik-pangkat")

	assertError(t, s.call(t, http.MethodGet, adminProbe(), nil, p.AccessToken), http.StatusForbidden, "FORBIDDEN")
	mustExec(t, s.db, `UPDATE users SET role = 'seller' WHERE id = $1`, u.ID)
	assertError(t, s.call(t, http.MethodGet, adminProbe(), nil, p.AccessToken), http.StatusForbidden, "FORBIDDEN")

	seller := s.refresh(t, p.RefreshToken)
	if seller.User.Role != "seller" || jwtClaims(t, seller.AccessToken)["role"] != "seller" {
		t.Fatalf("after the refresh: user role %q, token role %v; want seller", seller.User.Role, jwtClaims(t, seller.AccessToken)["role"])
	}
	assertError(t, s.call(t, http.MethodGet, adminProbe(), nil, seller.AccessToken), http.StatusNotFound, "NOT_FOUND")

	mustExec(t, s.db, `UPDATE users SET role = 'buyer' WHERE id = $1`, u.ID)
	assertError(t, s.call(t, http.MethodGet, adminProbe(), nil, seller.AccessToken), http.StatusNotFound, "NOT_FOUND")
	buyer := s.refresh(t, seller.RefreshToken)
	assertError(t, s.call(t, http.MethodGet, adminProbe(), nil, buyer.AccessToken), http.StatusForbidden, "FORBIDDEN")
}

// seedAdmin runs `make seed-admin email=<email>` against dsn with password
// in SEED_ADMIN_PASSWORD, exactly as a developer does, and returns its
// combined output.
func seedAdmin(t *testing.T, dsn, email, password string) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()
	//nolint:gosec // G204: make with the test's own arguments, not user input
	cmd := exec.CommandContext(ctx, "make", "--no-print-directory", "-C", repoRoot, "seed-admin", "email="+email, "DATABASE_URL="+dsn)
	cmd.Env = append(os.Environ(), "SEED_ADMIN_PASSWORD="+password)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// TestSeedAdmin creates an admin with make seed-admin on the test's own
// database, then promotes an existing buyer: both log in through the API
// as admins with a verified email and reach the admin routes, and the
// promoted account's password is the new one.
func TestSeedAdmin(t *testing.T) {
	s := startServer(t, nil)

	email := uniqueEmail("admin")
	out, err := seedAdmin(t, s.dbURL, strings.ToUpper(email), testPassword)
	if err != nil || !strings.Contains(out, "admin "+email+" created") {
		t.Fatalf("make seed-admin (new) = %v:\n%s", err, out)
	}
	admin := s.login(t, email, testPassword)
	if admin.User.Role != "admin" || !admin.User.EmailVerified {
		t.Errorf("seeded admin = %+v, want role admin with a verified email", admin.User)
	}
	assertError(t, s.call(t, http.MethodGet, adminProbe(), nil, admin.AccessToken), http.StatusNotFound, "NOT_FOUND")
	if strings.Contains(out, testPassword) {
		t.Error("make seed-admin printed the password")
	}

	buyer, _ := s.newAccount(t, "dipromosikan")
	out, err = seedAdmin(t, s.dbURL, buyer.Email, otherPassword)
	if err != nil || !strings.Contains(out, "existing account given the admin role, password replaced; its sessions are revoked") {
		t.Fatalf("make seed-admin (existing) = %v:\n%s", err, out)
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": buyer.Email, "password": testPassword}, ""),
		http.StatusUnauthorized, "INVALID_CREDENTIALS")
	promoted := s.login(t, buyer.Email, otherPassword)
	if promoted.User.ID != buyer.ID || promoted.User.Role != "admin" {
		t.Errorf("promoted account = %+v, want %s as admin", promoted.User, buyer.ID)
	}
	if n := s.count(t, `SELECT count(*) FROM users WHERE role = 'admin'`); n != 2 {
		t.Errorf("%d admins, want 2", n)
	}
}

// TestSeedAdmin_Seller: make seed-admin role=seller (Bab 12) makes a
// seller, who reaches the staff routes but not the admin-only cancel.
func TestSeedAdmin_Seller(t *testing.T) {
	s := startServer(t, nil)
	email := uniqueEmail("penjual")
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()
	//nolint:gosec // G204: make with the test's own arguments, not user input
	cmd := exec.CommandContext(ctx, "make", "--no-print-directory", "-C", repoRoot, "seed-admin",
		"email="+email, "role=seller", "DATABASE_URL="+s.dbURL)
	cmd.Env = append(os.Environ(), "SEED_ADMIN_PASSWORD="+testPassword)
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "seller "+email+" created") {
		t.Fatalf("make seed-admin role=seller = %v:\n%s", err, out)
	}
	seller := s.login(t, email, testPassword)
	if seller.User.Role != "seller" || !seller.User.EmailVerified {
		t.Errorf("seeded seller = %+v, want role seller with a verified email", seller.User)
	}
	if r := s.call(t, http.MethodGet, "/v1/admin/orders", nil, seller.AccessToken); r.Status != http.StatusOK {
		t.Errorf("GET /v1/admin/orders as the seller = %d: %s", r.Status, r.Body)
	}
	assertError(t, s.call(t, http.MethodPost, "/v1/admin/orders/"+uuidx.NewV7()+"/cancel", nil, seller.AccessToken),
		http.StatusForbidden, "FORBIDDEN")
}

// TestSeedAdmin_Refusals checks what make seed-admin refuses before it
// writes anything: no password, a password the policy refuses, a database
// that is not on this machine, and an argument that is not an email.
func TestSeedAdmin_Refusals(t *testing.T) {
	s := startServer(t, nil)
	tests := []struct {
		name, dsn, email, password, want string
	}{
		{"no password", s.dbURL, uniqueEmail("a"), "", "set SEED_ADMIN_PASSWORD"},
		{"leaked password", s.dbURL, uniqueEmail("a"), "password123", "too common"},
		{"remote database", "postgres://goshop:goshop@db.example.com:5432/goshop", uniqueEmail("a"), testPassword, "refusing a DATABASE_URL"},
		{"not an email", s.dbURL, "bukan-email", testPassword, "usage: SEED_ADMIN_PASSWORD"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := seedAdmin(t, tt.dsn, tt.email, tt.password)
			if err == nil || !strings.Contains(out, tt.want) {
				t.Errorf("make seed-admin = %v, want a failure mentioning %q:\n%s", err, tt.want, out)
			}
		})
	}
	if n := s.count(t, `SELECT count(*) FROM users`); n != 0 {
		t.Errorf("%d users after refused seed-admin runs", n)
	}
}

// TestSeedAdmin_PromotionEndsSessions: promoting an account replaces its
// password, so make seed-admin revokes the account's refresh tokens in the
// same transaction, as a password reset does, and says so. Creating a new
// admin touches no other account's tokens. The seed has no Redis, so an
// access token already issued keeps working until it expires
// (APP_ACCESS_TOKEN_TTL); that documented limit is checked too.
func TestSeedAdmin_PromotionEndsSessions(t *testing.T) {
	s := startServer(t, nil)
	bystander, bystanderPair := s.newAccount(t, "penonton")
	target, phone := s.newAccount(t, "dipromosikan")
	laptop := s.login(t, target.Email, testPassword)
	revoked := func() int { return s.count(t, `SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NOT NULL`) }

	out, err := seedAdmin(t, s.dbURL, uniqueEmail("admin-baru"), testPassword)
	if err != nil || !strings.Contains(out, "created") {
		t.Fatalf("make seed-admin (new) = %v:\n%s", err, out)
	}
	if n := revoked(); n != 0 {
		t.Errorf("creating a new admin revoked %d refresh tokens of other accounts", n)
	}
	if s.liveSessions(t, target.ID) != 2 || s.liveSessions(t, bystander.ID) != 1 {
		t.Fatalf("live sessions after creating an admin: target %d, bystander %d; want 2 and 1",
			s.liveSessions(t, target.ID), s.liveSessions(t, bystander.ID))
	}

	out, err = seedAdmin(t, s.dbURL, target.Email, otherPassword)
	if err != nil || !strings.Contains(out, "its sessions are revoked") {
		t.Fatalf("make seed-admin (promote) = %v, want the output to say the sessions are revoked:\n%s", err, out)
	}
	if n := s.count(t, `SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, target.ID); n != 0 {
		t.Errorf("%d refresh tokens of the promoted account are not revoked", n)
	}
	for _, p := range []tokenPairOut{phone, laptop} {
		assertError(t, s.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": p.RefreshToken}, ""),
			http.StatusUnauthorized, "TOKEN_INVALID")
	}
	// Documented limit: no Redis in the seed, so the access token lives on
	// until it expires, still with the old role.
	if r := s.call(t, http.MethodGet, "/v1/me", nil, phone.AccessToken); r.Status != http.StatusOK {
		t.Errorf("the promoted account's access token = %d; the documented behaviour is that it works until it expires", r.Status)
	}
	assertError(t, s.call(t, http.MethodGet, adminProbe(), nil, phone.AccessToken), http.StatusForbidden, "FORBIDDEN")

	if n := s.count(t, `SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NOT NULL`, bystander.ID); n != 0 {
		t.Errorf("promoting another account revoked %d of the bystander's tokens", n)
	}
	s.refresh(t, bystanderPair.RefreshToken)
	if admin := s.login(t, target.Email, otherPassword); admin.User.Role != "admin" {
		t.Errorf("the promoted account logs in as %q, want admin", admin.User.Role)
	}
}
