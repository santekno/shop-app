//go:build integration

package integration_test

import (
	"net/http"
	"strings"
	"testing"
)

// TestRegister_CreatesBuyer registers over HTTP and checks the response
// against the contract and the row PostgreSQL stored: a buyer with a
// trimmed, lower-cased email, an unverified address and an argon2id hash
// (never the password, never in the response).
func TestRegister_CreatesBuyer(t *testing.T) {
	s := startServer(t, nil)
	email := uniqueEmail("Budi.Santoso")

	resp := s.call(t, http.MethodPost, "/v1/auth/register", map[string]string{
		"email": "  " + strings.ToUpper(email) + " ", "password": testPassword, "name": "  Budi Santoso ",
	}, "")
	u := assertUserDetail(t, resp, http.StatusCreated, "POST /v1/auth/register")
	if u.Email != email || u.Name != "Budi Santoso" || u.Role != "buyer" || u.EmailVerified || u.Phone != nil {
		t.Errorf("registered user = %+v, want %s, trimmed name, buyer, unverified, no phone", u, email)
	}
	if strings.Contains(string(resp.Body), testPassword) || strings.Contains(string(resp.Body), "argon2") {
		t.Errorf("the response reveals the password or its hash: %s", resp.Body)
	}

	var stored struct {
		email, hash, role string
		verified          bool
	}
	err := s.db.QueryRowContext(t.Context(), `SELECT email, password_hash, role, email_verified_at IS NOT NULL
		FROM users WHERE id = $1`, u.ID).Scan(&stored.email, &stored.hash, &stored.role, &stored.verified)
	if err != nil {
		t.Fatalf("read the stored user: %v", err)
	}
	if stored.email != email || stored.role != "buyer" || stored.verified {
		t.Errorf("stored user = %+v", stored)
	}
	// sdk hashx's PHC string: the parameters travel with every hash.
	if !strings.HasPrefix(stored.hash, "$argon2id$v=19$m=65536,t=3,p=4$") || strings.Contains(stored.hash, testPassword) {
		t.Errorf("password_hash = %q, want an argon2id PHC string (m=64 MiB, t=3, p=4)", stored.hash)
	}

	// The same address in another case is the same account.
	dup := s.call(t, http.MethodPost, "/v1/auth/register", map[string]string{
		"email": strings.ToUpper(email), "password": otherPassword, "name": "Budi Lain",
	}, "")
	details := assertError(t, dup, http.StatusConflict, "EMAIL_TAKEN")
	if _, ok := details["email"]; !ok {
		t.Errorf("EMAIL_TAKEN details = %v, want the email field named", details)
	}
	if n := s.count(t, `SELECT count(*) FROM users`); n != 1 {
		t.Errorf("%d users after a duplicate registration, want 1", n)
	}
}

// TestRegister_Validation sends invalid registrations: every invalid field
// is reported in one 400, the password policy (length, only spaces, a
// leaked password) speaks through details.password, and nothing is stored.
func TestRegister_Validation(t *testing.T) {
	s := startServer(t, nil, withUnlimitedRate())
	tests := []struct {
		name       string
		body       any
		wantFields []string
		wantText   string // part of details.password, when it matters
	}{
		{"every field wrong", map[string]string{"email": "bukan-email", "password": "pendek", "name": ""},
			[]string{"email", "password", "name"}, "between 8 and 128"},
		{"leaked password", map[string]string{"email": uniqueEmail("x"), "password": "Password123", "name": "X"},
			[]string{"password"}, "too common"},
		{"only spaces", map[string]string{"email": uniqueEmail("x"), "password": strings.Repeat(" ", 10), "name": "X"},
			[]string{"password"}, "only spaces"},
		{"129 characters", map[string]string{"email": uniqueEmail("x"), "password": strings.Repeat("é", 129), "name": "X"},
			[]string{"password"}, "between 8 and 128"},
		{"non-ASCII email", map[string]string{"email": "budi@contöh.example", "password": testPassword, "name": "X"},
			[]string{"email"}, ""},
		{"name too long", map[string]string{"email": uniqueEmail("x"), "password": testPassword, "name": strings.Repeat("n", 101)},
			[]string{"name"}, ""},
		{"NUL in name", map[string]string{"email": uniqueEmail("x"), "password": testPassword, "name": "Bu\x00di"},
			[]string{"name"}, ""},
		{"missing body fields", map[string]string{}, []string{"email", "password", "name"}, ""},
		{"not JSON", `{"email":`, []string{"body"}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			details := assertError(t, s.call(t, http.MethodPost, "/v1/auth/register", tt.body, ""),
				http.StatusBadRequest, "VALIDATION_FAILED")
			for _, f := range tt.wantFields {
				if _, ok := details[f]; !ok {
					t.Errorf("details = %v, want a message for %q", details, f)
				}
			}
			if tt.wantText != "" {
				if msg, _ := details["password"].(string); !strings.Contains(msg, tt.wantText) {
					t.Errorf("details.password = %q, want it to mention %q", msg, tt.wantText)
				}
			}
		})
	}
	if n := s.count(t, `SELECT count(*) FROM users`); n != 0 {
		t.Errorf("%d users stored by invalid registrations", n)
	}
}
