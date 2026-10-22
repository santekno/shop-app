package product

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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
// values. The id breaks ties between products with the same created_at, so
// none is skipped or shown twice.
type position struct {
	CreatedAt time.Time
	ID        string
}

// startPosition sorts before every product, so the first page needs no
// special query: it is "everything after the start".
func startPosition() position {
	return position{CreatedAt: time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC), ID: "ffffffff-ffff-ffff-ffff-ffffffffffff"}
}

// cursorJSON is what a cursor holds before encoding. Clients treat the
// encoded string as opaque; it is not signed, because a forged cursor can
// only select a different page of public data.
type cursorJSON struct {
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"id"`
}

// encodeCursor returns the cursor of the page that starts after p.
func encodeCursor(p Product) string {
	b, _ := json.Marshal(cursorJSON{CreatedAt: p.CreatedAt.UTC(), ID: p.ID}) // cannot fail for these types
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodeCursor turns a cursor from the client back into a position. An
// empty cursor is the first page.
func decodeCursor(cursor string) (position, error) {
	if cursor == "" {
		return startPosition(), nil
	}
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return position{}, fmt.Errorf("%w: not base64url", ErrInvalidCursor)
	}
	var c cursorJSON
	if err := json.Unmarshal(b, &c); err != nil {
		return position{}, fmt.Errorf("%w: not a cursor", ErrInvalidCursor)
	}
	if c.CreatedAt.IsZero() || !uuidx.IsValidUUID(c.ID) {
		return position{}, fmt.Errorf("%w: missing values", ErrInvalidCursor)
	}
	return position(c), nil
}
