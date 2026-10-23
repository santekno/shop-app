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

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// Repository is where accounts and their credentials are stored. The
// service depends on this interface, so a test can hand it a fake.
type Repository interface {
	CreateUser(ctx context.Context, u NewUser) (user.User, error)
	GetCredentials(ctx context.Context, email string) (Credentials, error)
	CreateRefreshToken(ctx context.Context, t NewRefreshToken) error
	RotateRefreshToken(ctx context.Context, presented, next opaqueToken, now, nextExpiresAt time.Time) (Rotated, error)
	RevokeSessionOf(ctx context.Context, presented opaqueToken) (string, error)
}

// Deps is what the service needs. Repo, Hasher, Access and RefreshTTL are
// required; the others default to the real thing when nil, and exist so a
// test can make time and randomness predictable.
type Deps struct {
	Repo   Repository
	Hasher Hasher
	Access *AccessTokens
	// RefreshTTL is how long a refresh token lives (APP_REFRESH_TOKEN_TTL).
	RefreshTTL time.Duration
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
	now        func() time.Time
	random     io.Reader
	newID      func() string
}

// NewService returns a Service built from deps.
func NewService(deps Deps) *Service {
	s := &Service{
		repo: deps.Repo, hasher: deps.Hasher, access: deps.Access, refreshTTL: deps.RefreshTTL,
		now: deps.Clock, random: deps.Random, newID: deps.NewID,
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

// Register creates a buyer account with a hashed password. It returns a
// *PasswordError when the password breaks the policy, and ErrEmailTaken
// when the email already has an account.
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
	return u, nil
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
	if _, err := s.repo.RevokeSessionOf(ctx, presented); err != nil {
		return fmt.Errorf("logout: %w", err)
	}
	return nil
}
