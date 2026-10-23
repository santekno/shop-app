package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestService_ResendVerification(t *testing.T) {
	t.Run("sends a new token to an unverified account", func(t *testing.T) {
		env := newServiceEnv(t, func(d *Deps) { d.NewID = fixedIDs(t, id3) })
		var asked string
		var stored NewEmailToken
		env.repo.getUser = func(id string) (user.User, error) { asked = id; return testUser(), nil }
		env.repo.createEmailToken = func(t NewEmailToken) error { stored = t; return nil }

		testx.AssertNoError(t, env.svc.ResendVerification(env.ctx, id1))

		testx.AssertEqual(t, asked, id1)
		testx.AssertEqual(t, stored.UserID, id1)
		testx.AssertEqual(t, stored.Purpose, PurposeVerifyEmail)
		testx.AssertTrue(t, stored.ExpiresAt.Equal(env.now.Add(VerifyEmailTTL)))
		msgs := env.mailer.messages()
		testx.AssertEqual(t, len(msgs), 1)
		if len(msgs) == 1 {
			testx.AssertEqual(t, msgs[0].To, "budi@example.com")
			testx.AssertTrue(t, strings.HasPrefix(tokenInBody(t, msgs[0].Body), id3+"."))
		}
	})
	t.Run("does nothing for a verified account", func(t *testing.T) {
		env := newServiceEnv(t, nil) // no createEmailToken: storing a token fails the test
		verified := testUser()
		at := time.Now()
		verified.EmailVerifiedAt = &at
		env.repo.getUser = func(string) (user.User, error) { return verified, nil }
		testx.AssertNoError(t, env.svc.ResendVerification(env.ctx, id1))
		testx.AssertEqual(t, len(env.mailer.messages()), 0)
	})
	t.Run("the account is gone", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.getUser = func(string) (user.User, error) { return user.User{}, ErrNoUser }
		err := env.svc.ResendVerification(env.ctx, id1)
		testx.AssertTrue(t, errors.Is(err, ErrNoUser), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "resend verification: "), "err = %v", err)
	})
	t.Run("sending fails: the caller hears about it", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.mailer.err = errBoom
		env.repo.getUser = func(string) (user.User, error) { return testUser(), nil }
		env.repo.createEmailToken = func(NewEmailToken) error { return nil }
		err := env.svc.ResendVerification(env.ctx, id1)
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), `send "Verifikasi email akun GoShop kamu": boom`)
	})
	t.Run("no randomness", func(t *testing.T) {
		env := newServiceEnv(t, func(d *Deps) { d.Random = failingReader{} })
		env.repo.getUser = func(string) (user.User, error) { return testUser(), nil }
		err := env.svc.ResendVerification(env.ctx, id1)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "new verify_email token: read random token"), "err = %v", err)
	})
}

func TestService_VerifyEmail(t *testing.T) {
	raw, want := presentedToken(t, id1)

	t.Run("uses the token", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		var got opaqueToken
		var at time.Time
		env.repo.verifyEmail = func(p opaqueToken, now time.Time) error { got, at = p, now; return nil }
		testx.AssertNoError(t, env.svc.VerifyEmail(env.ctx, raw))
		testx.AssertEqual(t, got.ID, want.ID)
		testx.AssertTrue(t, got.matches(want.Hash))
		testx.AssertTrue(t, at.Equal(env.now))
	})
	t.Run("a malformed token is invalid without a query", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		err := env.svc.VerifyEmail(env.ctx, "garbage")
		testx.AssertTrue(t, errors.Is(err, ErrEmailTokenInvalid), "err = %v", err)
	})
	for _, repoErr := range []error{ErrEmailTokenInvalid, ErrEmailTokenExpired, errBoom} {
		t.Run("repository says "+repoErr.Error(), func(t *testing.T) {
			env := newServiceEnv(t, nil)
			env.repo.verifyEmail = func(opaqueToken, time.Time) error { return repoErr }
			err := env.svc.VerifyEmail(env.ctx, raw)
			testx.AssertTrue(t, errors.Is(err, repoErr), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "verify email: "), "err = %v", err)
		})
	}
}
