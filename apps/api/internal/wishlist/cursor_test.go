package wishlist

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

const (
	pidA = "0190c8a0-0000-7000-8000-00000000000a"
	pidB = "0190c8a0-0000-7000-8000-00000000000b"
	pidC = "0190c8a0-0000-7000-8000-00000000000c"
	user = "0190c8a0-0000-7000-8000-0000000000e1"
)

func TestConstants(t *testing.T) {
	testx.AssertEqual(t, MaxItems, 200)
	testx.AssertEqual(t, MaxLimit, 100)
	testx.AssertEqual(t, CodeLimitReached, "WISHLIST_LIMIT_REACHED")
}

// rawCursor encodes c as the API would, without encodeCursor's choices.
func rawCursor(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	testx.AssertNoError(t, err)
	return base64.RawURLEncoding.EncodeToString(b)
}

func TestCursor_RoundTrip(t *testing.T) {
	tests := []struct {
		name string
		e    Entry
	}{
		{name: "UTC", e: Entry{ProductID: pidA, AddedAt: time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)}},
		{name: "a zone is stored as the same instant in UTC", e: Entry{ProductID: pidB, AddedAt: time.Date(2026, 11, 1, 17, 30, 0, 0, time.FixedZone("WIB", 7*3600))}},
		{name: "microseconds survive (the column's precision)", e: Entry{ProductID: pidC, AddedAt: time.Date(2026, 11, 1, 10, 0, 0, 123456000, time.UTC)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cursor := encodeCursor(tt.e)
			_, err := base64.RawURLEncoding.DecodeString(cursor)
			testx.AssertNoError(t, err, "unpadded base64url, safe in a query string")
			testx.AssertTrue(t, len(cursor) <= 512, "cursor is %d characters, the handler accepts 512", len(cursor))

			got, err := decodeCursor(cursor)

			testx.AssertNoError(t, err)
			testx.AssertEqual(t, got.ProductID, tt.e.ProductID)
			testx.AssertTrue(t, got.CreatedAt.Equal(tt.e.AddedAt), "CreatedAt = %s, want %s", got.CreatedAt, tt.e.AddedAt)
		})
	}
}

func TestCursor_EmptyIsTheFirstPage(t *testing.T) {
	got, err := decodeCursor("")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got, firstPage)
	testx.AssertEqual(t, got.CreatedAt, time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC))
	testx.AssertEqual(t, got.ProductID, "ffffffff-ffff-ffff-ffff-ffffffffffff")
}

func TestCursor_Invalid(t *testing.T) {
	at := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		cursor string
		reason string
	}{
		{name: "not base64url", cursor: "not*base64", reason: "not base64url"},
		{name: "padded base64", cursor: base64.URLEncoding.EncodeToString([]byte(`{"l":"wishlist"}`)), reason: "not base64url"},
		{name: "not JSON", cursor: base64.RawURLEncoding.EncodeToString([]byte("page=2")), reason: "not a cursor"},
		{name: "JSON of the wrong shape", cursor: base64.RawURLEncoding.EncodeToString([]byte(`[1,2]`)), reason: "not a cursor"},
		{name: "the list name is missing", cursor: rawCursor(t, map[string]any{"t": at, "id": pidA}), reason: "made for another list"},
		{name: "another list's name", cursor: rawCursor(t, cursorJSON{List: "orders", CreatedAt: at, ID: pidA}), reason: "made for another list"},
		{name: "the list name is case sensitive", cursor: rawCursor(t, cursorJSON{List: "Wishlist", CreatedAt: at, ID: pidA}), reason: "made for another list"},
		{
			name:   "a product list cursor",
			cursor: rawCursor(t, map[string]any{"s": "newest", "f": "5ed1a3b3a6e0e5a0", "t": at, "id": pidA}), reason: "made for another list",
		},
		{name: "no time", cursor: rawCursor(t, cursorJSON{List: listName, ID: pidA}), reason: "made for another list"},
		{name: "no id", cursor: rawCursor(t, cursorJSON{List: listName, CreatedAt: at}), reason: "made for another list"},
		{name: "id is not a UUID", cursor: rawCursor(t, cursorJSON{List: listName, CreatedAt: at, ID: "1 OR 1=1"}), reason: "made for another list"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeCursor(tt.cursor)

			testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor), "err = %v, want ErrInvalidCursor", err)
			testx.AssertEqual(t, err.Error(), "invalid cursor: "+tt.reason)
			testx.AssertEqual(t, got, position{})
		})
	}
}
