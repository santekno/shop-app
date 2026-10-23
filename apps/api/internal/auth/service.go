package auth

import (
	"context"
	"fmt"
	"strings"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// Repository is where accounts and their credentials are stored. The
// service depends on this interface, so a test can hand it a fake.
type Repository interface {
	CreateUser(ctx context.Context, u NewUser) (user.User, error)
}

// Deps is what the service needs. Every field is required.
type Deps struct {
	Repo   Repository
	Hasher Hasher
}

// Service holds the authentication rules.
type Service struct {
	repo   Repository
	hasher Hasher
	newID  func() string
}

// NewService returns a Service built from deps.
func NewService(deps Deps) *Service {
	return &Service{repo: deps.Repo, hasher: deps.Hasher, newID: uuidx.NewV7}
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
