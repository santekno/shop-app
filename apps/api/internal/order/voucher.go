package order

import (
	"strings"
	"time"
)

// Voucher kinds; the vouchers_kind_check constraint's values.
const (
	VoucherPercent = "percent"
	VoucherFixed   = "fixed"
)

// Voucher is a discount code (ADR 0006).
type Voucher struct {
	ID   string
	Code string
	Kind string
	// Value is the percent (1-100) or the rupiah amount, by Kind.
	Value int64
	// MinSpend is the subtotal the goods must reach, in rupiah; 0 = none.
	MinSpend int64
	// MaxDiscount caps a discount in rupiah; 0 = no cap.
	MaxDiscount int64
	// The voucher works from StartsAt until just before EndsAt.
	StartsAt time.Time
	EndsAt   time.Time
	// UsageLimit is the total number of uses, 0 for unlimited; UsedCount
	// how many there have been.
	UsageLimit int32
	UsedCount  int32
	// PerUserLimit is how many orders one buyer may use it on.
	PerUserLimit int32
}

// Why a voucher does not apply; VoucherError.Reason.
const (
	VoucherNotFound     = "not_found"
	VoucherNotStarted   = "not_started"
	VoucherExpired      = "expired"
	VoucherMinSpend     = "min_spend"
	VoucherExhausted    = "exhausted"
	VoucherPerUserLimit = "per_user_limit"
)

// VoucherError says why a voucher code does not apply to this checkout.
// It is answered 409 VOUCHER_NOT_APPLICABLE.
type VoucherError struct {
	Code   string
	Reason string
	// MinSpend is set for VoucherMinSpend.
	MinSpend int64
}

func (e *VoucherError) Error() string { return "voucher " + e.Code + ": " + e.Reason }

// NormalizeVoucherCode is how codes are compared: trimmed and upper-case,
// so "hemat10 " finds HEMAT10.
func NormalizeVoucherCode(code string) string { return strings.ToUpper(strings.TrimSpace(code)) }

// check returns why v cannot be used at now on goods worth subtotal by a
// buyer who has used it userUses times before, or nil. The total limit is
// checked here for a clear answer, and again by the guarded UPDATE at
// checkout, which is what makes it race-safe.
func (v Voucher) check(now time.Time, subtotal int64, userUses int64) error {
	reason := ""
	switch {
	case now.Before(v.StartsAt):
		reason = VoucherNotStarted
	case !now.Before(v.EndsAt):
		reason = VoucherExpired
	case v.UsageLimit > 0 && v.UsedCount >= v.UsageLimit:
		reason = VoucherExhausted
	case userUses >= int64(v.PerUserLimit):
		reason = VoucherPerUserLimit
	case subtotal < v.MinSpend:
		return &VoucherError{Code: v.Code, Reason: VoucherMinSpend, MinSpend: v.MinSpend}
	default:
		return nil
	}
	return &VoucherError{Code: v.Code, Reason: reason}
}

// discount is v as an input of CalculateTotals.
func (v Voucher) discount() *Discount {
	d := &Discount{Max: v.MaxDiscount}
	if v.Kind == VoucherPercent {
		d.Percent = v.Value
	} else {
		d.Amount = v.Value
	}
	return d
}
