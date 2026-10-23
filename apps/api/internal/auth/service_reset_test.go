package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestService_ForgotPassword(t *testing.T) {
	t.Run("emails a reset token to the account", func(t *testing.T) {
		env := newServiceEnv(t, func(d *Deps) { d.NewID = fixedIDs(t, id3) })
		var lookedUp string
		var stored NewEmailToken
		env.repo.getCredentials = func(email string) (Credentials, error) {
			lookedUp = email
			return Credentials{User: testUser()}, nil
		}
		env.repo.createEmailToken = func(t NewEmailToken) error { stored = t; return nil }

		testx.AssertNoError(t, env.svc.ForgotPassword(env.ctx, " BUDI@example.com"))

		testx.AssertEqual(t, lookedUp, "budi@example.com")
		testx.AssertEqual(t, stored.Purpose, PurposeResetPassword)
		testx.AssertEqual(t, stored.UserID, id1)
		testx.AssertTrue(t, stored.ExpiresAt.Equal(env.now.Add(30*time.Minute)), "reset tokens live 30 minutes: %v", stored.ExpiresAt)
		msgs := env.mailer.messages()
		testx.AssertEqual(t, len(msgs), 1)
		if len(msgs) == 1 {
			testx.AssertEqual(t, msgs[0].To, "budi@example.com")
			testx.AssertEqual(t, msgs[0].Subject, "Atur ulang kata sandi GoShop kamu")
			raw := tokenInBody(t, msgs[0].Body)
			parsed, ok := parseOpaqueToken(raw)
			testx.AssertTrue(t, ok)
			testx.AssertEqual(t, parsed.ID, id3)
			testx.AssertTrue(t, parsed.matches(stored.Token.Hash))
			testx.AssertContains(t, msgs[0].Body, "POST /v1/auth/reset-password")
		}
	})
	t.Run("an unknown email is not an error", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.getCredentials = func(string) (Credentials, error) { return Credentials{}, ErrNoUser }
		testx.AssertNoError(t, env.svc.ForgotPassword(env.ctx, "nobody@example.com"))
		testx.AssertEqual(t, len(env.mailer.messages()), 0)
	})
	t.Run("a sending failure is logged, not returned", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.mailer.err = errBoom
		env.repo.getCredentials = func(string) (Credentials, error) { return Credentials{User: testUser()}, nil }
		env.repo.createEmailToken = func(NewEmailToken) error { return nil }
		testx.AssertNoError(t, env.svc.ForgotPassword(env.ctx, "budi@example.com"))
		line, ok := findLog(t, env.logs, "send password reset email")
		testx.AssertTrue(t, ok, "logs: %s", env.logs.String())
		testx.AssertEqual(t, line["level"], any("ERROR"))
		testx.AssertFalse(t, strings.Contains(env.logs.String(), "budi@example.com"), "the address is not logged")
	})
	t.Run("a storing failure is logged, not returned", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.getCredentials = func(string) (Credentials, error) { return Credentials{User: testUser()}, nil }
		env.repo.createEmailToken = func(NewEmailToken) error { return errBoom }
		testx.AssertNoError(t, env.svc.ForgotPassword(env.ctx, "budi@example.com"))
		line, ok := findLog(t, env.logs, "send password reset email")
		testx.AssertTrue(t, ok)
		testx.AssertEqual(t, line["error"], any("new reset_password token: boom"))
		testx.AssertEqual(t, len(env.mailer.messages()), 0)
	})
	t.Run("the lookup fails", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.getCredentials = func(string) (Credentials, error) { return Credentials{}, errBoom }
		err := env.svc.ForgotPassword(env.ctx, "budi@example.com")
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "forgot password: "), "err = %v", err)
	})
}

func TestService_ResetPassword(t *testing.T) {
	raw, want := presentedToken(t, id1)

	t.Run("sets the hash and ends every session", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		var got opaqueToken
		var at time.Time
		var hash string
		env.repo.resetPassword = func(p opaqueToken, now time.Time, h string) ([]string, error) {
			got, at, hash = p, now, h
			return []string{id2, id3}, nil
		}

		testx.AssertNoError(t, env.svc.ResetPassword(env.ctx, raw, "kopi susu gula aren"))

		testx.AssertEqual(t, got.ID, want.ID)
		testx.AssertTrue(t, got.matches(want.Hash))
		testx.AssertTrue(t, at.Equal(env.now))
		testx.AssertEqual(t, hash, "hash:kopi susu gula aren")
		calls := env.revoked.revokeCalls()
		testx.AssertEqual(t, len(calls), 1, "one Revoke for every session: %v", calls)
		if len(calls) == 1 {
			testx.AssertEqual(t, strings.Join(calls[0], ","), id2+","+id3)
		}
	})
	t.Run("no session to end", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.resetPassword = func(opaqueToken, time.Time, string) ([]string, error) { return nil, nil }
		testx.AssertNoError(t, env.svc.ResetPassword(env.ctx, raw, "kopi susu gula aren"))
		testx.AssertEqual(t, len(env.revoked.revokeCalls()), 0)
	})
	t.Run("the policy is checked before the token", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		err := env.svc.ResetPassword(env.ctx, "garbage", "short")
		var pwErr *PasswordError
		testx.AssertTrue(t, errors.As(err, &pwErr), "err = %v, want the password error first", err)
	})
	t.Run("then the token, before any hash", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		err := env.svc.ResetPassword(env.ctx, "garbage", "kopi susu gula aren")
		testx.AssertTrue(t, errors.Is(err, ErrEmailTokenInvalid), "err = %v", err)
		testx.AssertEqual(t, len(env.hasher.hashed), 0, "a malformed token costs no argon2id hash")
	})
	t.Run("hashing fails", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.hasher.hashErr = errBoom
		err := env.svc.ResetPassword(env.ctx, raw, "kopi susu gula aren")
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "reset password: "), "err = %v", err)
	})
	for _, repoErr := range []error{ErrEmailTokenInvalid, ErrEmailTokenExpired, errBoom} {
		t.Run("repository says "+repoErr.Error(), func(t *testing.T) {
			env := newServiceEnv(t, nil)
			env.repo.resetPassword = func(opaqueToken, time.Time, string) ([]string, error) { return nil, repoErr }
			err := env.svc.ResetPassword(env.ctx, raw, "kopi susu gula aren")
			testx.AssertTrue(t, errors.Is(err, repoErr), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "reset password: "), "err = %v", err)
			testx.AssertEqual(t, len(env.revoked.revokeCalls()), 0)
		})
	}
}

// The reset committed in PostgreSQL is what counts: a Redis failure to end
// the access tokens is logged, and they expire on their own.
func TestService_ResetPasswordRevocationIsBestEffort(t *testing.T) {
	raw, _ := presentedToken(t, id1)
	env := newServiceEnv(t, nil)
	env.revoked.revokeErr = errBoom
	env.repo.resetPassword = func(opaqueToken, time.Time, string) ([]string, error) { return []string{id2, id3}, nil }

	testx.AssertNoError(t, env.svc.ResetPassword(env.ctx, raw, "kopi susu gula aren"))

	line, ok := findLog(t, env.logs, "revoke access tokens of ended sessions")
	testx.AssertTrue(t, ok, "logs: %s", env.logs.String())
	testx.AssertEqual(t, line["level"], any("ERROR"))
	testx.AssertEqual(t, line["sessions"], any(float64(2)))
	testx.AssertEqual(t, line["error"], any("boom"))
}
