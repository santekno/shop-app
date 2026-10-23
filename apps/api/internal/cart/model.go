// Package cart is the shopping cart behind /v1/cart (ADR 0006): one cart
// per user, lines of variants with a quantity, and the price the buyer saw
// when they added each line. Checkout (package order) reads the cart and
// re-validates every line; the cart itself never reserves stock.
package cart

import (
	"errors"
	"time"
)

// Limits of one cart (ADR 0006). The quantity limit is also a CHECK on
// cart_items.
const (
	MaxQuantity = 99
	MaxLines    = 50
)

// Owner names whose cart a request works on: a logged-in user (UserID, from
// the access token, never from the body) or a guest holding a cart token.
// A logged-in user's own cart always wins; their Token is ignored except by
// Merge.
type Owner struct {
	UserID string
	// Token is the guest cart token from the X-Cart-Token header; empty for
	// a guest who has no cart yet.
	Token string
}

// IsGuest reports whether the request has no logged-in user.
func (o Owner) IsGuest() bool { return o.UserID == "" }

// Problem says why a line cannot be bought as it is.
type Problem string

// The problems a line can have, in the order they are checked: a variant
// that cannot be sold at all, then too little stock, then a new price.
const (
	ProblemNone              Problem = ""
	ProblemUnavailable       Problem = "unavailable"
	ProblemInsufficientStock Problem = "insufficient_stock"
	ProblemPriceChanged      Problem = "price_changed"
)

// Line is one variant in a cart, with the catalog's current data.
type Line struct {
	VariantID   string
	ProductID   string
	ProductSlug string
	ProductName string
	VariantName string
	SKU         string
	Quantity    int32
	// AddedPrice is what the buyer saw when they last added or changed
	// the line; Price is the price now. Both are whole rupiah.
	AddedPrice  int64
	Price       int64
	Stock       int32
	WeightGrams int32
	// Sellable is false when the variant is archived or its product is not
	// active.
	Sellable  bool
	CreatedAt time.Time
}

// Problem returns what stops the line from being bought now, or
// ProblemNone. Checkout runs the same check on rows it has locked.
func (l Line) Problem() Problem {
	switch {
	case !l.Sellable:
		return ProblemUnavailable
	case l.Stock < l.Quantity:
		return ProblemInsufficientStock
	case l.Price != l.AddedPrice:
		return ProblemPriceChanged
	default:
		return ProblemNone
	}
}

// LineTotal is the line at today's price, in whole rupiah.
func (l Line) LineTotal() int64 { return l.Price * int64(l.Quantity) }

// Cart is a cart's lines, oldest first. A cart that was never created is
// an empty Cart.
type Cart struct {
	Lines []Line
}

// Subtotal is the sum of every line at today's price. It is a hint for the
// cart page; checkout computes the amount that is charged.
func (c Cart) Subtotal() int64 {
	var sum int64
	for _, l := range c.Lines {
		sum += l.LineTotal()
	}
	return sum
}

// ItemCount is the number of units in the cart, for a badge.
func (c Cart) ItemCount() int {
	n := 0
	for _, l := range c.Lines {
		n += int(l.Quantity)
	}
	return n
}

// Errors the service returns; the handler turns each into its HTTP error.
var (
	// ErrAccountGone: the logged-in user's account was deleted (possibly
	// while this request ran).
	ErrAccountGone = errors.New("account deleted")
	// ErrCartNotFound: the guest cart token is malformed, unknown, or its
	// cart was merged; the client forgets the token.
	ErrCartNotFound = errors.New("cart not found")
	// ErrLineNotFound: the cart has no line for that variant.
	ErrLineNotFound = errors.New("cart line not found")
	// ErrVariantUnavailable: the variant does not exist, is archived, or
	// its product is not active.
	ErrVariantUnavailable = errors.New("variant unavailable")
	// ErrCartFull: the cart already has MaxLines lines.
	ErrCartFull = errors.New("cart full")
	// ErrQuantityLimit: the line would hold more than MaxQuantity.
	ErrQuantityLimit = errors.New("quantity limit")
)

// InsufficientStockError means the line would hold more than the stock on
// hand; Available is how many there are.
type InsufficientStockError struct {
	Available int32
}

func (e *InsufficientStockError) Error() string { return "insufficient stock" }

// LineWrite is a line Merge writes into the user's cart.
type LineWrite struct {
	VariantID string
	Quantity  int32
	// UnitPrice is the price the buyer has seen for this line.
	UnitPrice int64
}

// Merge returns what moving a guest cart into a user's cart writes
// (ADR 0006). For a variant in both carts the guest's quantity is added up
// to MaxQuantity and the stock on hand, and the line never ends below what
// the user's cart already had: a merge only adds. A guest line whose
// variant is not sellable or sold out is not carried over, nor are lines
// past MaxLines (oldest guest lines first). The user's lines keep the price
// their owner saw; new lines keep the guest's.
func Merge(user, guest []Line) []LineWrite {
	have := make(map[string]Line, len(user))
	for _, l := range user {
		have[l.VariantID] = l
	}
	lines := len(user)
	var writes []LineWrite
	for _, g := range guest {
		if !g.Sellable {
			continue
		}
		if u, ok := have[g.VariantID]; ok {
			q := max(u.Quantity, min(u.Quantity+g.Quantity, MaxQuantity, g.Stock))
			if q != u.Quantity {
				writes = append(writes, LineWrite{VariantID: g.VariantID, Quantity: q, UnitPrice: u.AddedPrice})
			}
			continue
		}
		q := min(g.Quantity, MaxQuantity, g.Stock)
		if q < 1 || lines >= MaxLines {
			continue
		}
		lines++
		writes = append(writes, LineWrite{VariantID: g.VariantID, Quantity: q, UnitPrice: g.AddedPrice})
	}
	return writes
}
