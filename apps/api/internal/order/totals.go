package order

import (
	"github.com/santekno/sdk/moneyx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
)

// Money rules (ADR 0006):
//
//   - Every amount is whole rupiah in an int64. Sums and price × quantity
//     are exact in integers; with at most 50 lines of 99 units at most
//     Rp1.000.000.000 each, nothing comes near the int64 limit.
//   - The only division is a percent discount. It is computed with sdk
//     moneyx (an exact fraction, never a float) and rounded once, to the
//     nearest rupiah with halves away from zero (moneyx.Dec.RoundIDR):
//     10% of Rp12.345 is Rp1.234,5 and becomes Rp1.235.
//   - The discount is then capped at the voucher's maximum and at the
//     subtotal, so the goods never cost less than nothing. The shipping fee
//     is never discounted.

// Discount is a reduction of the goods' price, from a voucher (artikel 07).
type Discount struct {
	// Percent is 1 to 100 for a percent discount, 0 for a fixed one.
	Percent int64
	// Amount is the fixed discount in rupiah, when Percent is 0.
	Amount int64
	// Max caps the discount in rupiah; 0 means no cap.
	Max int64
}

// TotalsLine is one line to charge for.
type TotalsLine struct {
	UnitPrice   int64
	Quantity    int32
	WeightGrams int32
}

// TotalsInput is everything the totals depend on.
type TotalsInput struct {
	Lines       []TotalsLine
	ShippingFee int64
	// Discount is nil without a voucher.
	Discount *Discount
}

// Totals is what an order charges, in whole rupiah.
type Totals struct {
	Subtotal    int64
	Discount    int64
	ShippingFee int64
	// Total is Subtotal - Discount + ShippingFee, the amount to pay.
	Total int64
	// WeightGrams is the weight of every unit, for the shipping quote.
	WeightGrams int64
}

// CalculateTotals computes the totals of in. It is a pure function, so
// every rounding case is one row of a table test.
func CalculateTotals(in TotalsInput) Totals {
	var t Totals
	for _, l := range in.Lines {
		t.Subtotal += l.UnitPrice * int64(l.Quantity)
		t.WeightGrams += int64(l.WeightGrams) * int64(l.Quantity)
	}
	t.Discount = discountOf(t.Subtotal, in.Discount)
	t.ShippingFee = in.ShippingFee
	t.Total = t.Subtotal - t.Discount + t.ShippingFee
	return t
}

// discountOf is d applied to subtotal, rounded and capped as the money
// rules above say.
func discountOf(subtotal int64, d *Discount) int64 {
	if d == nil {
		return 0
	}
	amount := d.Amount
	if d.Percent > 0 {
		amount = moneyx.FromInt(subtotal).
			Mul(moneyx.FromInt(d.Percent)).
			Div(moneyx.FromInt(100)).
			RoundIDR()
	}
	if d.Max > 0 {
		amount = min(amount, d.Max)
	}
	return max(0, min(amount, subtotal))
}

// totalsLines turns cart lines into what CalculateTotals needs, at their
// current price.
func totalsLines(lines []cart.Line) []TotalsLine {
	out := make([]TotalsLine, 0, len(lines))
	for _, l := range lines {
		out = append(out, TotalsLine{UnitPrice: l.Price, Quantity: l.Quantity, WeightGrams: l.WeightGrams})
	}
	return out
}
