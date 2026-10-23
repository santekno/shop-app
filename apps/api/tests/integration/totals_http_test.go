//go:build integration

package integration_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// TestCheckoutTotals checks the money of ADR 0006 end to end, in the
// preview and in the stored order: the shipping fee per started kilogram,
// a percent discount rounded once to the nearest rupiah with halves away
// from zero, the cap at max_discount, a fixed discount capped at the
// subtotal, and a shipping fee that is never discounted. orders' CHECK
// (total = subtotal - discount + shipping_fee) holds for every row.
func TestCheckoutTotals(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-total", variant("TT-GANJIL", "Ganjil", 89005, 50), variant("TT-MAHAL", "Mahal", 1000000, 50),
		variant("TT-MURAH", "Murah", 30000, 50))
	v := p.Variants
	sh.voucher(t, voucherSpec{code: "PERSEN10", kind: "percent", value: 10, perUser: 9})
	sh.voucher(t, voucherSpec{code: "PERSEN50", kind: "percent", value: 50, maxDiscount: 75000, perUser: 9})
	sh.voucher(t, voucherSpec{code: "POTONG100RB", kind: "fixed", value: 100000, perUser: 9})

	tests := []struct {
		name      string
		lines     []line
		voucher   string
		subtotal  int64
		discount  int64
		weight    int64
		shipping  int64 // JNE REG: Rp10.000 per started kilogram
		wantTotal int64
	}{
		// 10% of 89 005 is 8 900.5: rounded once, half away from zero.
		{"half rupiah rounds up", []line{{v["TT-GANJIL"], 1}}, "PERSEN10", 89005, 8901, 200, 10000, 89005 - 8901 + 10000},
		// 5 × 200 g = 1 000 g is one kilogram; 6 units are 1 200 g, two.
		{"one kilogram exactly", []line{{v["TT-MURAH"], 5}}, "", 150000, 0, 1000, 10000, 160000},
		{"a started kilogram", []line{{v["TT-MURAH"], 6}}, "", 180000, 0, 1200, 20000, 200000},
		// 50% of 1 000 000 is 500 000, capped at 75 000.
		{"percent capped", []line{{v["TT-MAHAL"], 1}}, "PERSEN50", 1000000, 75000, 200, 10000, 1000000 - 75000 + 10000},
		// Rp100.000 off goods worth Rp30.000: capped at the subtotal; the
		// shipping fee is still charged.
		{"fixed capped at the subtotal", []line{{v["TT-MURAH"], 1}}, "POTONG100RB", 30000, 30000, 200, 10000, 10000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := sh.buyer(t, "total")
			for _, l := range tt.lines {
				sh.add(t, b, l.variantID, l.quantity)
			}
			body := checkoutBody(b.AddressID)
			if tt.voucher != "" {
				body = withVoucher(body, tt.voucher)
			}
			want := totalsOut{Subtotal: moneyOf(tt.subtotal), Discount: moneyOf(tt.discount), ShippingFee: moneyOf(tt.shipping),
				Total: moneyOf(tt.wantTotal), WeightGrams: tt.weight}
			pv := assertPreview(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", body, b.Token))
			if pv.Totals != want {
				t.Errorf("preview totals = %+v, want %+v", pv.Totals, want)
			}
			if pv.Shipping == nil || pv.Shipping.Courier != "jne" || pv.Shipping.Service != "REG" {
				t.Errorf("preview shipping = %+v, want JNE REG", pv.Shipping)
			}
			o := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), body), http.StatusCreated, "checkout")
			if o.Totals != want {
				t.Errorf("order totals = %+v, want %+v", o.Totals, want)
			}
			if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND subtotal = $2 AND discount = $3
				AND shipping_fee = $4 AND total = $5 AND total_weight_grams = $6`,
				o.ID, tt.subtotal, tt.discount, tt.shipping, tt.wantTotal, tt.weight); n != 1 {
				t.Error("the stored order's amounts differ from the answer")
			}
		})
	}
}
