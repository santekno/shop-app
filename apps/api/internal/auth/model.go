// Package auth is how a user proves who they are and keeps proving it:
// registration, login, tokens, email verification, password reset, Google
// sign-in, and the middleware that turns a token into a user on every
// request. The design is ADR 0005.
package auth

import (
	"errors"
	"strings"
)

// Errors the service returns; the handler maps each one to a response.
var (
	// ErrEmailTaken means another account already uses the email.
	ErrEmailTaken = errors.New("email already registered")
	// ErrInvalidCredentials means the email and password do not match an
	// account. It is the same error whether the email is unknown, the
	// password is wrong or the account has no password, so a caller cannot
	// learn which accounts exist.
	ErrInvalidCredentials = errors.New("invalid email or password")
	// ErrInvalidText means a value cannot be stored as PostgreSQL text.
	ErrInvalidText = errors.New("invalid text")
)

// NormalizeEmail is the one form an email is stored and looked up in:
// trimmed and lower-case. Emails are limited to ASCII by the handler, so Go's
// and PostgreSQL's lower() agree on every character.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// isASCII reports whether s has only ASCII characters.
func isASCII(s string) bool {
	for i := range len(s) {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}
