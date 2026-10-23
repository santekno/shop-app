package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestService_Register(t *testing.T) {
	var created NewUser
	var token NewEmailToken
	env := newServiceEnv(t, func(d *Deps) { d.NewID = fixedIDs(t, id1, id2) })
	env.repo.createUser = func(u NewUser) (user.User, error) {
		created = u
		return user.User{ID: u.ID, Email: u.Email, Name: u.Name, Role: u.Role}, nil
	}
	env.repo.createEmailToken = func(t NewEmailToken) error { token = t; return nil }

	u, err := env.svc.Register(env.ctx, RegisterInput{ //nolint:gosec // a test value, not a credential
		Email: "  Budi@Example.COM ", Password: "kopi susu gula aren", Name: "  Budi Santoso ",
	})

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, u.ID, id1)
	// Stored normalised, trimmed and hashed, always as a buyer.
	testx.AssertEqual(t, created.ID, id1)
	testx.AssertEqual(t, created.Email, "budi@example.com")
	testx.AssertEqual(t, created.Name, "Budi Santoso")
	testx.AssertEqual(t, created.PasswordHash, "hash:kopi susu gula aren")
	testx.AssertEqual(t, created.Role, user.RoleBuyer)

	// A verification token was stored and emailed.
	testx.AssertEqual(t, token.UserID, id1)
	testx.AssertEqual(t, token.Purpose, PurposeVerifyEmail)
	testx.AssertEqual(t, token.Token.ID, id2)
	testx.AssertTrue(t, token.ExpiresAt.Equal(env.now.Add(24*time.Hour)), "expires %v", token.ExpiresAt)
	msgs := env.mailer.messages()
	testx.AssertEqual(t, len(msgs), 1)
	if len(msgs) == 1 {
		testx.AssertEqual(t, msgs[0].To, "budi@example.com")
		testx.AssertEqual(t, msgs[0].Subject, "Verifikasi email akun GoShop kamu")
		raw := tokenInBody(t, msgs[0].Body)
		parsed, ok := parseOpaqueToken(raw)
		testx.AssertTrue(t, ok, "the emailed token %q parses", raw)
		testx.AssertEqual(t, parsed.ID, id2)
		testx.AssertTrue(t, parsed.matches(token.Token.Hash), "the emailed secret is the stored one")
		testx.AssertContains(t, msgs[0].Body, "Halo Budi Santoso,")
		testx.AssertContains(t, msgs[0].Body, "POST /v1/auth/verify-email")
	}
}

// The role is not the caller's to choose: RegisterInput has no role, and
// the account is a buyer whatever the repository is asked for elsewhere.
func TestService_RegisterAlwaysBuyer(t *testing.T) {
	env := newServiceEnv(t, nil)
	var role user.Role
	env.repo.createUser = func(u NewUser) (user.User, error) { role = u.Role; return user.User{ID: u.ID}, nil }
	env.repo.createEmailToken = func(NewEmailToken) error { return nil }
	_, err := env.svc.Register(env.ctx, RegisterInput{Email: "a@b.co", Password: "kopi susu gula aren", Name: "A"}) //nolint:gosec // a test value, not a credential
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, role, user.RoleBuyer)
}

func TestService_RegisterFailures(t *testing.T) {
	tests := []struct {
		name     string
		password string
		setup    func(env *serviceEnv)
		check    func(t *testing.T, env *serviceEnv, err error)
	}{
		{
			name:     "password breaks the policy: nothing is hashed or stored",
			password: "pendek",
			check: func(t *testing.T, env *serviceEnv, err error) {
				var pwErr *PasswordError
				testx.AssertTrue(t, errors.As(err, &pwErr), "err = %v", err)
				testx.AssertEqual(t, len(env.hasher.hashed), 0)
			},
		},
		{
			name:     "common password",
			password: "Password123",
			check: func(t *testing.T, _ *serviceEnv, err error) {
				var pwErr *PasswordError
				testx.AssertTrue(t, errors.As(err, &pwErr), "err = %v", err)
				testx.AssertContains(t, pwErr.Reason, "too common")
			},
		},
		{ //nolint:gosec // a test value, not a credential
			name:     "hashing fails",
			password: "kopi susu gula aren",
			setup:    func(env *serviceEnv) { env.hasher.hashErr = errBoom },
			check: func(t *testing.T, _ *serviceEnv, err error) {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), "register: "), "err = %v", err)
			},
		},
		{ //nolint:gosec // a test value, not a credential
			name:     "email taken",
			password: "kopi susu gula aren",
			setup: func(env *serviceEnv) {
				env.repo.createUser = func(NewUser) (user.User, error) { return user.User{}, ErrEmailTaken }
			},
			check: func(t *testing.T, env *serviceEnv, err error) {
				testx.AssertTrue(t, errors.Is(err, ErrEmailTaken), "err = %v", err)
				testx.AssertEqual(t, len(env.mailer.messages()), 0, "no email for an account that was not made")
			},
		},
		{ //nolint:gosec // a test value, not a credential
			name:     "store fails",
			password: "kopi susu gula aren",
			setup: func(env *serviceEnv) {
				env.repo.createUser = func(NewUser) (user.User, error) { return user.User{}, errBoom }
			},
			check: func(t *testing.T, _ *serviceEnv, err error) {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), "register: "), "err = %v", err)
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv(t, nil)
			if tt.setup != nil {
				tt.setup(env)
			}
			u, err := env.svc.Register(env.ctx, RegisterInput{Email: "budi@example.com", Password: tt.password, Name: "Budi"})
			testx.AssertError(t, err)
			testx.AssertEqual(t, u.ID, "")
			tt.check(t, env, err)
		})
	}
}

// The account exists once it is stored: a verification email that cannot
// be made or sent is logged, and the user asks for a new one.
func TestService_RegisterMailIsBestEffort(t *testing.T) {
	tests := []struct {
		name  string
		setup func(env *serviceEnv)
		want  string
	}{
		{
			name:  "sending fails",
			setup: func(env *serviceEnv) { env.mailer.err = errBoom },
			want:  `send "Verifikasi email akun GoShop kamu": boom`,
		},
		{
			name: "storing the token fails",
			setup: func(env *serviceEnv) {
				env.repo.createEmailToken = func(NewEmailToken) error { return errBoom }
			},
			want: "new verify_email token: boom",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv(t, nil)
			env.repo.createUser = func(u NewUser) (user.User, error) { return user.User{ID: u.ID, Email: u.Email}, nil }
			env.repo.createEmailToken = func(NewEmailToken) error { return nil }
			tt.setup(env)

			u, err := env.svc.Register(env.ctx, RegisterInput{Email: "budi@example.com", Password: "kopi susu gula aren", Name: "Budi"}) //nolint:gosec // a test value, not a credential

			testx.AssertNoError(t, err)
			testx.AssertEqual(t, u.Email, "budi@example.com")
			line, ok := findLog(t, env.logs, "send verification email after registration")
			testx.AssertTrue(t, ok, "logs: %s", env.logs.String())
			testx.AssertEqual(t, line["level"], any("ERROR"))
			testx.AssertEqual(t, line["error"], any(tt.want))
		})
	}
}

func TestService_NewServiceDefaults(t *testing.T) {
	svc := NewService(Deps{})
	testx.AssertTrue(t, svc.now != nil, "clock defaults to time.Now")
	testx.AssertTrue(t, time.Since(svc.now()) < time.Minute)
	testx.AssertTrue(t, svc.random != nil, "random defaults to crypto/rand")
	id := svc.newID()
	testx.AssertEqual(t, len(id), 36)
	testx.AssertEqual(t, id[14:15], "7", "ids default to UUIDv7: %q", id)
}

// tokenInBody returns the "<id>.<secret>" token in an email body: the line
// that is nothing but the token.
func tokenInBody(t *testing.T, body string) string {
	t.Helper()
	for line := range strings.SplitSeq(body, "\n") {
		line = strings.TrimSpace(line)
		if id, _, ok := strings.Cut(line, "."); ok && len(id) == 36 && !strings.Contains(line, " ") {
			return line
		}
	}
	t.Fatalf("no token in body:\n%s", body)
	return ""
}
