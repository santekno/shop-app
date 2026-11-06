// Package wishlist is a buyer's list of saved products, under
// /v1/me/wishlist (Bab 14). It lives on the server so the mobile app can
// update its heart icon optimistically and roll back when the server
// refuses. Every read and write is scoped to the caller, whose ID comes
// from the access token.
package wishlist

import (
	"errors"
	"time"
)

// MaxItems is how many products one user may keep on the wishlist: far more
// than anyone browses, and a bound on what one account can store.
const MaxItems = 200

// MaxLimit is the largest page size.
const MaxLimit = 100

// Errors the service returns; the handler turns each into its HTTP error.
var (
	// ErrProductNotFound: no active product has the slug.
	ErrProductNotFound = errors.New("product not found")
	// ErrLimitReached: the caller already has MaxItems products saved and
	// the one being added is not among them.
	ErrLimitReached = errors.New("wishlist limit reached")
	// ErrNoUser: the caller's account no longer exists.
	ErrNoUser = errors.New("user not found")
	// ErrInvalidCursor: the cursor was not made by this API for the
	// wishlist.
	ErrInvalidCursor = errors.New("invalid cursor")
)

// Entry is one saved product: which one, and when it was saved.
type Entry struct {
	ProductID string
	AddedAt   time.Time
}
