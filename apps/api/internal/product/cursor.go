package product

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// ErrInvalidCursor means the cursor was not made by this API for the same
// sort and filters.
var ErrInvalidCursor = errors.New("invalid cursor")

// Why a cursor and not ?page=3 (offset pagination):
//
//   - OFFSET 40 makes Postgres read and throw away 40 rows first, so deep
//     pages get slower and slower. A cursor says "after this product", which
//     the index (created_at DESC, id DESC) finds directly, on any page.
//   - With an offset, a product added while a buyer scrolls pushes every
//     later product one place down: the buyer sees one twice, or one
//     disappears when a product is archived. A cursor stays on the product
//     it points at.
//
// Offset pagination is still fine for small lists that need "page 3 of 7",
// such as an admin table. The storefront scrolls, so it uses cursors.

// position is where a page starts: just after the product with these sort
// values. Only the key of the page's sort is used: CreatedAt for newest,
// Price for the price sorts. The id breaks ties between products with the
// same key, so none is skipped or shown twice.
type position struct {
	CreatedAt time.Time
	Price     int64
	ID        string
}

// startPosition sorts before every product in the order of sort, so the
// first page needs no query of its own: it is "everything after the start".
func startPosition(sort Sort) position {
	const minID, maxID = "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"
	switch sort {
	case SortPriceAsc:
		return position{Price: 0, ID: minID} // every price is above 0
	case SortPriceDesc:
		return position{Price: math.MaxInt64, ID: maxID}
	default:
		return position{CreatedAt: time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC), ID: maxID}
	}
}

// cursorJSON is what a cursor holds before encoding. Clients treat the
// encoded string as opaque; it is not signed, because a forged cursor can
// only select a different page of public data. Sort and Filter tie it to
// the request it came from: page 2 of "kaos, cheapest first" makes no sense
// for "ponsel, newest first".
type cursorJSON struct {
	Sort      Sort      `json:"s"`
	Filter    string    `json:"f"`
	CreatedAt time.Time `json:"t,omitzero"`
	Price     int64     `json:"p,omitempty"`
	ID        string    `json:"id"`
}

// encodeCursor returns the cursor of the page after p, for the request
// params.
func encodeCursor(params ListParams, p Product) string {
	c := cursorJSON{Sort: params.Sort, Filter: filterKey(params), ID: p.ID}
	if params.Sort == SortNewest {
		c.CreatedAt = p.CreatedAt.UTC()
	} else {
		c.Price = p.PriceFrom
	}
	b, _ := json.Marshal(c) // cannot fail for these types
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodeCursor turns params.Cursor back into a position. An empty cursor is
// the first page. A cursor made for another sort or other filters is
// ErrInvalidCursor.
func decodeCursor(params ListParams) (position, error) {
	if params.Cursor == "" {
		return startPosition(params.Sort), nil
	}
	b, err := base64.RawURLEncoding.DecodeString(params.Cursor)
	if err != nil {
		return position{}, fmt.Errorf("%w: not base64url", ErrInvalidCursor)
	}
	var c cursorJSON
	if err := json.Unmarshal(b, &c); err != nil {
		return position{}, fmt.Errorf("%w: not a cursor", ErrInvalidCursor)
	}
	if c.Sort != params.Sort || c.Filter != filterKey(params) {
		return position{}, fmt.Errorf("%w: made for another sort or other filters", ErrInvalidCursor)
	}
	keyMissing := c.CreatedAt.IsZero()
	if params.Sort != SortNewest {
		keyMissing = c.Price <= 0
	}
	if keyMissing || !uuidx.IsValidUUID(c.ID) {
		return position{}, fmt.Errorf("%w: missing values", ErrInvalidCursor)
	}
	return position{CreatedAt: c.CreatedAt, Price: c.Price, ID: c.ID}, nil
}

// filterKey is a short fingerprint of the request's filters, so a cursor
// stays small however long the filters are.
func filterKey(params ListParams) string {
	sum := sha256.Sum256([]byte(params.Category))
	return hex.EncodeToString(sum[:8])
}
