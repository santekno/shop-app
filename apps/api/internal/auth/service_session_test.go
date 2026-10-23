package auth

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// presentedToken is a well-formed refresh token with id and its parsed form.
func presentedToken(t *testing.T, id string) (string, opaqueToken) {
	t.Helper()
	raw, tok, err := newOpaqueToken(zeroReader{}, func() string { return id })
	testx.AssertNoError(t, err)
	return raw, tok
}

func TestService_Refresh(t *testing.T) {
	raw, want := presentedToken(t, id1)
	env := newServiceEnv(t, func(d *Deps) { d.NewID = fixedIDs(t, id5) })
	seller := testUser()
	seller.Role = user.RoleSeller // the role read in the rotation, not the old token's
	var gotPresented, gotNext opaqueToken
	var gotNow, gotExpires time.Time
	env.repo.rotateRefreshToken = func(presented, next opaqueToken, now, expires time.Time) (Rotated, error) {
		gotPresented, gotNext, gotNow, gotExpires = presented, next, now, expires
		return Rotated{User: seller, FamilyID: id2}, nil
	}

	tokens, err := env.svc.Refresh(env.ctx, raw)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, gotPresented.ID, want.ID)
	testx.AssertTrue(t, gotPresented.matches(want.Hash), "the presented hash reaches the repository")
	testx.AssertEqual(t, gotNext.ID, id5)
	testx.AssertTrue(t, gotNow.Equal(env.now))
	testx.AssertTrue(t, gotExpires.Equal(env.now.Add(30*24*time.Hour)), "next expiry %v", gotExpires)

	testx.AssertEqual(t, tokens.SessionID, id2, "the same session")
	testx.AssertTrue(t, strings.HasPrefix(tokens.RefreshToken, id5+"."), "new refresh token %q", tokens.RefreshToken)
	testx.AssertNotEqual(t, tokens.RefreshToken, raw)
	next, ok := parseOpaqueToken(tokens.RefreshToken)
	testx.AssertTrue(t, ok)
	testx.AssertTrue(t, next.matches(gotNext.Hash), "the stored hash is the returned token's")
	testx.AssertTrue(t, tokens.RefreshExpiresAt.Equal(gotExpires))
	claims := checkAccess(t, env.access, tokens.AccessToken)
	testx.AssertEqual(t, claims.SessionID, id2)
	testx.AssertEqual(t, claims.Role, user.RoleSeller)
	testx.AssertEqual(t, len(env.revoked.revokeCalls()), 0, "a good refresh revokes nothing")
}

func TestService_RefreshMalformedTokenSkipsTheDatabase(t *testing.T) {
	for _, token := range []string{"", "nope", "not-a-uuid.abc", id1 + ".short"} {
		env := newServiceEnv(t, nil) // repo has no rotateRefreshToken: a call fails the test
		_, err := env.svc.Refresh(env.ctx, token)
		testx.AssertTrue(t, errors.Is(err, ErrRefreshTokenInvalid), "Refresh(%q) err = %v", token, err)
	}
}

// A rotated token presented again means two parties hold it: the session is
// revoked, its access tokens too, and the caller is told only "invalid".
func TestService_RefreshReuseRevokesTheSession(t *testing.T) {
	raw, _ := presentedToken(t, id1)
	env := newServiceEnv(t, nil)
	env.repo.rotateRefreshToken = func(_, _ opaqueToken, _, _ time.Time) (Rotated, error) {
		return Rotated{FamilyID: id2}, ErrRefreshTokenReused
	}

	tokens, err := env.svc.Refresh(env.ctx, raw)

	testx.AssertTrue(t, errors.Is(err, ErrRefreshTokenInvalid), "err = %v, want ErrRefreshTokenInvalid", err)
	testx.AssertEqual(t, tokens.AccessToken, "")
	calls := env.revoked.revokeCalls()
	testx.AssertEqual(t, len(calls), 1, "Revocations.Revoke calls: %v", calls)
	if len(calls) == 1 {
		testx.AssertEqual(t, strings.Join(calls[0], ","), id2)
	}
	line, ok := findLog(t, env.logs, "refresh token reused; session revoked")
	testx.AssertTrue(t, ok, "logs: %s", env.logs.String())
	testx.AssertEqual(t, line["level"], any("WARN"))
	testx.AssertEqual(t, line["session_id"], any(id2))
}

func TestService_RefreshErrors(t *testing.T) {
	raw, _ := presentedToken(t, id1)
	tests := []struct {
		name   string
		repo   error
		wantIs error
	}{
		{name: "invalid", repo: ErrRefreshTokenInvalid, wantIs: ErrRefreshTokenInvalid},
		{name: "expired", repo: ErrRefreshTokenExpired, wantIs: ErrRefreshTokenExpired},
		{name: "database", repo: errBoom, wantIs: errBoom},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv(t, nil)
			env.repo.rotateRefreshToken = func(_, _ opaqueToken, _, _ time.Time) (Rotated, error) {
				return Rotated{}, tt.repo
			}
			_, err := env.svc.Refresh(env.ctx, raw)
			testx.AssertTrue(t, errors.Is(err, tt.wantIs), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "refresh: "), "err = %v", err)
			testx.AssertEqual(t, len(env.revoked.revokeCalls()), 0)
		})
	}
	t.Run("no randomness", func(t *testing.T) {
		env := newServiceEnv(t, func(d *Deps) { d.Random = failingReader{} })
		_, err := env.svc.Refresh(env.ctx, raw)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "refresh: read random token"), "err = %v", err)
	})
}

func TestService_Logout(t *testing.T) {
	raw, want := presentedToken(t, id1)

	t.Run("revokes the session and its access tokens", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		var got opaqueToken
		env.repo.revokeSessionOf = func(p opaqueToken) (string, error) { got = p; return id2, nil }
		testx.AssertNoError(t, env.svc.Logout(env.ctx, raw))
		testx.AssertEqual(t, got.ID, want.ID)
		testx.AssertTrue(t, got.matches(want.Hash))
		calls := env.revoked.revokeCalls()
		testx.AssertEqual(t, len(calls), 1)
		if len(calls) == 1 {
			testx.AssertEqual(t, strings.Join(calls[0], ","), id2)
		}
	})
	t.Run("a malformed token is already logged out", func(t *testing.T) {
		env := newServiceEnv(t, nil) // no revokeSessionOf: a query fails the test
		testx.AssertNoError(t, env.svc.Logout(env.ctx, "garbage"))
		testx.AssertEqual(t, len(env.revoked.revokeCalls()), 0)
	})
	t.Run("an unknown or revoked token is already logged out", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.revokeSessionOf = func(opaqueToken) (string, error) { return "", nil }
		testx.AssertNoError(t, env.svc.Logout(env.ctx, raw))
		testx.AssertEqual(t, len(env.revoked.revokeCalls()), 0, "nothing to revoke in Redis")
	})
	t.Run("the database fails", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.revokeSessionOf = func(opaqueToken) (string, error) { return "", errBoom }
		err := env.svc.Logout(env.ctx, raw)
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "logout: "), "err = %v", err)
	})
}

// A password reset or account deletion that commits while the password is
// being verified makes the session refused; Login reports that exactly
// like a wrong password, so it reveals nothing about the account.
func TestService_LoginRacesAResetOrDeletion(t *testing.T) {
	tests := []struct {
		name   string
		repo   error
		want   error
		prefix string
	}{
		{name: "deleted meanwhile", repo: ErrNoUser, want: ErrInvalidCredentials},
		{name: "password reset meanwhile", repo: ErrInvalidCredentials, want: ErrInvalidCredentials},
		{name: "wrapped by the repository", repo: fmt.Errorf("tx: %w", ErrNoUser), want: ErrInvalidCredentials},
		{name: "database", repo: errBoom, prefix: "start session: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv(t, nil)
			env.repo.getCredentials = func(string) (Credentials, error) {
				return Credentials{User: testUser(), Hash: "hash:kopi susu gula aren"}, nil
			}
			var verified string
			env.repo.createRefreshToken = func(t NewRefreshToken) error { verified = t.VerifiedHash; return tt.repo }

			tokens, err := env.svc.Login(env.ctx, "budi@example.com", "kopi susu gula aren")

			testx.AssertEqual(t, verified, "hash:kopi susu gula aren", "the hash Login verified is re-checked")
			testx.AssertEqual(t, tokens.AccessToken, "")
			if tt.want != nil {
				testx.AssertTrue(t, err == tt.want, "err = %v, want exactly %v", err, tt.want) //nolint:errorlint // no wrapped cause may leak
				return
			}
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertFalse(t, errors.Is(err, ErrInvalidCredentials))
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
		})
	}
}
