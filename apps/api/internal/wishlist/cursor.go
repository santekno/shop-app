package wishlist

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// The wishlist pages by (created_at, product_id), newest saved first, like
// the buyer's order history (internal/order/cursor.go): the index
// wishlist_items_user_created_idx jumps straight to the cursor, and a
// product saved while the buyer scrolls never makes another appear twice.

// position is where a page starts: just after the entry with these values.
type position struct {
	CreatedAt time.Time
	ProductID string
}

// firstPage sorts after every entry, so the first page is "everything
// before the start".
var firstPage = position{
	CreatedAt: time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC),
	ProductID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
}

// cursorJSON is a cursor before encoding. List ties it to the wishlist, so
// a cursor of the product list or of the order history is refused here.
type cursorJSON struct {
	List      string    `json:"l"`
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"id"`
}

const listName = "wishlist"

// encodeCursor is the cursor of the page after e.
func encodeCursor(e Entry) string {
	b, _ := json.Marshal(cursorJSON{List: listName, CreatedAt: e.AddedAt.UTC(), ID: e.ProductID}) // cannot fail
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodeCursor turns cursor back into a position; empty is the first page.
func decodeCursor(cursor string) (position, error) {
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
	if c.List != listName || c.CreatedAt.IsZero() || !uuidx.IsValidUUID(c.ID) {
		return position{}, fmt.Errorf("%w: made for another list", ErrInvalidCursor)
	}
	return position{CreatedAt: c.CreatedAt, ProductID: c.ID}, nil
}
