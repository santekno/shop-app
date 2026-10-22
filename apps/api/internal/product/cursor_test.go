package product

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestCursor_RoundTrip(t *testing.T) {
	p := Product{
		ID:        "0190c8a0-0000-7000-8000-000000000007",
		PriceFrom: 89000,
		// Not UTC: the cursor stores the instant in UTC.
		CreatedAt: time.Date(2026, 10, 1, 19, 30, 0, 123456789, time.FixedZone("WIB", 7*3600)),
	}
	tests := []struct {
		name   string
		params ListParams
		want   position
	}{
		{
			name:   "newest keeps the creation time",
			params: ListParams{Sort: SortNewest},
			want:   position{CreatedAt: p.CreatedAt.UTC(), ID: p.ID},
		},
		{
			name:   "price_asc keeps the price",
			params: ListParams{Sort: SortPriceAsc, Category: "kaos"},
			want:   position{Price: 89000, ID: p.ID},
		},
		{
			name:   "price_desc with a search",
			params: ListParams{Sort: SortPriceDesc, Category: "kaos", Query: "batik"},
			want:   position{Price: 89000, ID: p.ID},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cursor := encodeCursor(tt.params, p)
			_, err := base64.RawURLEncoding.DecodeString(cursor)
			testx.AssertNoError(t, err, "the cursor is unpadded base64url, safe in a query string")

			next := tt.params
			next.Cursor = cursor
			got, err := decodeCursor(next)

			testx.AssertNoError(t, err)
			testx.AssertTrue(t, got.CreatedAt.Equal(tt.want.CreatedAt), "CreatedAt = %s, want %s", got.CreatedAt, tt.want.CreatedAt)
			testx.AssertEqual(t, got.Price, tt.want.Price)
			testx.AssertEqual(t, got.ID, tt.want.ID)
		})
	}
}

func TestCursor_StaysSmall(t *testing.T) {
	long := ListParams{Sort: SortNewest, Category: "kaos", Query: string(make([]byte, 100))}
	cursor := encodeCursor(long, testProducts(1)[0])
	// The filters are a fingerprint, not the text: well under the 512
	// characters the handler accepts.
	testx.AssertTrue(t, len(cursor) < 200, "cursor is %d characters", len(cursor))
}

func TestCursor_EmptyIsTheStart(t *testing.T) {
	tests := []struct {
		sort Sort
		want position
	}{
		{sort: SortNewest, want: position{CreatedAt: time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC), ID: "ffffffff-ffff-ffff-ffff-ffffffffffff"}},
		{sort: SortPriceAsc, want: position{Price: 0, ID: "00000000-0000-0000-0000-000000000000"}},
		{sort: SortPriceDesc, want: position{Price: math.MaxInt64, ID: "ffffffff-ffff-ffff-ffff-ffffffffffff"}},
	}
	for _, tt := range tests {
		t.Run(string(tt.sort), func(t *testing.T) {
			got, err := decodeCursor(ListParams{Sort: tt.sort})
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, got, tt.want)
		})
	}
}

// rawCursor encodes c as the API would, without encodeCursor's checks.
func rawCursor(t *testing.T, c cursorJSON) string {
	t.Helper()
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func TestCursor_Invalid(t *testing.T) {
	p := testProducts(1)[0]
	kaosNewest := ListParams{Sort: SortNewest, Category: "kaos"}
	valid := encodeCursor(kaosNewest, p)
	priceAsc := ListParams{Sort: SortPriceAsc}
	tests := []struct {
		name   string
		params ListParams // Cursor set below unless already set
		cursor string
		reason string
	}{
		{name: "not base64url", params: kaosNewest, cursor: "not*base64", reason: "not base64url"},
		{name: "padded base64 is not accepted", params: kaosNewest, cursor: base64.URLEncoding.EncodeToString([]byte(`{"s":"newest"}`)), reason: "not base64url"},
		{name: "base64 of something that is not JSON", params: kaosNewest, cursor: base64.RawURLEncoding.EncodeToString([]byte("page=2")), reason: "not a cursor"},
		{name: "JSON of the wrong shape", params: kaosNewest, cursor: base64.RawURLEncoding.EncodeToString([]byte(`[1,2]`)), reason: "not a cursor"},
		{name: "another sort", params: ListParams{Sort: SortPriceAsc, Category: "kaos"}, cursor: valid, reason: "made for another sort or other filters"},
		{name: "another category", params: ListParams{Sort: SortNewest, Category: "kemeja"}, cursor: valid, reason: "made for another sort or other filters"},
		{name: "no category", params: ListParams{Sort: SortNewest}, cursor: valid, reason: "made for another sort or other filters"},
		{name: "a search added", params: ListParams{Sort: SortNewest, Category: "kaos", Query: "hitam"}, cursor: valid, reason: "made for another sort or other filters"},
		{
			name: "category and query cannot trade text", params: ListParams{Sort: SortNewest, Category: "ka", Query: "os"},
			cursor: encodeCursor(ListParams{Sort: SortNewest, Category: "kaos"}, p), reason: "made for another sort or other filters",
		},
		{
			name: "newest without a creation time", params: ListParams{Sort: SortNewest},
			cursor: rawCursor(t, cursorJSON{Sort: SortNewest, Filter: filterKey(ListParams{}), ID: p.ID}), reason: "missing values",
		},
		{
			name: "price sort without a price", params: priceAsc,
			cursor: rawCursor(t, cursorJSON{Sort: SortPriceAsc, Filter: filterKey(priceAsc), ID: p.ID}), reason: "missing values",
		},
		{
			name: "price sort with a negative price", params: priceAsc,
			cursor: rawCursor(t, cursorJSON{Sort: SortPriceAsc, Filter: filterKey(priceAsc), Price: -1, ID: p.ID}), reason: "missing values",
		},
		{
			name: "missing id", params: priceAsc,
			cursor: rawCursor(t, cursorJSON{Sort: SortPriceAsc, Filter: filterKey(priceAsc), Price: 100}), reason: "missing values",
		},
		{
			name: "id is not a UUID", params: priceAsc,
			cursor: rawCursor(t, cursorJSON{Sort: SortPriceAsc, Filter: filterKey(priceAsc), Price: 100, ID: "1 OR 1=1"}), reason: "missing values",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			params := tt.params
			params.Cursor = tt.cursor
			got, err := decodeCursor(params)

			testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor), "err = %v, want ErrInvalidCursor", err)
			testx.AssertEqual(t, err.Error(), "invalid cursor: "+tt.reason)
			testx.AssertEqual(t, got, position{})
		})
	}
}

func TestFilterKey(t *testing.T) {
	a := filterKey(ListParams{Category: "kaos", Query: "hitam"})
	testx.AssertEqual(t, len(a), 16, "8 bytes of SHA-256 in hex")
	testx.AssertEqual(t, a, filterKey(ListParams{Category: "kaos", Query: "hitam", Sort: SortPriceAsc, Limit: 5, Cursor: "x"}),
		"only the filters count: sort, limit and cursor do not")
	testx.AssertNotEqual(t, a, filterKey(ListParams{Category: "kaos", Query: "putih"}))
	testx.AssertNotEqual(t, a, filterKey(ListParams{Category: "kaoshitam"}))
	testx.AssertNotEqual(t, filterKey(ListParams{Category: "a", Query: "bc"}), filterKey(ListParams{Category: "ab", Query: "c"}))
}
