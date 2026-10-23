package auth

import (
	"net/http"

	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/errx"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func googleIdentity() GoogleIdentity {
	return GoogleIdentity{Subject: "google-sub-1", Email: " Budi@Gmail.com ", EmailVerified: true, Name: "  Budi Santoso "}
}

// googleEnv is a service whose Google verifier returns id.
func googleEnv(t *testing.T, id GoogleIdentity, ids ...string) (*serviceEnv, *fakeGoogle) {
	t.Helper()
	g := &fakeGoogle{id: id}
	env := newServiceEnv(t, func(d *Deps) {
		d.Google = g
		if len(ids) > 0 {
			d.NewID = fixedIDs(t, ids...)
		}
	})
	return env, g
}

func TestService_GoogleLoginDisabled(t *testing.T) {
	env := newServiceEnv(t, nil) // Google is nil
	_, err := env.svc.GoogleLogin(env.ctx, "id-token")
	testx.AssertTrue(t, errors.Is(err, ErrGoogleDisabled), "err = %v", err)
}

func TestService_GoogleLoginTokenRefused(t *testing.T) {
	env, g := googleEnv(t, GoogleIdentity{})
	g.err = errors.New("oidc: token is expired")

	_, err := env.svc.GoogleLogin(env.ctx, "id-token")

	testx.AssertTrue(t, errors.Is(err, ErrGoogleTokenInvalid), "err = %v", err)
	testx.AssertEqual(t, strings.Join(g.calls, ","), "id-token")
	line, ok := findLog(t, env.logs, "google id token refused")
	testx.AssertTrue(t, ok, "logs: %s", env.logs.String())
	testx.AssertEqual(t, line["level"], any("INFO"))
	testx.AssertEqual(t, line["error"], any("oidc: token is expired"))
}

// A known subject logs in to its account, whatever email Google now says.
func TestService_GoogleLoginKnownSubject(t *testing.T) {
	id := googleIdentity()
	id.Email = "someone-else@gmail.com"
	env, _ := googleEnv(t, id, id3, id4)
	var provider, subject string
	env.repo.getUserByIdentity = func(p, s string) (user.User, error) { provider, subject = p, s; return testUser(), nil }
	env.repo.createRefreshToken = func(NewRefreshToken) error { return nil }

	tokens, err := env.svc.GoogleLogin(env.ctx, "id-token")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, provider, "google")
	testx.AssertEqual(t, subject, "google-sub-1")
	testx.AssertEqual(t, tokens.User.ID, id1)
	testx.AssertEqual(t, tokens.SessionID, id4)
	testx.AssertEqual(t, checkAccess(t, env.access, tokens.AccessToken).SessionID, id4)
}

func TestService_GoogleLoginNewSubject(t *testing.T) {
	// ids: user, identity, refresh token row, session.
	env, _ := googleEnv(t, googleIdentity(), id1, id2, id3, id4)
	env.repo.getUserByIdentity = func(string, string) (user.User, error) { return user.User{}, ErrNoUser }
	var created NewUser
	var identityID, provider, subject string
	env.repo.createUserWithIdentity = func(u NewUser, iid, p, s string) (user.User, error) {
		created, identityID, provider, subject = u, iid, p, s
		return user.User{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role}, nil
	}
	env.repo.createRefreshToken = func(NewRefreshToken) error { return nil }

	tokens, err := env.svc.GoogleLogin(env.ctx, "id-token")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, created.ID, id1)
	testx.AssertEqual(t, created.Email, "budi@gmail.com")
	testx.AssertEqual(t, created.Name, "Budi Santoso")
	testx.AssertEqual(t, created.Role, user.RoleBuyer)
	testx.AssertEqual(t, created.PasswordHash, "", "a Google account has no password")
	testx.AssertEqual(t, identityID, id2)
	testx.AssertEqual(t, provider, ProviderGoogle)
	testx.AssertEqual(t, subject, "google-sub-1")
	testx.AssertEqual(t, tokens.User.ID, id1)
	testx.AssertEqual(t, tokens.SessionID, id4)
}

func TestService_GoogleLoginNewSubjectRefusals(t *testing.T) {
	tests := []struct {
		name   string
		change func(id *GoogleIdentity)
		want   error
	}{
		{name: "email not verified", change: func(id *GoogleIdentity) { id.EmailVerified = false }, want: ErrGoogleEmailUnverified},
		{name: "no email", change: func(id *GoogleIdentity) { id.Email = "  " }, want: ErrGoogleEmailUnverified},
		{name: "non-ASCII email", change: func(id *GoogleIdentity) { id.Email = "büdi@gmail.com" }, want: ErrGoogleTokenInvalid},
		{name: "email over 254 bytes", change: func(id *GoogleIdentity) {
			id.Email = strings.Repeat("a", 245) + "@gmail.com" // 255
		}, want: ErrGoogleTokenInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id := googleIdentity()
			tt.change(&id)
			env, _ := googleEnv(t, id) // no createUserWithIdentity: creating fails the test
			env.repo.getUserByIdentity = func(string, string) (user.User, error) { return user.User{}, ErrNoUser }
			_, err := env.svc.GoogleLogin(env.ctx, "id-token")
			testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "google login: "), "err = %v", err)
		})
	}
}

func TestService_GoogleLoginEmail254IsAccepted(t *testing.T) {
	id := googleIdentity()
	id.Email = strings.Repeat("a", 244) + "@gmail.com" // 254
	env, _ := googleEnv(t, id)
	env.repo.getUserByIdentity = func(string, string) (user.User, error) { return user.User{}, ErrNoUser }
	var email string
	env.repo.createUserWithIdentity = func(u NewUser, _, _, _ string) (user.User, error) { email = u.Email; return user.User{ID: u.ID}, nil }
	env.repo.createRefreshToken = func(NewRefreshToken) error { return nil }
	_, err := env.svc.GoogleLogin(env.ctx, "id-token")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(email), 254)
}

// An email that already has an account is not linked: matching by email
// would hand the account to whoever controls that Google address.
func TestService_GoogleLoginEmailTaken(t *testing.T) {
	env, _ := googleEnv(t, googleIdentity())
	env.repo.getUserByIdentity = func(string, string) (user.User, error) { return user.User{}, ErrNoUser }
	env.repo.createUserWithIdentity = func(NewUser, string, string, string) (user.User, error) {
		return user.User{}, ErrEmailTaken
	}
	tokens, err := env.svc.GoogleLogin(env.ctx, "id-token")
	testx.AssertTrue(t, errors.Is(err, ErrEmailTaken), "err = %v", err)
	testx.AssertEqual(t, tokens.AccessToken, "")
}

// Two first sign-ins raced and the other one linked the identity: this one
// logs in to the account the other created.
func TestService_GoogleLoginIdentityRace(t *testing.T) {
	env, _ := googleEnv(t, googleIdentity())
	lookups := 0
	env.repo.getUserByIdentity = func(string, string) (user.User, error) {
		lookups++
		if lookups == 1 {
			return user.User{}, ErrNoUser
		}
		return testUser(), nil
	}
	env.repo.createUserWithIdentity = func(NewUser, string, string, string) (user.User, error) {
		return user.User{}, ErrIdentityTaken
	}
	env.repo.createRefreshToken = func(NewRefreshToken) error { return nil }

	tokens, err := env.svc.GoogleLogin(env.ctx, "id-token")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, lookups, 2)
	testx.AssertEqual(t, tokens.User.ID, id1)
}

func TestService_GoogleLoginLookupFails(t *testing.T) {
	env, _ := googleEnv(t, googleIdentity())
	env.repo.getUserByIdentity = func(string, string) (user.User, error) { return user.User{}, errBoom }
	_, err := env.svc.GoogleLogin(env.ctx, "id-token")
	testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "google login: "), "err = %v", err)
}

func TestGoogleName(t *testing.T) {
	long := strings.Repeat("é", 99) + " xyz"
	tests := []struct {
		name, in, want string
	}{
		{name: "trimmed", in: "  Budi Santoso ", want: "Budi Santoso"},
		{name: "empty uses the local part", in: "", want: "budi"},
		{name: "only spaces uses the local part", in: "   ", want: "budi"},
		{name: "NUL uses the local part", in: "Bu\x00di", want: "budi"},
		{name: "invalid UTF-8 uses the local part", in: "Bu\xffdi", want: "budi"},
		{name: "exactly 100 characters", in: strings.Repeat("é", 100), want: strings.Repeat("é", 100)},
		// Cut at 100 runes (99 é and a space), then trimmed again.
		{name: "cut to 100 characters", in: long, want: strings.Repeat("é", 99)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testx.AssertEqual(t, googleName(tt.in, "budi@gmail.com"), tt.want)
		})
	}
}

// Google sign-in checked no password, so no hash is re-checked; an account
// deleted meanwhile is still refused (the handler answers 401).
func TestService_GoogleLoginSessionOwner(t *testing.T) {
	t.Run("no verified hash", func(t *testing.T) {
		env, _ := googleEnv(t, googleIdentity())
		env.repo.getUserByIdentity = func(string, string) (user.User, error) { return testUser(), nil }
		verified := "unset"
		env.repo.createRefreshToken = func(t NewRefreshToken) error { verified = t.VerifiedHash; return nil }
		_, err := env.svc.GoogleLogin(env.ctx, "id-token")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, verified, "")
	})
	t.Run("account deleted meanwhile", func(t *testing.T) {
		env, _ := googleEnv(t, googleIdentity())
		env.repo.getUserByIdentity = func(string, string) (user.User, error) { return testUser(), nil }
		env.repo.createRefreshToken = func(NewRefreshToken) error { return ErrNoUser }
		tokens, err := env.svc.GoogleLogin(env.ctx, "id-token")
		testx.AssertTrue(t, errors.Is(err, ErrNoUser), "err = %v", err)
		testx.AssertEqual(t, tokens.AccessToken, "")
		var appErr *errx.AppError
		testx.AssertTrue(t, errors.As(toHTTPError(err), &appErr), "mapped to an API error")
		testx.AssertEqual(t, appErr.HTTPStatus, http.StatusUnauthorized)
		testx.AssertEqual(t, appErr.Message, "this account no longer exists")
	})
}

// A first sign-in whose insert loses (on the email or on the identity) looks
// the subject up again: a double tap of the same Google account signs in the
// account the other request created; an email that belongs to an account
// without this identity is never linked (409); any other lookup failure is
// passed through, not dressed up as a conflict.
func TestService_GoogleLoginInsertLostRace(t *testing.T) {
	tests := []struct {
		name      string
		insertErr error
		lookup    func() (user.User, error) // the second lookup, after the insert lost
		wantUser  string
		wantErr   error
		notErr    error
	}{
		{name: "lost on the email, the other request linked it", insertErr: ErrEmailTaken,
			lookup: func() (user.User, error) { return testUser(), nil }, wantUser: id1},
		{name: "lost on the email, a password account has it", insertErr: ErrEmailTaken,
			lookup: func() (user.User, error) { return user.User{}, ErrNoUser }, wantErr: ErrEmailTaken},
		{name: "lost on the identity, but nothing has the subject", insertErr: ErrIdentityTaken,
			lookup: func() (user.User, error) { return user.User{}, ErrNoUser }, wantErr: ErrEmailTaken},
		{name: "lost on the email, the lookup fails", insertErr: ErrEmailTaken,
			lookup: func() (user.User, error) { return user.User{}, errBoom }, wantErr: errBoom, notErr: ErrEmailTaken},
		{name: "lost on the identity, the lookup fails", insertErr: ErrIdentityTaken,
			lookup: func() (user.User, error) { return user.User{}, errBoom }, wantErr: errBoom, notErr: ErrEmailTaken},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env, _ := googleEnv(t, googleIdentity())
			var subjects []string
			env.repo.getUserByIdentity = func(provider, subject string) (user.User, error) {
				testx.AssertEqual(t, provider, ProviderGoogle)
				subjects = append(subjects, subject)
				if len(subjects) == 1 {
					return user.User{}, ErrNoUser // first sign-in: not linked yet
				}
				return tt.lookup()
			}
			env.repo.createUserWithIdentity = func(NewUser, string, string, string) (user.User, error) {
				return user.User{}, tt.insertErr
			}
			env.repo.createRefreshToken = func(NewRefreshToken) error { return nil }

			tokens, err := env.svc.GoogleLogin(env.ctx, "id-token")

			testx.AssertEqual(t, strings.Join(subjects, ","), "google-sub-1,google-sub-1", "looked up again by subject")
			if tt.wantErr == nil {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, tokens.User.ID, tt.wantUser)
				testx.AssertTrue(t, tokens.AccessToken != "", "signed in")
				return
			}
			testx.AssertTrue(t, errors.Is(err, tt.wantErr), "err = %v, want %v", err, tt.wantErr)
			if tt.notErr != nil {
				testx.AssertFalse(t, errors.Is(err, tt.notErr), "a lookup failure became %v (409): %v", tt.notErr, err)
			}
			testx.AssertEqual(t, tokens.AccessToken, "")
		})
	}
}
