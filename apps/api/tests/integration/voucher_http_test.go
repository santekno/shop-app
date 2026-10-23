//go:build integration

package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// TestVouchers_Refusals: each reason a voucher does not apply is a 409
// VOUCHER_NOT_APPLICABLE with details.voucher_code and details.reason, in
// the preview and at checkout; min_spend also names the amount, and a
// voucher that has not started is not_found. Nothing is counted for a
// refused voucher.
func TestVouchers_Refusals(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-voucher", variant("VC-M", "M", 60000, 50))
	m := p.Variants["VC-M"]
	now := time.Now()
	ids := map[string]string{
		"BELUM":   sh.voucher(t, voucherSpec{code: "BELUM", kind: "fixed", value: 5000, startsAt: now.Add(time.Hour), endsAt: now.Add(2 * time.Hour)}),
		"LEWAT":   sh.voucher(t, voucherSpec{code: "LEWAT", kind: "fixed", value: 5000, startsAt: now.Add(-2 * time.Hour), endsAt: now.Add(-time.Hour)}),
		"HABIS":   sh.voucher(t, voucherSpec{code: "HABIS", kind: "fixed", value: 5000, usageLimit: 1}),
		"MINIMAL": sh.voucher(t, voucherSpec{code: "MINIMAL", kind: "fixed", value: 5000, minSpend: 100000}),
		"SEKALI":  sh.voucher(t, voucherSpec{code: "SEKALI", kind: "fixed", value: 5000, perUser: 1}),
	}
	mustExec(t, sh.db, `UPDATE vouchers SET used_count = 1 WHERE code = 'HABIS'`)
	b := sh.buyer(t, "voucher")
	sh.add(t, b, m, 1)
	o := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), "SEKALI")),
		http.StatusCreated, "first use of SEKALI")
	if o.VoucherCode == nil || *o.VoucherCode != "SEKALI" || o.Totals.Discount != moneyOf(5000) {
		t.Errorf("order = voucher %v, discount %d", o.VoucherCode, o.Totals.Discount.Amount)
	}
	sh.add(t, b, m, 1)

	tests := []struct{ code, reason string }{
		// A promo that has not started answers like an unknown code, so
		// upcoming codes cannot be found by trying them (OWASP API6).
		{"TIDAKADA", "not_found"}, {"BELUM", "not_found"}, {"LEWAT", "expired"}, {"HABIS", "exhausted"},
		{"MINIMAL", "min_spend"}, {"SEKALI", "per_user_limit"},
	}
	for _, tt := range tests {
		t.Run(tt.code, func(t *testing.T) {
			for what, resp := range map[string]response{
				"preview":  sh.call(t, http.MethodPost, "/v1/checkout/preview", map[string]any{"voucher_code": tt.code}, b.Token),
				"checkout": sh.checkout(t, b.Token, uuidx.NewV7(), withVoucher(checkoutBody(b.AddressID), tt.code)),
			} {
				details := assertError(t, resp, http.StatusConflict, "VOUCHER_NOT_APPLICABLE")
				if details["voucher_code"] != tt.code || details["reason"] != tt.reason {
					t.Errorf("%s details = %v, want %s %s", what, details, tt.code, tt.reason)
				}
				if tt.reason == "min_spend" {
					min, _ := details["min_spend"].(map[string]any)
					if min["amount"] != float64(100000) || min["currency"] != "IDR" {
						t.Errorf("%s min_spend = %v, want Rp100.000 as Money", what, details["min_spend"])
					}
				}
			}
		})
	}
	for code, id := range ids {
		want := map[string]int{"HABIS": 1, "SEKALI": 1}[code]
		if n := sh.usedCount(t, id); n != want {
			t.Errorf("%s used_count = %d, want %d", code, n, want)
		}
	}
	if n := sh.count(t, `SELECT count(*) FROM orders`); n != 1 {
		t.Errorf("%d orders, want only the first", n)
	}
	assertNoErrorLog(t, sh.server)
}

// TestVouchers_UseAndGiveBack applies a percent voucher typed in lower case
// (codes match case-insensitively): the preview shows it, checkout counts
// its use and copies the code; cancelling the order gives the use back,
// so the buyer, limited to one use, can use it again.
func TestVouchers_UseAndGiveBack(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-hemat", variant("HM-M", "M", 120000, 10))
	m := p.Variants["HM-M"]
	id := sh.voucher(t, voucherSpec{code: "HEMAT10", kind: "percent", value: 10, minSpend: 100000, maxDiscount: 25000, usageLimit: 1000})
	b := sh.buyer(t, "hemat")
	sh.add(t, b, m, 1)
	body := withVoucher(checkoutBody(b.AddressID), "hemat10")

	pv := assertPreview(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", body, b.Token))
	if pv.Voucher == nil || pv.Voucher.Code != "HEMAT10" || pv.Voucher.Kind != "percent" || pv.Voucher.Value != 10 ||
		pv.Voucher.MaxDiscount == nil || *pv.Voucher.MaxDiscount != moneyOf(25000) || pv.Totals.Discount != moneyOf(12000) {
		t.Errorf("preview voucher %+v, discount %d", pv.Voucher, pv.Totals.Discount.Amount)
	}
	if n := sh.usedCount(t, id); n != 0 {
		t.Errorf("a preview counted a use: used_count %d", n)
	}

	o := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), body), http.StatusCreated, "checkout")
	if o.VoucherCode == nil || *o.VoucherCode != "HEMAT10" || o.Totals.Discount != moneyOf(12000) {
		t.Errorf("order voucher %v, discount %d", o.VoucherCode, o.Totals.Discount.Amount)
	}
	if n := sh.usedCount(t, id); n != 1 {
		t.Errorf("used_count = %d after checkout, want 1", n)
	}
	if n := sh.count(t, `SELECT count(*) FROM orders WHERE id = $1 AND voucher_id = $2 AND voucher_code = 'HEMAT10'`, o.ID, id); n != 1 {
		t.Error("the order row does not point at the voucher")
	}

	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	if n := sh.usedCount(t, id); n != 0 {
		t.Errorf("used_count = %d after the cancel, want the use given back", n)
	}
	sh.add(t, b, m, 1)
	assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), body), http.StatusCreated, "the voucher again after the cancel")
	if n := sh.usedCount(t, id); n != 1 {
		t.Errorf("used_count = %d, want 1", n)
	}
}
