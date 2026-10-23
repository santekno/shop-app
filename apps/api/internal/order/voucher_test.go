package order

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestVoucher_Check(t *testing.T) {
	v := hemat10()
	inside := testTime
	tests := []struct {
		name     string
		edit     func(v *Voucher)
		now      time.Time
		subtotal int64
		uses     int64
		want     string // "" when it applies
	}{
		{name: "applies", now: inside, subtotal: 100000},
		{name: "from the first instant", now: v.StartsAt, subtotal: 100000},
		{name: "not started", now: v.StartsAt.Add(-time.Nanosecond), subtotal: 100000, want: VoucherNotStarted},
		{name: "ends exactly at EndsAt", now: v.EndsAt, subtotal: 100000, want: VoucherExpired},
		{name: "expired", now: v.EndsAt.Add(time.Hour), subtotal: 100000, want: VoucherExpired},
		{name: "exhausted", edit: func(v *Voucher) { v.UsedCount = v.UsageLimit }, now: inside, subtotal: 100000, want: VoucherExhausted},
		{name: "one use left", edit: func(v *Voucher) { v.UsedCount = v.UsageLimit - 1 }, now: inside, subtotal: 100000},
		{name: "no usage limit", edit: func(v *Voucher) { v.UsageLimit, v.UsedCount = 0, 1_000_000 }, now: inside, subtotal: 100000},
		{name: "used by this buyer already", now: inside, subtotal: 100000, uses: 1, want: VoucherPerUserLimit},
		{name: "a buyer below their limit", edit: func(v *Voucher) { v.PerUserLimit = 3 }, now: inside, subtotal: 100000, uses: 2},
		{name: "below the minimum spend", now: inside, subtotal: 99999, want: VoucherMinSpend},
		{name: "no minimum spend", edit: func(v *Voucher) { v.MinSpend = 0 }, now: inside, subtotal: 1},
		// Precedence: the window, then the total uses, then the buyer's
		// uses, then the minimum spend.
		{name: "not started beats everything", edit: func(v *Voucher) { v.UsedCount = v.UsageLimit },
			now: v.StartsAt.Add(-time.Hour), subtotal: 1, uses: 5, want: VoucherNotStarted},
		{name: "expired beats exhausted", edit: func(v *Voucher) { v.UsedCount = v.UsageLimit },
			now: v.EndsAt, subtotal: 1, uses: 5, want: VoucherExpired},
		{name: "exhausted beats the buyer's limit", edit: func(v *Voucher) { v.UsedCount = v.UsageLimit },
			now: inside, subtotal: 1, uses: 5, want: VoucherExhausted},
		{name: "the buyer's limit beats the minimum spend", now: inside, subtotal: 1, uses: 1, want: VoucherPerUserLimit},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := hemat10()
			if tt.edit != nil {
				tt.edit(&v)
			}
			err := v.check(tt.now, tt.subtotal, tt.uses)
			if tt.want == "" {
				testx.AssertNoError(t, err)
				return
			}
			var ve *VoucherError
			if !errors.As(err, &ve) {
				t.Fatalf("want *VoucherError %s, got %v", tt.want, err)
			}
			testx.AssertEqual(t, ve.Reason, tt.want)
			testx.AssertEqual(t, ve.Code, "HEMAT10")
			if tt.want == VoucherMinSpend {
				testx.AssertEqual(t, ve.MinSpend, int64(100000), "the buyer is told how much to reach")
			} else {
				testx.AssertEqual(t, ve.MinSpend, int64(0))
			}
		})
	}
}

func TestVoucherError(t *testing.T) {
	err := &VoucherError{Code: "HEMAT10", Reason: VoucherExpired}
	testx.AssertEqual(t, err.Error(), "voucher HEMAT10: expired")
}

func TestNormalizeVoucherCode(t *testing.T) {
	for in, want := range map[string]string{
		"hemat10 ":  "HEMAT10",
		" HeMaT10":  "HEMAT10",
		"HEMAT10":   "HEMAT10",
		"\themat\n": "HEMAT",
		"":          "",
		"   ":       "",
	} {
		testx.AssertEqual(t, NormalizeVoucherCode(in), want, "NormalizeVoucherCode(%q)", in)
	}
}

func TestVoucher_Discount(t *testing.T) {
	testx.AssertEqual(t, *hemat10().discount(), Discount{Percent: 10, Max: 25000})
	fixed := Voucher{Kind: VoucherFixed, Value: 15000}
	testx.AssertEqual(t, *fixed.discount(), Discount{Amount: 15000})
	// Applied: 10% of Rp300.000 is Rp30.000, capped at Rp25.000.
	got := CalculateTotals(TotalsInput{Lines: one(300000), Discount: hemat10().discount()})
	testx.AssertEqual(t, got.Discount, int64(25000))
}

// A promotion that has not started answers like an unknown code, so its
// code cannot be found out by trying (OWASP API6). Every other reason is
// told as it is.
func TestToHTTPError_VoucherReasons(t *testing.T) {
	for internal, answered := range map[string]string{
		VoucherNotStarted:   VoucherNotFound,
		VoucherNotFound:     VoucherNotFound,
		VoucherExpired:      VoucherExpired,
		VoucherExhausted:    VoucherExhausted,
		VoucherPerUserLimit: VoucherPerUserLimit,
		VoucherMinSpend:     VoucherMinSpend,
	} {
		t.Run(internal, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/checkout/preview", nil)
			httpapi.Error(rec, req, toHTTPError(&VoucherError{Code: "PROMO", Reason: internal, MinSpend: 100}))
			b := assertError(t, rec, http.StatusConflict, CodeVoucher)
			testx.AssertEqual(t, b.Error.Details["reason"], any(answered))
			testx.AssertEqual(t, b.Error.Details["voucher_code"], any("PROMO"))
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "not_started"), "the word never reaches the client")
		})
	}
	// The reason stays internal for the service's own logic.
	err := hemat10().check(hemat10().StartsAt.Add(-time.Second), 100000, 0)
	var ve *VoucherError
	testx.AssertTrue(t, errors.As(err, &ve))
	testx.AssertEqual(t, ve.Reason, VoucherNotStarted)
}
