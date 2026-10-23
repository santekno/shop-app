package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// seedVoucher is one example voucher (ADR 0006). The API has no voucher
// admin yet (Bab 12), so make seed is how a developer gets some.
type seedVoucher struct {
	code         string
	kind         string
	value        int64
	minSpend     int64
	maxDiscount  any // int64, or nil for no cap
	usageLimit   any // int32, or nil for unlimited
	perUserLimit int32
}

var vouchers = []seedVoucher{
	// 10% off from Rp100.000, at most Rp25.000 off, once per buyer.
	{code: "HEMAT10", kind: "percent", value: 10, minSpend: 100_000, maxDiscount: int64(25_000), usageLimit: int32(1000), perUserLimit: 1},
	// Rp15.000 off from Rp150.000, three times per buyer.
	{code: "POTONG15RB", kind: "fixed", value: 15_000, minSpend: 150_000, maxDiscount: nil, usageLimit: nil, perUserLimit: 3},
	// Only five uses in total: for trying the race on the last one.
	{code: "KILAT50", kind: "percent", value: 50, minSpend: 0, maxDiscount: int64(50_000), usageLimit: int32(5), perUserLimit: 1},
}

// seedVouchers inserts the example vouchers, valid from yesterday for a
// year, and reports how many were added. Existing codes are left as they
// are, so their counters survive a second make seed.
func seedVouchers(ctx context.Context, db *sql.DB) (int, error) {
	now := time.Now()
	added := 0
	for _, v := range vouchers {
		res, err := db.ExecContext(ctx, `
			INSERT INTO vouchers (id, code, kind, value, min_spend, max_discount, starts_at, ends_at, usage_limit, per_user_limit)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (code) DO NOTHING`,
			uuidx.NewV7(), v.code, v.kind, v.value, v.minSpend, v.maxDiscount,
			now.AddDate(0, 0, -1), now.AddDate(1, 0, 0), v.usageLimit, v.perUserLimit)
		if err != nil {
			return added, fmt.Errorf("insert voucher %s: %w", v.code, err)
		}
		if n, _ := res.RowsAffected(); n == 1 {
			added++
		}
	}
	return added, nil
}
