package main

// seedAdmin's upsert runs against PostgreSQL (make seed-admin, and the
// integration tests); here are its refusals, which return before the
// database is touched (db is nil), and the socket-only URLs of requireLocal.

import (
	"context"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

func TestSeedAdmin_Refusals(t *testing.T) {
	tests := []struct {
		name     string
		email    string
		password string
		wantErr  string
	}{
		{name: "not an email", email: "admin", password: "kopi susu gula aren", wantErr: `-admin "admin" is not an email address`}, //nolint:gosec // a test value, not a credential
		{name: "empty email", email: "  ", password: "kopi susu gula aren", wantErr: `-admin "" is not an email address`},          //nolint:gosec // a test value, not a credential
		{name: "a display name is not an address", email: "Admin <admin@goshop.local>", password: "kopi susu gula aren", //nolint:gosec // a test value, not a credential
			wantErr: "is not an email address"},
		{name: "no password", email: "admin@goshop.local", password: "",
			wantErr: "SEED_ADMIN_PASSWORD is not set (make seed-admin needs it)"},
		{name: "short password", email: "admin@goshop.local", password: "admin",
			wantErr: "SEED_ADMIN_PASSWORD: password must be between 8 and 128 characters"},
		{name: "common password", email: "admin@goshop.local", password: "Admin123",
			wantErr: "SEED_ADMIN_PASSWORD: password is too common"},
		{name: "only spaces", email: "admin@goshop.local", password: "         ",
			wantErr: "SEED_ADMIN_PASSWORD: password must not be only spaces"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			created, err := seedAdmin(context.Background(), nil, tt.email, tt.password)
			testx.AssertFalse(t, created)
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
			if tt.password != "" && strings.TrimSpace(tt.password) != "" {
				testx.AssertFalse(t, strings.Contains(err.Error(), tt.password), "the password is repeated: %v", err)
			}
		})
	}
}

// The email is normalised before it is checked, so "Admin@GoShop.local "
// is accepted as admin@goshop.local (it then fails on the password here,
// which proves the email check passed).
func TestSeedAdmin_NormalisesTheEmail(t *testing.T) {
	_, err := seedAdmin(context.Background(), nil, " Admin@GoShop.local ", "")
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "SEED_ADMIN_PASSWORD is not set")
}

func TestRunAdmin_Guards(t *testing.T) {
	err := runAdmin(context.Background(), "", "admin@goshop.local", "kopi susu gula aren")
	testx.AssertError(t, err)
	testx.AssertEqual(t, err.Error(), "DATABASE_URL is not set (make seed-admin sets it to the Compose postgres)")

	// Nothing listens on port 1: the database cannot be opened.
	err = runAdmin(context.Background(), "postgres://user:pass@127.0.0.1:1/goshop?sslmode=disable", "admin@goshop.local", "kopi susu gula aren")
	testx.AssertError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "err = %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), "user:pass"), "the URL is repeated: %v", err)
}

// A socket-only URL has no host of its own: host= says where it connects,
// and without it pgx falls back to PGHOST, so an empty host is refused.
func TestRequireLocal_SocketOnly(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr string
	}{
		{name: "socket directory", url: "postgres:///goshop?host=/var/run/postgresql"},
		{name: "socket and loopback", url: "postgres:///goshop?host=/tmp,127.0.0.1"},
		{name: "no host anywhere", url: "postgres:///goshop", wantErr: `refusing to seed the database on ""`},
		{name: "empty host= value", url: "postgres:///goshop?host=", wantErr: `refusing to seed the database on ""`},
		{name: "remote host= without a URL host", url: "postgres:///goshop?host=db.example.com", wantErr: `on "db.example.com"`},
		{name: "remote hostaddr= without a URL host", url: "postgres:///goshop?host=/tmp&hostaddr=10.0.0.5", wantErr: `on "10.0.0.5"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := requireLocal(tt.url, false)
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}
