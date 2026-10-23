package cart

import (
	"fmt"
	"slices"
	"testing"
)

// variantN is the n-th test variant ID.
func variantN(n int) string { return fmt.Sprintf("0190c8a0-0000-7000-9000-%012d", n) }

// at is a line of variant n with quantity, added at addedPrice, now priced
// at price, with stock on hand.
func lineOf(n int, quantity int32, addedPrice, price int64, stock int32) Line {
	return Line{VariantID: variantN(n), Quantity: quantity, AddedPrice: addedPrice, Price: price, Stock: stock, Sellable: true}
}

func TestMerge(t *testing.T) {
	tests := []struct {
		name  string
		user  []Line
		guest []Line
		want  []LineWrite
	}{
		{name: "nothing to merge", user: []Line{lineOf(1, 1, 100, 100, 5)}, guest: nil, want: nil},
		{
			name:  "a variant in both carts gets the sum, at the user's price",
			user:  []Line{lineOf(1, 2, 100, 120, 10)},
			guest: []Line{lineOf(1, 3, 110, 120, 10)},
			want:  []LineWrite{{VariantID: variantN(1), Quantity: 5, UnitPrice: 100}},
		},
		{
			name:  "the sum stops at 99",
			user:  []Line{lineOf(1, 60, 100, 100, 1000)},
			guest: []Line{lineOf(1, 60, 100, 100, 1000)},
			want:  []LineWrite{{VariantID: variantN(1), Quantity: 99, UnitPrice: 100}},
		},
		{
			name:  "the sum stops at the stock",
			user:  []Line{lineOf(1, 2, 100, 100, 4)},
			guest: []Line{lineOf(1, 5, 100, 100, 4)},
			want:  []LineWrite{{VariantID: variantN(1), Quantity: 4, UnitPrice: 100}},
		},
		{
			// The stock fell below what the user's cart holds: a merge
			// only adds, so the user's line stays as it is (no write).
			name:  "never below the user's quantity",
			user:  []Line{lineOf(1, 8, 100, 100, 5)},
			guest: []Line{lineOf(1, 3, 100, 100, 5)},
			want:  nil,
		},
		{
			name:  "the user's line already at the cap is left alone",
			user:  []Line{lineOf(1, 99, 100, 100, 500)},
			guest: []Line{lineOf(1, 1, 100, 100, 500)},
			want:  nil,
		},
		{
			name:  "a new line keeps the guest's price",
			user:  nil,
			guest: []Line{lineOf(2, 3, 90, 95, 10)},
			want:  []LineWrite{{VariantID: variantN(2), Quantity: 3, UnitPrice: 90}},
		},
		{
			name:  "a new line is cut to the stock",
			guest: []Line{lineOf(2, 7, 90, 90, 2)},
			want:  []LineWrite{{VariantID: variantN(2), Quantity: 2, UnitPrice: 90}},
		},
		{
			name:  "a sold-out new line is not carried over",
			guest: []Line{lineOf(2, 1, 90, 90, 0)},
			want:  nil,
		},
		{
			name:  "an unsellable new line is not carried over",
			guest: []Line{func() Line { l := lineOf(2, 1, 90, 90, 10); l.Sellable = false; return l }()},
			want:  nil,
		},
		{
			name:  "an unsellable guest line does not touch the user's line",
			user:  []Line{lineOf(1, 1, 100, 100, 10)},
			guest: []Line{func() Line { l := lineOf(1, 4, 100, 100, 10); l.Sellable = false; return l }()},
			want:  nil,
		},
		{
			name:  "lines are written in the guest cart's order",
			user:  []Line{lineOf(1, 1, 100, 100, 10)},
			guest: []Line{lineOf(3, 1, 30, 30, 10), lineOf(1, 1, 100, 100, 10), lineOf(2, 2, 20, 20, 10)},
			want: []LineWrite{
				{VariantID: variantN(3), Quantity: 1, UnitPrice: 30},
				{VariantID: variantN(1), Quantity: 2, UnitPrice: 100},
				{VariantID: variantN(2), Quantity: 2, UnitPrice: 20},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assertWrites(t, Merge(tt.user, tt.guest), tt.want)
		})
	}
}

// At most MaxLines lines: the oldest guest lines are carried over first,
// and a guest line for a variant the user already has needs no new line.
func TestMerge_LineCap(t *testing.T) {
	user := make([]Line, 0, MaxLines)
	for i := range MaxLines - 1 {
		user = append(user, lineOf(i+1, 1, 100, 100, 10))
	}
	guest := []Line{
		lineOf(1, 1, 100, 100, 10), // in the user's cart: merged, no new line
		lineOf(100, 1, 50, 50, 10), // the 50th line
		lineOf(101, 1, 50, 50, 10), // over the cap
		lineOf(102, 1, 50, 50, 0),  // sold out: skipped, takes no line
		lineOf(2, 1, 100, 100, 10), // in the user's cart: still merged
		lineOf(103, 1, 50, 50, 10), // over the cap
	}
	got := Merge(user, guest)
	assertWrites(t, got, []LineWrite{
		{VariantID: variantN(1), Quantity: 2, UnitPrice: 100},
		{VariantID: variantN(100), Quantity: 1, UnitPrice: 50},
		{VariantID: variantN(2), Quantity: 2, UnitPrice: 100},
	})

	t.Run("a full user cart takes no new line at all", func(t *testing.T) {
		full := append(user, lineOf(MaxLines, 1, 100, 100, 10))
		got := Merge(full, []Line{lineOf(200, 1, 50, 50, 10), lineOf(MaxLines, 2, 100, 100, 10)})
		assertWrites(t, got, []LineWrite{{VariantID: variantN(MaxLines), Quantity: 3, UnitPrice: 100}})
	})
	t.Run("a sold-out line does not use up the last free line", func(t *testing.T) {
		got := Merge(user, []Line{lineOf(300, 1, 50, 50, 0), lineOf(301, 1, 50, 50, 10)})
		assertWrites(t, got, []LineWrite{{VariantID: variantN(301), Quantity: 1, UnitPrice: 50}})
	})
}

// assertWrites checks Merge's answer line by line.
func assertWrites(t *testing.T, got, want []LineWrite) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Fatalf("Merge wrote\n  %+v\nwant\n  %+v", got, want)
	}
}
