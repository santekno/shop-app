package order

import (
	"database/sql/driver"
	"time"
)

// orderRowValues is a GetOrder / GetOrderForUser / List* row in its column
// order: id, code, user_id, status, cancel_reason, subtotal, discount,
// shipping_fee, total, total_weight_grams, voucher_code, courier,
// courier_service, tracking_number, the six shipping_* columns,
// payment_expires_at, paid_at, shipped_at, completed_at, cancelled_at,
// created_at, updated_at.
func orderRowValues(id string, status Status) []driver.Value {
	return []driver.Value{
		id, "GS-20261023-ABC123", buyerID, string(status), nil,
		int64(120000), int64(12000), int64(9000), int64(117000), int64(500),
		"HEMAT10", "sicepat", "REG", nil,
		"Budi", "081234567890", "Jl. Merdeka 1", "Bandung", "Jawa Barat", "40111",
		testTime.Add(time.Hour), nil, nil, nil, nil, testTime, testTime,
	}
}

// Column indexes of orderRowValues that tests change.
const (
	colCancelReason = 4
	colTracking     = 13
	colPaidAt       = 21
	colCancelledAt  = 24
	colUpdatedAt    = 26
)

func orderAnswer(id string, status Status, change func(row []driver.Value)) fakeAnswer {
	row := orderRowValues(id, status)
	if change != nil {
		change(row)
	}
	return fakeAnswer{rows: [][]driver.Value{row}}
}

// itemRow is a ListOrderItems row: id, variant_id, product_name,
// variant_name, sku, unit_price, quantity, line_total.
func itemRow(id, variantID string, price, quantity int64) []driver.Value {
	return []driver.Value{id, variantID, "Kaos", "M", "SKU-1", price, quantity, price * quantity}
}

// lockedVariant is a LockCheckoutVariants row of the cart line l, as the
// database has it now.
func lockedVariant(id string, price, stock int64, sellable bool) []driver.Value {
	return []driver.Value{id, "SKU-" + id[len(id)-1:], "M", price, stock, int64(250), sellable, "p", "kaos", "Kaos"}
}

// voucherRow is a GetVoucherByCode row of v; nil maxDiscount and
// usageLimit are NULL.
func voucherRow(v Voucher, maxDiscount, usageLimit driver.Value) fakeAnswer {
	return rows(v.ID, v.Code, v.Kind, v.Value, v.MinSpend, maxDiscount, v.StartsAt, v.EndsAt, usageLimit,
		int64(v.UsedCount), int64(v.PerUserLimit))
}
