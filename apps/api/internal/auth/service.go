package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// Repository is where accounts and their credentials are stored. The
// service depends on this interface, so a test can hand it a fake.
type Repository interface {
	CreateUser(ctx context.Context, u NewUser) (user.User, error)
	GetCredentials(ctx context.Context, email string) (Credentials, error)
}

// Deps is what the service needs. Every field is required.
type Deps struct {
	Repo   Repository
	Hasher Hasher
	Access *AccessTokens
}

// Service holds the authentication rules.
type Service struct {
	repo   Repository
	hasher Hasher
	access *AccessTokens
	newID  func() string
}

// NewService returns a Service built from deps.
func NewService(deps Deps) *Service {
	return &Service{repo: deps.Repo, hasher: deps.Hasher, access: deps.Access, newID: uuidx.NewV7}
}

// Tokens is what a successful login returns.
type Tokens struct {
	User            user.User
	AccessToken     string
	AccessExpiresAt time.Time
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
	return s.issue(creds.User)
}

// issue returns new tokens for u.
func (s *Service) issue(u user.User) (Tokens, error) {
	access, claims, err := s.access.Issue(u)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{User: u, AccessToken: access, AccessExpiresAt: claims.ExpiresAt}, nil
}
