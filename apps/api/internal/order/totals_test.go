package order

import (
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
)

// one is a single line of quantity 1 at price.
func one(price int64) []TotalsLine {
	return []TotalsLine{{UnitPrice: price, Quantity: 1, WeightGrams: 100}}
}

func TestCalculateTotals(t *testing.T) {
	tests := []struct {
		name string
		in   TotalsInput
		want Totals
	}{
		{name: "nothing", in: TotalsInput{}, want: Totals{}},
		{
			name: "lines and weight add up exactly",
			in: TotalsInput{Lines: []TotalsLine{
				{UnitPrice: 12000, Quantity: 2, WeightGrams: 200},
				{UnitPrice: 345, Quantity: 1, WeightGrams: 150},
			}, ShippingFee: 9000},
			want: Totals{Subtotal: 24345, ShippingFee: 9000, Total: 33345, WeightGrams: 550},
		},
		{name: "nil discount", in: TotalsInput{Lines: one(12345), Discount: nil},
			want: Totals{Subtotal: 12345, Total: 12345, WeightGrams: 100}},
		// 10% of Rp12.345 is Rp1.234,5: halves round away from zero.
		{name: "10% of 12345 is 1235", in: TotalsInput{Lines: one(12345), ShippingFee: 10000, Discount: &Discount{Percent: 10}},
			want: Totals{Subtotal: 12345, Discount: 1235, ShippingFee: 10000, Total: 21110, WeightGrams: 100}},
		{name: "10% of 12344 rounds down", in: TotalsInput{Lines: one(12344), Discount: &Discount{Percent: 10}},
			want: Totals{Subtotal: 12344, Discount: 1234, Total: 11110, WeightGrams: 100}},
		{name: "1% of 49 is 0", in: TotalsInput{Lines: one(49), Discount: &Discount{Percent: 1}},
			want: Totals{Subtotal: 49, Discount: 0, Total: 49, WeightGrams: 100}},
		{name: "1% of 50 is 1", in: TotalsInput{Lines: one(50), Discount: &Discount{Percent: 1}},
			want: Totals{Subtotal: 50, Discount: 1, Total: 49, WeightGrams: 100}},
		{name: "33% of 100 is 33", in: TotalsInput{Lines: one(100), Discount: &Discount{Percent: 33}},
			want: Totals{Subtotal: 100, Discount: 33, Total: 67, WeightGrams: 100}},
		// 98.999.999.901 × 7 / 100 = 6.929.999.993,07: exact, no float.
		{name: "a large amount stays exact", in: TotalsInput{Lines: []TotalsLine{{UnitPrice: 999_999_999, Quantity: 99}}, Discount: &Discount{Percent: 7}},
			want: Totals{Subtotal: 98_999_999_901, Discount: 6_929_999_993, Total: 92_069_999_908}},
		{name: "the max caps a percent discount", in: TotalsInput{Lines: one(200000), Discount: &Discount{Percent: 50, Max: 50000}},
			want: Totals{Subtotal: 200000, Discount: 50000, Total: 150000, WeightGrams: 100}},
		{name: "a max above the discount changes nothing", in: TotalsInput{Lines: one(200000), Discount: &Discount{Percent: 10, Max: 50000}},
			want: Totals{Subtotal: 200000, Discount: 20000, Total: 180000, WeightGrams: 100}},
		{name: "the max caps a fixed discount too", in: TotalsInput{Lines: one(200000), Discount: &Discount{Amount: 20000, Max: 5000}},
			want: Totals{Subtotal: 200000, Discount: 5000, Total: 195000, WeightGrams: 100}},
		{name: "a fixed discount", in: TotalsInput{Lines: one(150000), ShippingFee: 9000, Discount: &Discount{Amount: 15000}},
			want: Totals{Subtotal: 150000, Discount: 15000, ShippingFee: 9000, Total: 144000, WeightGrams: 100}},
		// The goods never cost less than nothing, and the shipping fee is
		// never discounted.
		{name: "a fixed discount above the subtotal stops at the subtotal", in: TotalsInput{Lines: one(10000), ShippingFee: 9000, Discount: &Discount{Amount: 15000}},
			want: Totals{Subtotal: 10000, Discount: 10000, ShippingFee: 9000, Total: 9000, WeightGrams: 100}},
		{name: "100% leaves the shipping fee", in: TotalsInput{Lines: one(10000), ShippingFee: 9000, Discount: &Discount{Percent: 100}},
			want: Totals{Subtotal: 10000, Discount: 10000, ShippingFee: 9000, Total: 9000, WeightGrams: 100}},
		{name: "a negative amount is no discount", in: TotalsInput{Lines: one(10000), Discount: &Discount{Amount: -500}},
			want: Totals{Subtotal: 10000, Discount: 0, Total: 10000, WeightGrams: 100}},
		{name: "an empty discount is no discount", in: TotalsInput{Lines: one(10000), Discount: &Discount{}},
			want: Totals{Subtotal: 10000, Total: 10000, WeightGrams: 100}},
		{name: "a discount on an empty cart is 0", in: TotalsInput{Discount: &Discount{Amount: 5000}}, want: Totals{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CalculateTotals(tt.in)
			testx.AssertEqual(t, got, tt.want)
			testx.AssertEqual(t, got.Total, got.Subtotal-got.Discount+got.ShippingFee, "the orders CHECK")
			testx.AssertTrue(t, got.Discount >= 0 && got.Discount <= got.Subtotal, "0 <= discount <= subtotal")
		})
	}
}

// The totals are at today's price, not the price the buyer saw.
func TestTotalsLines(t *testing.T) {
	l := line(v1, 3, 1000, 10)
	l.AddedPrice = 900
	got := totalsLines([]cart.Line{l})
	testx.AssertEqual(t, len(got), 1)
	testx.AssertEqual(t, got[0], TotalsLine{UnitPrice: 1000, Quantity: 3, WeightGrams: 250})
	testx.AssertEqual(t, len(totalsLines(nil)), 0)
}
