// Package user is the account as its owner sees it: the profile behind
// /v1/me and deleting the account. Logging in, tokens and passwords are
// the auth package's; both work on the users table (docs/erd.md).
package user

import (
	"errors"
	"time"
)

// ErrNotFound means there is no account with that ID, or it was deleted
// (anonymised).
var ErrNotFound = errors.New("user not found")

// Role decides what a user may do (docs/prd.md). The values are the ones
// the users_role_check constraint allows.
type Role string

// The three roles. A new account is always a buyer; sellers and admins are
// made by an admin (or, locally, by make seed-admin).
const (
	RoleBuyer  Role = "buyer"
	RoleSeller Role = "seller"
	RoleAdmin  Role = "admin"
)

// Valid reports whether r is one of the three roles.
func (r Role) Valid() bool {
	switch r {
	case RoleBuyer, RoleSeller, RoleAdmin:
		return true
	default:
		return false
	}
}

// User is an account. It never carries the password hash: only the auth
// package reads that, through its own repository.
type User struct {
	ID    string
	Email string
	Name  string
	// Phone is nil when the user has not given one.
	Phone *string
	Role  Role
	// EmailVerifiedAt is nil until the user confirms the address (or signs
	// up with Google, which has confirmed it already).
	EmailVerifiedAt *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// EmailVerified reports whether the user has confirmed their email.
func (u User) EmailVerified() bool { return u.EmailVerifiedAt != nil }
