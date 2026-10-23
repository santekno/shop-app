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

// Owner names whose cart a request works on. UserID comes from the access
// token, never from the request body.
type Owner struct {
	UserID string
}

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
