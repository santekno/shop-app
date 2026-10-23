package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// How long the tokens sent by email work. A reset token is short-lived: it
// can take over the account.
const (
	VerifyEmailTTL   = 24 * time.Hour
	ResetPasswordTTL = 30 * time.Minute
)

// Repository is where accounts and their credentials are stored. The
// service depends on this interface, so a test can hand it a fake.
type Repository interface {
	CreateUser(ctx context.Context, u NewUser) (user.User, error)
	GetCredentials(ctx context.Context, email string) (Credentials, error)
	CreateRefreshToken(ctx context.Context, t NewRefreshToken) error
	RotateRefreshToken(ctx context.Context, presented, next opaqueToken, now, nextExpiresAt time.Time) (Rotated, error)
	RevokeSessionOf(ctx context.Context, presented opaqueToken) (string, error)
	GetUser(ctx context.Context, id string) (user.User, error)
	CreateEmailToken(ctx context.Context, t NewEmailToken) error
	VerifyEmail(ctx context.Context, presented opaqueToken, now time.Time) error
	ResetPassword(ctx context.Context, presented opaqueToken, now time.Time, newHash string) ([]string, error)
	GetUserByIdentity(ctx context.Context, provider, subject string) (user.User, error)
	CreateUserWithIdentity(ctx context.Context, u NewUser, identityID, provider, subject string) (user.User, error)
}

// Deps is what the service needs. Repo, Hasher, Access, RefreshTTL, Mailer
// and Revocations are required; the others default to the real thing when nil, and exist so a
// test can make time and randomness predictable.
type Deps struct {
	Repo   Repository
	Hasher Hasher
	Access *AccessTokens
	// RefreshTTL is how long a refresh token lives (APP_REFRESH_TOKEN_TTL).
	RefreshTTL time.Duration
	// Mailer sends the verification and reset emails.
	Mailer mail.Mailer
	// Google verifies Google ID tokens; nil turns Google sign-in off
	// (GoogleLogin then returns ErrGoogleDisabled).
	Google GoogleVerifier
	// Revocations ends the access tokens of revoked sessions (required).
	Revocations SessionRevocations
	// Clock is the current time; time.Now when nil.
	Clock func() time.Time
	// Random is where token secrets come from; crypto/rand.Reader when nil.
	Random io.Reader
	// NewID makes row ids; uuidx.NewV7 when nil.
	NewID func() string
}

// Service holds the authentication rules.
type Service struct {
	repo       Repository
	hasher     Hasher
	access     *AccessTokens
	refreshTTL time.Duration
	mailer     mail.Mailer
	google     GoogleVerifier
	revoked    SessionRevocations
	now        func() time.Time
	random     io.Reader
	newID      func() string
}

// NewService returns a Service built from deps.
func NewService(deps Deps) *Service {
	s := &Service{
		repo: deps.Repo, hasher: deps.Hasher, access: deps.Access, refreshTTL: deps.RefreshTTL,
		mailer: deps.Mailer, google: deps.Google, revoked: deps.Revocations, now: deps.Clock, random: deps.Random, newID: deps.NewID,
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.random == nil {
		s.random = rand.Reader
	}
	if s.newID == nil {
		s.newID = uuidx.NewV7
	}
	return s
}

// Tokens is what a login or a refresh returns: the tokens of one session.
type Tokens struct {
	User             user.User
	SessionID        string
	AccessToken      string
	AccessExpiresAt  time.Time
	RefreshToken     string
	RefreshExpiresAt time.Time
}

// RegisterInput is a sign-up, already validated by the handler.
type RegisterInput struct {
	Email    string
	Password string
	Name     string
}

// Register creates a buyer account with a hashed password and emails it a
// verification token. It returns a *PasswordError when the password breaks
// the policy, and ErrEmailTaken when the email already has an account.
//
// The account exists once Register has stored it: a failure to send the
// verification email is logged, not returned, and the user asks for a new
// one with ResendVerification.
func (s *Service) Register(ctx context.Context, in RegisterInput) (user.User, error) {
	if err := CheckPassword(in.Password); err != nil {
		return user.User{}, err
	}
	hash, err := s.hasher.Hash(ctx, in.Password)
	if err != nil {
		return user.User{}, fmt.Errorf("register: %w", err)
	}
	u, err := s.repo.CreateUser(ctx, NewUser{
		ID:           s.newID(),
		Email:        NormalizeEmail(in.Email),
		PasswordHash: hash,
		Name:         strings.TrimSpace(in.Name),
		Role:         user.RoleBuyer,
	})
	if err != nil {
		return user.User{}, fmt.Errorf("register: %w", err)
	}
	if err := s.sendVerification(ctx, u); err != nil {
		logx.FromContext(ctx).Error("send verification email after registration", "error", err.Error())
	}
	return u, nil
}

// ResendVerification emails a new verification token to the account with
// userID, unless its email is verified already (then it does nothing). The
// new token replaces any older one.
func (s *Service) ResendVerification(ctx context.Context, userID string) error {
	u, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		return fmt.Errorf("resend verification: %w", err)
	}
	if u.EmailVerified() {
		return nil
	}
	return s.sendVerification(ctx, u)
}

// VerifyEmail uses a verification token: the account's email becomes
// verified and the token stops working. It returns ErrEmailTokenInvalid or
// ErrEmailTokenExpired when the token cannot be used.
func (s *Service) VerifyEmail(ctx context.Context, token string) error {
	presented, ok := parseOpaqueToken(token)
	if !ok {
		return ErrEmailTokenInvalid
	}
	if err := s.repo.VerifyEmail(ctx, presented, s.now()); err != nil {
		return fmt.Errorf("verify email: %w", err)
	}
	return nil
}

// Google sign-in errors.
var (
	// ErrGoogleDisabled means GOOGLE_CLIENT_ID is not set.
	ErrGoogleDisabled = errors.New("google sign-in is not configured")
	// ErrGoogleEmailUnverified means Google has not verified the account's
	// email, so it cannot be trusted to create a GoShop account.
	ErrGoogleEmailUnverified = errors.New("google account email is not verified")
)

// maxNameLength is the longest name an account gets, the same limit as the
// registration form.
const maxNameLength = 100

// GoogleLogin signs in with a Google ID token that a client (the web or
// mobile app) got from Google, and returns tokens for a new session.
//
// The account is found by Google's subject id, never by email (docs/erd.md):
// an email address can be given to someone else, the subject cannot. A
// subject seen for the first time creates a buyer account without a
// password and with its email verified, provided Google has verified the
// email. If a GoShop account already has that email, nothing is linked and
// ErrEmailTaken is returned: the user logs in with their password instead,
// because matching on the email alone would hand the account to whoever
// controls a Google account with that address.
//
// It returns ErrGoogleTokenInvalid for a token that fails verification,
// ErrGoogleEmailUnverified, ErrEmailTaken, and ErrGoogleDisabled when
// GOOGLE_CLIENT_ID is not set.
func (s *Service) GoogleLogin(ctx context.Context, idToken string) (Tokens, error) {
	if s.google == nil {
		return Tokens{}, ErrGoogleDisabled
	}
	id, err := s.google.Verify(ctx, idToken)
	if err != nil {
		logx.FromContext(ctx).Info("google id token refused", "error", err.Error())
		return Tokens{}, ErrGoogleTokenInvalid
	}
	u, err := s.repo.GetUserByIdentity(ctx, ProviderGoogle, id.Subject)
	if errors.Is(err, ErrNoUser) {
		u, err = s.createGoogleUser(ctx, id)
	}
	if err != nil {
		return Tokens{}, fmt.Errorf("google login: %w", err)
	}
	// No password was checked, so there is no hash to re-check: the
	// repository only refuses an account deleted in the meantime.
	return s.startSession(ctx, u, "")
}

// createGoogleUser creates the account for a Google identity seen for the
// first time.
func (s *Service) createGoogleUser(ctx context.Context, id GoogleIdentity) (user.User, error) {
	email := NormalizeEmail(id.Email)
	if !id.EmailVerified || email == "" {
		return user.User{}, ErrGoogleEmailUnverified
	}
	if !isASCII(email) || len(email) > 254 {
		// The same rule as registration; Google allows internationalised
		// addresses that GoShop does not store.
		return user.User{}, ErrGoogleTokenInvalid
	}
	u, err := s.repo.CreateUserWithIdentity(ctx, NewUser{
		ID: s.newID(), Email: email, Name: googleName(id.Name, email), Role: user.RoleBuyer,
	}, s.newID(), ProviderGoogle, id.Subject)
	if errors.Is(err, ErrIdentityTaken) || errors.Is(err, ErrEmailTaken) {
		// Two first sign-ins of the same Google account raced (a double
		// tap): the other one created the account, and this insert lost on
		// the email or on the identity, depending on timing. The insert
		// waited for the winner to commit, so its identity is visible now.
		// When no identity has this subject, the email belongs to another
		// account (a password one), which is never linked: ErrEmailTaken.
		linked, lookupErr := s.repo.GetUserByIdentity(ctx, ProviderGoogle, id.Subject)
		if errors.Is(lookupErr, ErrNoUser) {
			return user.User{}, ErrEmailTaken
		}
		return linked, lookupErr
	}
	return u, err
}

// googleName is the account name from Google's "name" claim: trimmed, cut
// to maxNameLength characters, and the email's local part when the claim is
// empty or not storable text.
func googleName(name, email string) string {
	name = strings.TrimSpace(name)
	if !httpapi.ValidText(name) || name == "" {
		local, _, _ := strings.Cut(email, "@")
		return local
	}
	if r := []rune(name); len(r) > maxNameLength {
		name = strings.TrimSpace(string(r[:maxNameLength]))
	}
	return name
}

// ForgotPassword emails a password-reset token to the account with email,
// if there is one. It returns nil whether or not the account exists, and a
// failure to send is logged rather than returned, so the response never
// tells a caller which emails are registered. An account that signs in
// with Google only can set a password this way: the email proves it is
// theirs.
//
// Known limit: the work differs (an insert and a log line when the account
// exists), so a careful timing measurement could still tell. Bab 6 moves
// the sending to the worker queue, which leaves one fast enqueue either way.
func (s *Service) ForgotPassword(ctx context.Context, email string) error {
	creds, err := s.repo.GetCredentials(ctx, NormalizeEmail(email))
	if errors.Is(err, ErrNoUser) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("forgot password: %w", err)
	}
	if err := s.sendReset(ctx, creds.User); err != nil {
		logx.FromContext(ctx).Error("send password reset email", "error", err.Error())
	}
	return nil
}

// ResetPassword uses a reset token to set a new password. Every session of
// the account is revoked, so a thief who knew the old password, or held a
// refresh token, is logged out. It returns a *PasswordError for a password
// that breaks the policy, and ErrEmailTokenInvalid or ErrEmailTokenExpired
// when the token cannot be used.
func (s *Service) ResetPassword(ctx context.Context, token, newPassword string) error {
	if err := CheckPassword(newPassword); err != nil {
		return err
	}
	presented, ok := parseOpaqueToken(token)
	if !ok {
		return ErrEmailTokenInvalid
	}
	hash, err := s.hasher.Hash(ctx, newPassword)
	if err != nil {
		return fmt.Errorf("reset password: %w", err)
	}
	sessions, err := s.repo.ResetPassword(ctx, presented, s.now(), hash)
	if err != nil {
		return fmt.Errorf("reset password: %w", err)
	}
	s.endAccessTokens(ctx, sessions...)
	return nil
}

// sendReset stores a new reset token for u and emails it.
func (s *Service) sendReset(ctx context.Context, u user.User) error {
	token, err := s.newEmailToken(ctx, u.ID, PurposeResetPassword, ResetPasswordTTL)
	if err != nil {
		return err
	}
	return s.send(ctx, mail.Message{
		To:      u.Email,
		Subject: "Atur ulang kata sandi GoShop kamu",
		Body: "Halo " + u.Name + ",\n\n" +
			"Seseorang meminta pengaturan ulang kata sandi akun GoShop dengan email ini. Token (berlaku 30 menit):\n\n" +
			token + "\n\n" +
			"Kirim token itu bersama kata sandi baru ke POST /v1/auth/reset-password. Semua sesi login akan diakhiri.\n" +
			"Kalau bukan kamu yang meminta, abaikan email ini; kata sandimu tidak berubah.",
	})
}

// sendVerification stores a new verification token for u and emails it.
func (s *Service) sendVerification(ctx context.Context, u user.User) error {
	token, err := s.newEmailToken(ctx, u.ID, PurposeVerifyEmail, VerifyEmailTTL)
	if err != nil {
		return err
	}
	return s.send(ctx, mail.Message{
		To:      u.Email,
		Subject: "Verifikasi email akun GoShop kamu",
		Body: "Halo " + u.Name + ",\n\n" +
			"Konfirmasi alamat email ini dengan token berikut (berlaku 24 jam):\n\n" + token + "\n\n" +
			"Kirim token itu ke POST /v1/auth/verify-email. Kalau kamu tidak mendaftar di GoShop, abaikan email ini.",
	})
}

// newEmailToken stores a one-time token for userID and returns the string
// to email.
func (s *Service) newEmailToken(ctx context.Context, userID string, purpose Purpose, ttl time.Duration) (string, error) {
	raw, token, err := newOpaqueToken(s.random, s.newID)
	if err != nil {
		return "", fmt.Errorf("new %s token: %w", purpose, err)
	}
	err = s.repo.CreateEmailToken(ctx, NewEmailToken{
		Token: token, UserID: userID, Purpose: purpose, ExpiresAt: s.now().Add(ttl),
	})
	if err != nil {
		return "", fmt.Errorf("new %s token: %w", purpose, err)
	}
	return raw, nil
}

// send hands m to the mailer.
func (s *Service) send(ctx context.Context, m mail.Message) error {
	if err := s.mailer.Send(ctx, m); err != nil {
		return fmt.Errorf("send %q: %w", m.Subject, err)
	}
	return nil
}

// Login checks email and password and returns tokens for the account. Every
// failure is ErrInvalidCredentials, and every path costs one password
// verification: an unknown email and an account without a password are
// checked against a dummy hash, so the response time does not tell a caller
// which emails have an account.
func (s *Service) Login(ctx context.Context, email, password string) (Tokens, error) {
	creds, err := s.repo.GetCredentials(ctx, NormalizeEmail(email))
	if err != nil && !errors.Is(err, ErrNoUser) {
		return Tokens{}, fmt.Errorf("login: %w", err)
	}
	// creds.Hash is "" when there is no user or no password; Verify then
	// spends the same time on its dummy hash and returns false.
	ok, err := s.hasher.Verify(ctx, password, creds.Hash)
	if err != nil {
		return Tokens{}, fmt.Errorf("login: %w", err)
	}
	if !ok {
		return Tokens{}, ErrInvalidCredentials
	}
	tokens, err := s.startSession(ctx, creds.User, creds.Hash)
	if errors.Is(err, ErrNoUser) || errors.Is(err, ErrInvalidCredentials) {
		// The account was deleted, or its password reset, while the
		// password was being verified: the credentials no longer hold.
		return Tokens{}, ErrInvalidCredentials
	}
	return tokens, err
}

// startSession begins a new session (refresh-token family) for u and
// returns its first tokens. verifiedHash is the password hash a password
// login just checked ("" otherwise); the repository refuses the session
// when the account was deleted or that hash replaced in the meantime.
func (s *Service) startSession(ctx context.Context, u user.User, verifiedHash string) (Tokens, error) {
	refresh, token, err := newOpaqueToken(s.random, s.newID)
	if err != nil {
		return Tokens{}, fmt.Errorf("start session: %w", err)
	}
	sessionID := s.newID()
	expiresAt := s.now().Add(s.refreshTTL)
	err = s.repo.CreateRefreshToken(ctx, NewRefreshToken{
		Token: token, UserID: u.ID, FamilyID: sessionID, ExpiresAt: expiresAt, VerifiedHash: verifiedHash,
	})
	if err != nil {
		return Tokens{}, fmt.Errorf("start session: %w", err)
	}
	return s.withAccessToken(Tokens{
		User: u, SessionID: sessionID, RefreshToken: refresh, RefreshExpiresAt: expiresAt,
	})
}

// withAccessToken adds a new access token for t's user and session.
func (s *Service) withAccessToken(t Tokens) (Tokens, error) {
	access, claims, err := s.access.Issue(t.User, t.SessionID)
	if err != nil {
		return Tokens{}, err
	}
	t.AccessToken, t.AccessExpiresAt = access, claims.ExpiresAt
	return t, nil
}

// Refresh rotates refreshToken: it returns a new access token and a new
// refresh token for the same session, and the presented one never works
// again. It returns ErrRefreshTokenInvalid for a token that is malformed,
// unknown, revoked or of a deleted account, ErrRefreshTokenExpired for an
// expired one, and ErrRefreshTokenInvalid as well when the token was
// already rotated: then someone else has a copy, and the whole session is
// revoked (ADR 0005).
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Tokens, error) {
	presented, ok := parseOpaqueToken(refreshToken)
	if !ok {
		return Tokens{}, ErrRefreshTokenInvalid
	}
	refresh, next, err := newOpaqueToken(s.random, s.newID)
	if err != nil {
		return Tokens{}, fmt.Errorf("refresh: %w", err)
	}
	now := s.now()
	expiresAt := now.Add(s.refreshTTL)
	rotated, err := s.repo.RotateRefreshToken(ctx, presented, next, now, expiresAt)
	if errors.Is(err, ErrRefreshTokenReused) {
		logx.FromContext(ctx).Warn("refresh token reused; session revoked",
			"session_id", rotated.FamilyID)
		s.endAccessTokens(ctx, rotated.FamilyID)
		return Tokens{}, ErrRefreshTokenInvalid
	}
	if err != nil {
		return Tokens{}, fmt.Errorf("refresh: %w", err)
	}
	return s.withAccessToken(Tokens{
		User: rotated.User, SessionID: rotated.FamilyID, RefreshToken: refresh, RefreshExpiresAt: expiresAt,
	})
}

// Logout ends the session of refreshToken. A token that is malformed,
// unknown or already revoked is not an error: the caller is logged out
// either way.
func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	presented, ok := parseOpaqueToken(refreshToken)
	if !ok {
		return nil
	}
	sessionID, err := s.repo.RevokeSessionOf(ctx, presented)
	if err != nil {
		return fmt.Errorf("logout: %w", err)
	}
	if sessionID == "" {
		return nil
	}
	// The refresh token is revoked; now its access tokens. If Redis fails,
	// the client gets an error and logs out again, which finds the same
	// session and retries this step.
	if err := s.revoked.Revoke(ctx, sessionID); err != nil {
		return fmt.Errorf("logout: %w", err)
	}
	return nil
}

// endAccessTokens marks sessions whose refresh tokens were just revoked in
// PostgreSQL as revoked in Redis, so their access tokens stop working now
// rather than when they expire. The PostgreSQL change has committed and is
// what counts, so a Redis failure here is logged, not returned: the access
// tokens then die within APP_ACCESS_TOKEN_TTL.
func (s *Service) endAccessTokens(ctx context.Context, sessionIDs ...string) {
	if len(sessionIDs) == 0 {
		return
	}
	if err := s.revoked.Revoke(ctx, sessionIDs...); err != nil {
		logx.FromContext(ctx).Error("revoke access tokens of ended sessions",
			"sessions", len(sessionIDs), "error", err.Error())
	}
}
