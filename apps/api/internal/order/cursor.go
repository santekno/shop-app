package order

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// ErrInvalidCursor means the cursor was not made by this API for the same
// list.
var ErrInvalidCursor = errors.New("invalid cursor")

// Order lists page by (created_at, id), newest first, like the catalog's
// newest sort (internal/product/cursor.go): the index jumps straight to
// the cursor, and an order placed while someone scrolls never makes
// another appear twice.

// position is where a page starts: just after the order with these
// values.
type position struct {
	CreatedAt time.Time
	ID        string
}

// firstPage sorts after every order, so the first page is "everything
// before the start".
var firstPage = position{
	CreatedAt: time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC),
	ID:        "ffffffff-ffff-ffff-ffff-ffffffffffff",
}

// cursorJSON is a cursor before encoding. List ties it to the list it was
// made for (a status, or the buyer's history), so a cursor of one list is
// refused by another.
type cursorJSON struct {
	List      string    `json:"l"`
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"id"`
}

// encodeCursor is the cursor of the page after o in list.
func encodeCursor(list string, o Order) string {
	b, _ := json.Marshal(cursorJSON{List: list, CreatedAt: o.CreatedAt.UTC(), ID: o.ID}) // cannot fail
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodeCursor turns cursor back into a position; empty is the first
// page.
func decodeCursor(list, cursor string) (position, error) {
	if cursor == "" {
		return firstPage, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return position{}, fmt.Errorf("%w: not base64url", ErrInvalidCursor)
	}
	var c cursorJSON
	if err := json.Unmarshal(b, &c); err != nil {
		return position{}, fmt.Errorf("%w: not a cursor", ErrInvalidCursor)
	}
	if c.List != list || c.CreatedAt.IsZero() || !uuidx.IsValidUUID(c.ID) {
		return position{}, fmt.Errorf("%w: made for another list", ErrInvalidCursor)
	}
	return position{CreatedAt: c.CreatedAt, ID: c.ID}, nil
}

// MaxPageSize is the largest page of orders.
const MaxPageSize = 50

// Page is one page of orders, newest first.
type Page struct {
	Orders []Order
	// NextCursor is empty on the last page.
	NextCursor string
}

// paginate cuts rows, read with one more than limit, into a page.
func paginate(list string, rows []Order, limit int) Page {
	if len(rows) <= limit {
		return Page{Orders: rows}
	}
	rows = rows[:limit]
	return Page{Orders: rows, NextCursor: encodeCursor(list, rows[len(rows)-1])}
}
