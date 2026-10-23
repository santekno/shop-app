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
	if err != nil || !strings.Contains(out, "existing account promoted, password replaced") {
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
