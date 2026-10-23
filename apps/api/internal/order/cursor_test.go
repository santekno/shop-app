package order

import (
	"encoding/base64"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestCursor_RoundTrip(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	o := Order{ID: orderID1, CreatedAt: time.Date(2026, 10, 23, 15, 4, 5, 123456789, wib)}
	c := encodeCursor("mine", o)

	pos, err := decodeCursor("mine", c)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, pos.ID, orderID1)
	testx.AssertTrue(t, pos.CreatedAt.Equal(o.CreatedAt), "the same instant, to the nanosecond: %v", pos.CreatedAt)
	testx.AssertEqual(t, pos.CreatedAt.Location(), time.UTC)
}

func TestDecodeCursor(t *testing.T) {
	pos, err := decodeCursor("mine", "")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, pos, firstPage, "no cursor is the first page")

	enc := func(raw string) string { return base64.RawURLEncoding.EncodeToString([]byte(raw)) }
	good := Order{ID: orderID1, CreatedAt: testTime}
	tests := []struct {
		name   string
		list   string
		cursor string
		want   string
	}{
		{name: "another list's cursor", list: "status:paid", cursor: encodeCursor("mine", good), want: "made for another list"},
		{name: "another status", list: "status:paid", cursor: encodeCursor("status:shipped", good), want: "made for another list"},
		{name: "not base64url", list: "mine", cursor: "!!!", want: "not base64url"},
		{name: "padded base64", list: "mine", cursor: encodeCursor("mine", good) + "==", want: "not base64url"},
		{name: "not JSON", list: "mine", cursor: enc("garbage"), want: "not a cursor"},
		{name: "a JSON array", list: "mine", cursor: enc(`[1,2]`), want: "not a cursor"},
		{name: "no time", list: "mine", cursor: enc(fmt.Sprintf(`{"l":"mine","id":%q}`, orderID1)), want: "made for another list"},
		{name: "not a UUID", list: "mine", cursor: enc(`{"l":"mine","t":"2026-10-23T08:00:00Z","id":"1 OR 1=1"}`), want: "made for another list"},
		{name: "no list", list: "mine", cursor: enc(fmt.Sprintf(`{"t":"2026-10-23T08:00:00Z","id":%q}`, orderID1)), want: "made for another list"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pos, err := decodeCursor(tt.list, tt.cursor)
			testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor), "err = %v", err)
			testx.AssertEqual(t, err.Error(), "invalid cursor: "+tt.want)
			testx.AssertEqual(t, pos, position{})
		})
	}
}

func TestPaginate(t *testing.T) {
	orders := func(n int) []Order {
		out := make([]Order, n)
		for i := range out {
			out[i] = Order{ID: fmt.Sprintf("0190c8a0-0000-7000-8000-%012d", i+1), CreatedAt: testTime.Add(-time.Duration(i) * time.Minute)}
		}
		return out
	}
	t.Run("a short page is the last", func(t *testing.T) {
		p := paginate("mine", orders(3), 5)
		testx.AssertEqual(t, len(p.Orders), 3)
		testx.AssertEqual(t, p.NextCursor, "")
	})
	t.Run("exactly limit rows is the last page", func(t *testing.T) {
		p := paginate("mine", orders(5), 5)
		testx.AssertEqual(t, len(p.Orders), 5)
		testx.AssertEqual(t, p.NextCursor, "")
	})
	t.Run("one more than limit: cut, and the cursor after the last kept", func(t *testing.T) {
		rows := orders(6)
		p := paginate("mine", rows, 5)
		testx.AssertEqual(t, len(p.Orders), 5)
		pos, err := decodeCursor("mine", p.NextCursor)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, pos.ID, rows[4].ID)
		testx.AssertTrue(t, pos.CreatedAt.Equal(rows[4].CreatedAt))
	})
	t.Run("empty", func(t *testing.T) {
		p := paginate("mine", nil, 5)
		testx.AssertEqual(t, len(p.Orders), 0)
		testx.AssertEqual(t, p.NextCursor, "")
	})
}
