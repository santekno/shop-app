package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/santekno/sdk/hashx"
)

// The password policy, after NIST SP 800-63B: a minimum length and a check
// against passwords everyone tries first, and no rules about digits or
// symbols, which make passwords harder to remember, not harder to guess.
const (
	// MinPasswordLength is the shortest password accepted, in characters.
	MinPasswordLength = 8
	// MaxPasswordLength bounds the work one login can cause; a password
	// manager's longest default is far below it.
	MaxPasswordLength = 128
)

// commonPasswords are passwords that appear at the top of every leaked
// list, compared case-insensitively. A real shop would check a large list
// (for example Have I Been Pwned's range API); a short one is enough to
// teach the rule.
var commonPasswords = map[string]bool{
	"12345678": true, "123456789": true, "1234567890": true, "11111111": true,
	"00000000": true, "87654321": true, "password": true, "password1": true,
	"password123": true, "passw0rd": true, "qwerty123": true, "qwertyuiop": true,
	"iloveyou": true, "abc12345": true, "abcd1234": true, "12341234": true,
	"admin123": true, "welcome1": true, "sayangku": true, "bismillah": true,
	"indonesia": true, "rahasia123": true, "goshop123": true, "goshop2026": true,
}

// PasswordError says why a password breaks the policy. Its message is safe
// to show the user and never repeats the password.
type PasswordError struct{ Reason string }

func (e *PasswordError) Error() string { return "password " + e.Reason }

// CheckPassword returns a *PasswordError when password breaks the policy,
// and nil otherwise. Length is counted in characters, not bytes, so
// "kata sandi rahasia" in any script is measured the way a person counts.
func CheckPassword(password string) error {
	n := utf8.RuneCountInString(password)
	switch {
	case n < MinPasswordLength || n > MaxPasswordLength:
		return &PasswordError{Reason: fmt.Sprintf("must be between %d and %d characters", MinPasswordLength, MaxPasswordLength)}
	case strings.TrimSpace(password) == "":
		return &PasswordError{Reason: "must not be only spaces"}
	case commonPasswords[strings.ToLower(password)]:
		return &PasswordError{Reason: "is too common; choose one that is not on a list of leaked passwords"}
	}
	return nil
}

// Hasher hashes and checks passwords. The API uses Argon2Hasher; a test can
// pass a fast fake.
type Hasher interface {
	// Hash returns the encoded hash of password, safe to store as it is.
	Hash(ctx context.Context, password string) (string, error)
	// Verify reports whether password matches hash. An empty hash (no such
	// user, or an account without a password) still costs one full
	// verification and returns false, so a caller cannot tell the cases
	// apart by timing.
	Verify(ctx context.Context, password, hash string) (bool, error)
}

// DefaultMaxConcurrentHashes is how many argon2id computations one API
// instance runs at once. Each takes 64 MiB, so four is 256 MiB at worst.
const DefaultMaxConcurrentHashes = 4

// Argon2Hasher hashes with sdk hashx (argon2id, m=64 MiB, t=3, p=4, 16-byte
// salt, 32-byte key; the parameters are encoded into every hash, so they
// can be raised later without breaking stored ones). At most a fixed number
// of hashes run at once; the rest wait their turn, or give up when their
// request ends, so a flood of logins cannot make the instance run out of
// memory.
type Argon2Hasher struct {
	slots chan struct{}

	dummyOnce sync.Once
	dummy     string
	dummyErr  error
}

// NewArgon2Hasher returns a hasher that runs at most maxConcurrent hashes
// at once (DefaultMaxConcurrentHashes when it is below 1).
func NewArgon2Hasher(maxConcurrent int) *Argon2Hasher {
	if maxConcurrent < 1 {
		maxConcurrent = DefaultMaxConcurrentHashes
	}
	return &Argon2Hasher{slots: make(chan struct{}, maxConcurrent)}
}

// Hash implements Hasher.
func (h *Argon2Hasher) Hash(ctx context.Context, password string) (string, error) {
	release, err := h.acquire(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	hash, err := hashx.HashPassword(password)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return hash, nil
}

// Verify implements Hasher.
func (h *Argon2Hasher) Verify(ctx context.Context, password, hash string) (bool, error) {
	usedDummy := hash == ""
	if usedDummy {
		dummy, err := h.dummyHash()
		if err != nil {
			return false, err
		}
		hash = dummy
	}
	release, err := h.acquire(ctx)
	if err != nil {
		return false, err
	}
	defer release()
	// Nobody knows the dummy's password, but even a match must not log in.
	return hashx.VerifyPassword(password, hash) && !usedDummy, nil
}

// acquire waits for a free slot, or for ctx to end.
func (h *Argon2Hasher) acquire(ctx context.Context) (release func(), err error) {
	select {
	case h.slots <- struct{}{}:
		return func() { <-h.slots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// dummyHash is the hash of a random password nobody knows, made once. It
// gives a login for an unknown email the same cost as a wrong password.
func (h *Argon2Hasher) dummyHash() (string, error) {
	h.dummyOnce.Do(func() {
		b := make([]byte, 32)
		_, _ = rand.Read(b) // crypto/rand.Read never fails (Go 1.24+)
		h.dummy, h.dummyErr = hashx.HashPassword(base64.RawStdEncoding.EncodeToString(b))
		if h.dummyErr != nil {
			h.dummyErr = fmt.Errorf("hash dummy password: %w", h.dummyErr)
		}
	})
	return h.dummy, h.dummyErr
}
