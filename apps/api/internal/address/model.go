// Package address is a user's address book: the shipping addresses under
// /v1/me/addresses. Every address belongs to exactly one user, and every
// read and write is scoped to the caller, so one user can never see or
// change another's.
package address

import (
	"errors"
	"time"
)

// MaxPerUser is how many addresses one user may keep: enough for home,
// office and family, and a bound on what one account can store.
const MaxPerUser = 20

// Errors the service returns.
var (
	// ErrNotFound means the caller has no address with that ID, including
	// when it belongs to someone else.
	ErrNotFound = errors.New("address not found")
	// ErrLimitReached means the caller already has MaxPerUser addresses.
	ErrLimitReached = errors.New("address limit reached")
	// ErrDefaultRequired means the change would leave the user without a
	// default address; another address must become the default instead.
	ErrDefaultRequired = errors.New("a default address is required")
	// ErrNoUser means the caller's account no longer exists.
	ErrNoUser = errors.New("user not found")
	// ErrInvalidText means a value cannot be stored as PostgreSQL text.
	ErrInvalidText = errors.New("invalid text")
)

// Address is one shipping address.
type Address struct {
	ID            string
	Label         string
	RecipientName string
	Phone         string
	Street        string
	City          string
	Province      string
	PostalCode    string
	IsDefault     bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Input is a new address, already validated.
type Input struct {
	Label         string
	RecipientName string
	Phone         string
	Street        string
	City          string
	Province      string
	PostalCode    string
	// IsDefault makes it the default address. A user's first address is
	// the default whatever this says.
	IsDefault bool
}

// Patch is a partial update: a nil field keeps its value.
type Patch struct {
	Label         *string
	RecipientName *string
	Phone         *string
	Street        *string
	City          *string
	Province      *string
	PostalCode    *string
	// IsDefault true makes this the default (the old one stops being it);
	// false on the default address is ErrDefaultRequired.
	IsDefault *bool
}
