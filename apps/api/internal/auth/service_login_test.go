package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/jwtx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestService_Login(t *testing.T) {
	var stored NewRefreshToken
	var lookedUp string
	// newID order: the refresh token's row id, then the session id.
	env := newServiceEnv(t, func(d *Deps) { d.NewID = fixedIDs(t, id3, id4) })
	u := testUser()
	u.Role = user.RoleAdmin
	env.repo.getCredentials = func(email string) (Credentials, error) {
		lookedUp = email
		return Credentials{User: u, Hash: "hash:kopi susu gula aren"}, nil
	}
	env.repo.createRefreshToken = func(t NewRefreshToken) error { stored = t; return nil }

	tokens, err := env.svc.Login(env.ctx, " Budi@Example.com ", "kopi susu gula aren")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, lookedUp, "budi@example.com", "looked up by the normalised email")
	testx.AssertEqual(t, tokens.User.ID, u.ID)

	// A new session: the family id is the session id, and the access
	// token carries it as sid.
	testx.AssertEqual(t, tokens.SessionID, id4)
	testx.AssertEqual(t, stored.FamilyID, id4)
	testx.AssertEqual(t, stored.UserID, u.ID)
	testx.AssertEqual(t, stored.Token.ID, id3)
	testx.AssertTrue(t, stored.ExpiresAt.Equal(env.now.Add(30*24*time.Hour)), "refresh expiry %v", stored.ExpiresAt)
	testx.AssertTrue(t, tokens.RefreshExpiresAt.Equal(stored.ExpiresAt))
	testx.AssertTrue(t, strings.HasPrefix(tokens.RefreshToken, id3+"."), "refresh token %q", tokens.RefreshToken)
	presented, ok := parseOpaqueToken(tokens.RefreshToken)
	testx.AssertTrue(t, ok)
	testx.AssertTrue(t, presented.matches(stored.Token.Hash), "the stored hash is the returned token's")

	claims := checkAccess(t, env.access, tokens.AccessToken)
	testx.AssertEqual(t, claims.SessionID, id4)
	testx.AssertEqual(t, claims.UserID, u.ID)
	testx.AssertEqual(t, claims.Role, user.RoleAdmin)
	testx.AssertTrue(t, tokens.AccessExpiresAt.Equal(claims.ExpiresAt))
}

// Every failure is ErrInvalidCredentials, and each one costs a password
// verification: an unknown email and a passwordless account are checked
// against the dummy (the empty hash), so timing does not tell them apart.
func TestService_LoginFailuresLookAlike(t *testing.T) {
	tests := []struct {
		name     string
		creds    Credentials
		err      error
		password string
	}{
		{name: "unknown email", err: ErrNoUser, password: "kopi susu gula aren"},                                                  //nolint:gosec // a test value, not a credential
		{name: "account without a password", creds: Credentials{User: testUser(), Hash: ""}, password: "kopi susu gula aren"},     //nolint:gosec // a test value, not a credential
		{name: "wrong password", creds: Credentials{User: testUser(), Hash: "hash:another one"}, password: "kopi susu gula aren"}, //nolint:gosec // a test value, not a credential
		{name: "empty password", creds: Credentials{User: testUser(), Hash: "hash:kopi susu gula aren"}, password: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv(t, nil)
			env.repo.getCredentials = func(string) (Credentials, error) { return tt.creds, tt.err }

			tokens, err := env.svc.Login(env.ctx, "budi@example.com", tt.password)

			testx.AssertTrue(t, errors.Is(err, ErrInvalidCredentials), "err = %v, want exactly ErrInvalidCredentials", err)
			testx.AssertEqual(t, tokens.AccessToken, "")
			testx.AssertEqual(t, len(env.hasher.verified), 1, "one verification on every path")
			if len(env.hasher.verified) == 1 {
				testx.AssertEqual(t, env.hasher.verified[0], tt.creds.Hash)
			}
		})
	}
}

func TestService_LoginErrors(t *testing.T) {
	t.Run("the lookup fails", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.getCredentials = func(string) (Credentials, error) { return Credentials{}, errBoom }
		_, err := env.svc.Login(env.ctx, "budi@example.com", "kopi susu gula aren")
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertFalse(t, errors.Is(err, ErrInvalidCredentials), "a database failure is not a wrong password")
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "login: "), "err = %v", err)
		testx.AssertEqual(t, len(env.hasher.verified), 0)
	})
	t.Run("the verification fails", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.hasher.verifyErr = errBoom
		env.repo.getCredentials = func(string) (Credentials, error) { return Credentials{User: testUser(), Hash: "h"}, nil }
		_, err := env.svc.Login(env.ctx, "budi@example.com", "kopi susu gula aren")
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "login: "), "err = %v", err)
	})
	t.Run("the session cannot be stored", func(t *testing.T) {
		env := newServiceEnv(t, nil)
		env.repo.getCredentials = func(string) (Credentials, error) {
			return Credentials{User: testUser(), Hash: "hash:kopi susu gula aren"}, nil
		}
		env.repo.createRefreshToken = func(NewRefreshToken) error { return errBoom }
		tokens, err := env.svc.Login(env.ctx, "budi@example.com", "kopi susu gula aren")
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "start session: "), "err = %v", err)
		testx.AssertEqual(t, tokens.AccessToken, "")
	})
	t.Run("no randomness", func(t *testing.T) {
		env := newServiceEnv(t, func(d *Deps) { d.Random = failingReader{} })
		env.repo.getCredentials = func(string) (Credentials, error) {
			return Credentials{User: testUser(), Hash: "hash:kopi susu gula aren"}, nil
		}
		_, err := env.svc.Login(env.ctx, "budi@example.com", "kopi susu gula aren")
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "start session: read random token: "), "err = %v", err)
	})
	t.Run("the access token cannot be signed", func(t *testing.T) {
		env := newServiceEnv(t, func(d *Deps) { d.Access = NewAccessTokens(nil, time.Minute, nil) })
		env.repo.getCredentials = func(string) (Credentials, error) {
			return Credentials{User: testUser(), Hash: "hash:kopi susu gula aren"}, nil
		}
		env.repo.createRefreshToken = func(NewRefreshToken) error { return nil }
		tokens, err := env.svc.Login(env.ctx, "budi@example.com", "kopi susu gula aren")
		testx.AssertError(t, err)
		testx.AssertContains(t, err.Error(), "sign access token")
		testx.AssertEqual(t, tokens.RefreshToken, "", "no half-built tokens are returned")
	})
}

// checkAccess verifies an access token the way Guard does and returns its
// claims.
func checkAccess(t *testing.T, tokens *AccessTokens, raw string) AccessClaims {
	t.Helper()
	verified, err := jwtx.Verify(raw, tokens.Key())
	if err != nil {
		t.Fatalf("verify access token: %v", err)
	}
	claims, err := tokens.Check(verified)
	if err != nil {
		t.Fatalf("check access token: %v", err)
	}
	return claims
}
