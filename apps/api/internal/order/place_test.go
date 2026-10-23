package order

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// placeLines is a cart in the buyer's order (v3 before v1): 1 × Rp10.000
// and 2 × Rp50.000, 750 g.
func placeLines() []cart.Line {
	return []cart.Line{line(v3, 1, 10000, 5), line(v1, 2, 50000, 5)}
}

func placeIn(voucher string) PlaceInput {
	return PlaceInput{
		UserID: buyerID, Lines: placeLines(), WeightGrams: 750, VoucherCode: voucher,
		Shipping: shipping.Quote{Courier: shipping.CourierJNE, Service: "REG", Price: 10000},
		Address:  ShippingAddress{Recipient: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1", City: "Bandung", Province: "Jawa Barat", PostalCode: "40111"},
		Now:      testTime, PaymentTTL: 24 * time.Hour, IdempotencyKey: "key-1", IdempotencyClaim: "claim-1",
	}
}

const buyerCartID = "0190c8a0-0000-7000-8000-0000000000b1"

// cartLines is a ListCartLines answer for lines: variant_id, quantity,
// added_price, created_at, sku, variant_name, price, stock, weight_grams,
// sellable, product_id, product_slug, product_name.
func cartLines(lines ...cart.Line) fakeAnswer {
	var out [][]driver.Value
	for _, l := range lines {
		out = append(out, []driver.Value{
			l.VariantID, int64(l.Quantity), l.AddedPrice, testTime, l.SKU, l.VariantName, l.Price, int64(l.Stock),
			int64(l.WeightGrams), l.Sellable, l.ProductID, l.ProductSlug, l.ProductName,
		})
	}
	return fakeAnswer{rows: out}
}

// placeDB is a database where the buyer is verified with no unpaid order,
// the cart still holds placeLines, both variants are locked unchanged, and
// the voucher HEMAT10 is unused.
func placeDB() *fakeSQL {
	return newFakeSQL().
		on("LockCheckoutUser", rows(testTime)).
		on("CountPendingOrders", rows(int64(0))).
		on("LockCheckoutCart", rows(buyerCartID)).
		on("ListCartLines", cartLines(placeLines()...)).
		on("LockCheckoutVariants", fakeAnswer{rows: [][]driver.Value{
			lockedVariant(v1, 50000, 5, true), lockedVariant(v3, 10000, 5, true),
		}}).
		on("GetVoucherByCode", voucherRow(hemat10(), int64(25000), int64(1000))).
		on("CountVoucherUses", rows(int64(0))).
		on("GetOrderForUser", orderAnswer(orderID1, StatusPendingPayment, nil)).
		on("ListOrderItems", fakeAnswer{rows: [][]driver.Value{itemRow("i1", v3, 10000, 1), itemRow("i2", v1, 50000, 2)}})
}

func place(t *testing.T, db *fakeSQL, in PlaceInput) (Response, error) {
	t.Helper()
	return NewPostgresRepository(db.open(t)).Place(context.Background(), in)
}

func TestPostgresRepository_Place(t *testing.T) {
	db := placeDB()
	resp, err := place(t, db, placeIn("HEMAT10"))
	testx.AssertNoError(t, err)

	// One transaction, in the lock order of ADR 0006: the buyer, the
	// buyer's cart (read again), the variants (in id order), the voucher,
	// then the new rows, the outbox event and the idempotency row.
	assertLockedFirst(t, db, "LockCheckoutUser")
	testx.AssertEqual(t, strings.Join(db.names(), ","), strings.Join([]string{
		"BEGIN", "LockCheckoutUser", "CountPendingOrders", "LockCheckoutCart", "ListCartLines", "LockCheckoutVariants",
		"GetVoucherByCode", "CountVoucherUses", "UseVoucher",
		"InsertOrder", "InsertOrderItem", "DecrementStock", "InsertOrderItem", "DecrementStock", "DeleteOrderedCartItems",
		"GetOrderForUser", "ListOrderItems", "InsertOutboxEvent", "SaveIdempotencyResponse", "COMMIT",
	}, ","))

	assertSQL(t, db, "LockCheckoutUser", "FOR NO KEY UPDATE")
	assertSQL(t, db, "LockCheckoutCart", "WHERE user_id = $1 FOR UPDATE")
	assertSQL(t, db, "LockCheckoutVariants", "ORDER BY v.id FOR NO KEY UPDATE OF v")
	assertSQL(t, db, "DecrementStock", "AND v.stock >= $1::integer", "p.status = 'active' AND v.archived_at IS NULL")
	assertSQL(t, db, "UseVoucher", "used_count < usage_limit", "$2::timestamptz < ends_at")
	assertSQL(t, db, "SaveIdempotencyResponse", "AND claim_id = $6 AND response_status IS NULL")
	cartLock, _ := db.call("LockCheckoutCart")
	assertArgs(t, cartLock.args, []driver.Value{buyerID})
	reread, _ := db.call("ListCartLines")
	assertArgs(t, reread.args, []driver.Value{buyerCartID}, "the locked cart's lines")
	lock, _ := db.call("LockCheckoutVariants")
	assertArgs(t, lock.args, []driver.Value{pqArray(v1, v3)}, "every variant, sorted by id")
	user, _ := db.call("LockCheckoutUser")
	assertArgs(t, user.args, []driver.Value{buyerID})
	use, _ := db.call("UseVoucher")
	assertArgs(t, use.args, []driver.Value{voucherID, testTime}, "the guarded UPDATE at the checkout's clock")
	uses, _ := db.call("CountVoucherUses")
	assertArgs(t, uses.args, []driver.Value{voucherID, buyerID})

	ins, _ := db.call("InsertOrder")
	a := ins.args
	testx.AssertEqual(t, a[2], driver.Value(buyerID))
	code, _ := a[1].(string)
	testx.AssertTrue(t, regexp.MustCompile(`^GS-20261023-[0-9A-HJKMNP-TV-Z]{6}$`).MatchString(code), "code %q", code)
	// Subtotal 110000; 10% = 11000 (under the Rp25.000 cap); shipping 10000.
	assertArgs(t, a[3:12], []driver.Value{int64(110000), int64(11000), int64(10000), int64(109000), int64(750), voucherID, "HEMAT10", "jne", "REG"})
	assertArgs(t, a[12:18], []driver.Value{"Budi", "081234567890", "Jl. Merdeka 1", "Bandung", "Jawa Barat", "40111"})
	testx.AssertEqual(t, a[18], driver.Value(testTime.Add(24*time.Hour)), "payment_expires_at = now + APP_PAYMENT_TTL")

	items := db.calledAll("InsertOrderItem")
	testx.AssertEqual(t, len(items), 2)
	testx.AssertEqual(t, items[0].args[1], a[0], "the item belongs to the new order")
	assertArgs(t, items[0].args[2:], []driver.Value{v3, "Kaos", "M", "SKU-3", int64(10000), int64(1), int64(10000), testTime})
	assertArgs(t, items[1].args[2:], []driver.Value{v1, "Kaos", "M", "SKU-1", int64(50000), int64(2), int64(100000), testTime})
	// Every time on the new rows is the API's clock, not the database's.
	testx.AssertEqual(t, a[19], driver.Value(testTime), "created_at and updated_at = @now")
	assertSQL(t, db, "InsertOrder", "payment_expires_at, created_at, updated_at)", "$19, $20, $20)")
	assertSQL(t, db, "InsertOrderItem", "line_total, created_at)", "$9, $10)")
	dec := db.calledAll("DecrementStock")
	assertArgs(t, dec[0].args, []driver.Value{int64(1), v3})
	assertArgs(t, dec[1].args, []driver.Value{int64(2), v1})
	del, _ := db.call("DeleteOrderedCartItems")
	assertArgs(t, del.args, []driver.Value{buyerID, pqArray(v3, v1)}, "only the ordered lines leave the cart")

	read, _ := db.call("GetOrderForUser")
	assertArgs(t, read.args, []driver.Value{a[0], buyerID})

	ev, _ := db.call("InsertOutboxEvent")
	assertArgs(t, ev.args[1:4], []driver.Value{"order", orderID1, "order.created"})
	var payload map[string]any
	testx.AssertNoError(t, json.Unmarshal(ev.args[4].([]byte), &payload))
	testx.AssertEqual(t, payload["order_id"], any(orderID1))
	testx.AssertEqual(t, payload["status"], any("pending_payment"))
	testx.AssertEqual(t, payload["total"], any(float64(117000)))

	save, _ := db.call("SaveIdempotencyResponse")
	testx.AssertEqual(t, save.args[0], driver.Value(int64(201)))
	testx.AssertEqual(t, string(save.args[1].([]byte)), string(resp.Body), "the stored bytes are the answer")
	assertArgs(t, save.args[2:], []driver.Value{orderID1, buyerID, "key-1", "claim-1"}, "saved only under this request's claim")

	testx.AssertEqual(t, resp.Status, 201)
	testx.AssertEqual(t, resp.OrderID, orderID1)
	testx.AssertFalse(t, resp.Replayed)
	testx.AssertTrue(t, strings.HasSuffix(string(resp.Body), "}\n"), "written like httpapi.JSON")
	var body struct {
		Data struct {
			ID     string `json:"id"`
			Status string `json:"status"`
			Items  []any  `json:"items"`
		} `json:"data"`
	}
	testx.AssertNoError(t, json.Unmarshal(resp.Body, &body))
	testx.AssertEqual(t, body.Data.ID, orderID1)
	testx.AssertEqual(t, body.Data.Status, "pending_payment")
	testx.AssertEqual(t, len(body.Data.Items), 2)
}

func TestPostgresRepository_PlaceWithoutVoucher(t *testing.T) {
	db := placeDB()
	_, err := place(t, db, placeIn(""))
	testx.AssertNoError(t, err)
	for _, name := range []string{"GetVoucherByCode", "CountVoucherUses", "UseVoucher"} {
		testx.AssertFalse(t, db.ran(name), "%s without a voucher", name)
	}
	ins, _ := db.call("InsertOrder")
	assertArgs(t, ins.args[3:11], []driver.Value{int64(110000), int64(0), int64(10000), int64(120000), int64(750), nil, nil, "jne"})
}

// The lines are priced and checked on the locked rows: what the database
// says now, not what the cart said before the transaction.
func TestPostgresRepository_PlaceRevalidatesLockedRows(t *testing.T) {
	tests := []struct {
		name   string
		locked [][]driver.Value
		want   cart.Problem
		avail  int32
	}{
		{name: "the price changed", locked: [][]driver.Value{lockedVariant(v1, 55000, 5, true), lockedVariant(v3, 10000, 5, true)},
			want: cart.ProblemPriceChanged, avail: 5},
		{name: "the stock was sold", locked: [][]driver.Value{lockedVariant(v1, 50000, 1, true), lockedVariant(v3, 10000, 5, true)},
			want: cart.ProblemInsufficientStock, avail: 1},
		{name: "archived meanwhile", locked: [][]driver.Value{lockedVariant(v1, 50000, 5, false), lockedVariant(v3, 10000, 5, true)},
			want: cart.ProblemUnavailable, avail: 0},
		{name: "no row at all", locked: [][]driver.Value{lockedVariant(v3, 10000, 5, true)},
			want: cart.ProblemUnavailable, avail: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := placeDB().only("LockCheckoutVariants", fakeAnswer{rows: tt.locked})
			_, err := place(t, db, placeIn("HEMAT10"))
			var p *ProblemsError
			if !errors.As(err, &p) {
				t.Fatalf("want *ProblemsError, got %v", err)
			}
			testx.AssertEqual(t, len(p.Lines), 1)
			testx.AssertEqual(t, p.Lines[0].VariantID, v1)
			testx.AssertEqual(t, p.Lines[0].Problem, tt.want)
			testx.AssertEqual(t, p.Lines[0].Available, tt.avail)
			assertRolledBack(t, db, "UseVoucher", "InsertOrder", "DecrementStock")
		})
	}
	t.Run("a new name is copied from the locked row", func(t *testing.T) {
		db := placeDB()
		renamed := lockedVariant(v1, 50000, 5, true)
		renamed[1], renamed[2], renamed[9] = "SKU-NEW", "Jumbo", "Kaos Baru"
		db.answers["LockCheckoutVariants"] = []fakeAnswer{{rows: [][]driver.Value{renamed, lockedVariant(v3, 10000, 5, true)}}}
		_, err := place(t, db, placeIn(""))
		testx.AssertNoError(t, err)
		item := db.calledAll("InsertOrderItem")[1]
		assertArgs(t, item.args[2:6], []driver.Value{v1, "Kaos Baru", "Jumbo", "SKU-NEW"})
	})
	t.Run("a weight edited since the quote", func(t *testing.T) {
		db := placeDB()
		heavier := lockedVariant(v1, 50000, 5, true)
		heavier[5] = int64(900)
		db.answers["LockCheckoutVariants"] = []fakeAnswer{{rows: [][]driver.Value{heavier, lockedVariant(v3, 10000, 5, true)}}}
		_, err := place(t, db, placeIn("HEMAT10"))
		testx.AssertTrue(t, errors.Is(err, ErrCartChanged), "err = %v", err)
		assertRolledBack(t, db, "GetVoucherByCode", "UseVoucher", "InsertOrder")
	})
	// The voucher's minimum is checked on the goods, not on goods plus
	// shipping: 110000 of goods misses a 115000 minimum even though the
	// order with its 10000 fee is 120000.
	t.Run("the voucher minimum is on the goods' subtotal", func(t *testing.T) {
		v := hemat10()
		v.MinSpend = 115000
		db := placeDB().only("GetVoucherByCode", voucherRow(v, int64(25000), int64(1000)))
		_, err := place(t, db, placeIn("HEMAT10"))
		var ve *VoucherError
		testx.AssertTrue(t, errors.As(err, &ve), "err = %v", err)
		testx.AssertEqual(t, ve.Reason, VoucherMinSpend)
		assertRolledBack(t, db, "UseVoucher", "InsertOrder")
	})
}

// assertRolledBack checks that the transaction ended in a rollback and that
// none of names ran.
func assertRolledBack(t *testing.T, db *fakeSQL, names ...string) {
	t.Helper()
	testx.AssertTrue(t, db.ran("ROLLBACK"), "statements %v", db.names())
	testx.AssertFalse(t, db.ran("COMMIT"), "statements %v", db.names())
	for _, n := range names {
		testx.AssertFalse(t, db.ran(n), "%s ran: %v", n, db.names())
	}
}

func TestPostgresRepository_PlaceRefusals(t *testing.T) {
	tests := []struct {
		name  string
		db    *fakeSQL
		in    PlaceInput
		check func(t *testing.T, err error)
		never []string
	}{
		{name: "a deleted account", db: placeDB().only("LockCheckoutUser", fakeAnswer{}), in: placeIn(""),
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrAccountGone)) },
			never: []string{"CountPendingOrders", "LockCheckoutVariants"}},
		{name: "an unverified email", in: placeIn(""),
			db:    func() *fakeSQL { d := placeDB(); d.answers["LockCheckoutUser"] = []fakeAnswer{rows(nil)}; return d }(),
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrEmailUnverified)) },
			never: []string{"LockCheckoutVariants"}},
		{name: "five unpaid orders", in: placeIn(""),
			db: func() *fakeSQL {
				d := placeDB()
				d.answers["CountPendingOrders"] = []fakeAnswer{rows(int64(MaxPendingOrders))}
				return d
			}(),
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrTooManyPendingOrders)) },
			never: []string{"LockCheckoutVariants"}},
		{name: "an unknown voucher", in: placeIn("NOPE"),
			db: func() *fakeSQL { d := placeDB(); d.answers["GetVoucherByCode"] = []fakeAnswer{{}}; return d }(),
			check: func(t *testing.T, err error) {
				var ve *VoucherError
				testx.AssertTrue(t, errors.As(err, &ve))
				testx.AssertEqual(t, *ve, VoucherError{Code: "NOPE", Reason: VoucherNotFound})
			},
			never: []string{"UseVoucher", "InsertOrder"}},
		{name: "the buyer used the voucher already", in: placeIn("HEMAT10"),
			db: func() *fakeSQL {
				d := placeDB()
				d.answers["CountVoucherUses"] = []fakeAnswer{rows(int64(1))}
				return d
			}(),
			check: func(t *testing.T, err error) {
				var ve *VoucherError
				testx.AssertTrue(t, errors.As(err, &ve))
				testx.AssertEqual(t, ve.Reason, VoucherPerUserLimit)
			},
			never: []string{"UseVoucher", "InsertOrder"}},
		{name: "another checkout took the last use", in: placeIn("HEMAT10"),
			db: placeDB().on("UseVoucher", fakeAnswer{affected: 0}),
			check: func(t *testing.T, err error) {
				var ve *VoucherError
				testx.AssertTrue(t, errors.As(err, &ve))
				testx.AssertEqual(t, ve.Reason, VoucherExhausted)
			},
			never: []string{"InsertOrder"}},
		{name: "the guarded decrement finds no stock", in: placeIn(""),
			db: placeDB().on("DecrementStock", fakeAnswer{affected: 0}),
			check: func(t *testing.T, err error) {
				var p *ProblemsError
				testx.AssertTrue(t, errors.As(err, &p), "err = %v", err)
				testx.AssertEqual(t, p.Lines[0].VariantID, v3)
				testx.AssertEqual(t, p.Lines[0].Problem, cart.ProblemInsufficientStock)
			},
			never: []string{"DeleteOrderedCartItems", "SaveIdempotencyResponse"}},
		{name: "the key was taken over meanwhile", in: placeIn(""),
			db:    placeDB().on("SaveIdempotencyResponse", fakeAnswer{affected: 0}),
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrIdempotencyInProgress)) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := place(t, tt.db, tt.in)
			testx.AssertError(t, err)
			tt.check(t, err)
			assertRolledBack(t, tt.db, tt.never...)
		})
	}
	t.Run("four unpaid orders are fine", func(t *testing.T) {
		db := placeDB()
		db.answers["CountPendingOrders"] = []fakeAnswer{rows(int64(MaxPendingOrders - 1))}
		_, err := place(t, db, placeIn(""))
		testx.AssertNoError(t, err)
	})
}

func TestPostgresRepository_PlaceErrors(t *testing.T) {
	tests := []struct {
		query string
		msg   string
	}{
		{"LockCheckoutUser", "lock buyer: boom"},
		{"CountPendingOrders", "count pending orders: boom"},
		{"LockCheckoutCart", "lock cart: boom"},
		{"ListCartLines", "read cart: boom"},
		{"LockCheckoutVariants", "lock variants: boom"},
		{"GetVoucherByCode", "query voucher: boom"},
		{"CountVoucherUses", "count voucher uses: boom"},
		{"UseVoucher", "use voucher: boom"},
		{"InsertOrder", "insert order: boom"},
		{"InsertOrderItem", "insert order item: boom"},
		{"DecrementStock", "decrement stock: boom"},
		{"DeleteOrderedCartItems", "clear ordered cart lines: boom"},
		{"GetOrderForUser", "read new order: boom"},
		{"ListOrderItems", "query order items: boom"},
		{"InsertOutboxEvent", "record order.created event: boom"},
		{"SaveIdempotencyResponse", "save idempotent response: boom"},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			db := placeDB()
			db.answers[tt.query] = []fakeAnswer{failWith(errBoom)}
			_, err := place(t, db, placeIn("HEMAT10"))
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertEqual(t, err.Error(), tt.msg)
			assertRolledBack(t, db)
		})
	}
}

// A taken order code is retried with a new one, a few times.
func TestPostgresRepository_PlaceRetriesTheOrderCode(t *testing.T) {
	db := placeDB().on("InsertOrder", fakeAnswer{affected: 0}).on("InsertOrder", fakeAnswer{affected: 0}).on("InsertOrder", fakeAnswer{affected: 1})
	_, err := place(t, db, placeIn(""))
	testx.AssertNoError(t, err)
	inserts := db.calledAll("InsertOrder")
	testx.AssertEqual(t, len(inserts), 3)
	testx.AssertNotEqual(t, inserts[0].args[1], inserts[1].args[1], "a new code each time")
	testx.AssertEqual(t, inserts[0].args[0], inserts[2].args[0], "the same order id")

	db = placeDB().on("InsertOrder", fakeAnswer{affected: 0})
	_, err = place(t, db, placeIn(""))
	testx.AssertError(t, err)
	testx.AssertEqual(t, err.Error(), "insert order: no free order code after 5 attempts")
	testx.AssertEqual(t, len(db.calledAll("InsertOrder")), maxCodeAttempts)
	assertRolledBack(t, db, "InsertOrderItem")
}

func TestNewOrderCode(t *testing.T) {
	pattern := regexp.MustCompile(`^GS-\d{8}-[0-9A-Z]{6}$`)
	tests := []struct {
		now  time.Time
		date string
	}{
		{now: time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC), date: "20261023"},
		{now: time.Date(2026, 10, 23, 16, 59, 59, 0, time.UTC), date: "20261023"},
		// 23:30 UTC is 06:30 the next morning in WIB.
		{now: time.Date(2026, 10, 23, 23, 30, 0, 0, time.UTC), date: "20261024"},
		{now: time.Date(2026, 10, 23, 17, 0, 0, 0, time.UTC), date: "20261024"},
		{now: time.Date(2026, 12, 31, 18, 0, 0, 0, time.UTC), date: "20270101"},
		{now: time.Date(2026, 10, 24, 6, 30, 0, 0, time.FixedZone("WIB", 7*3600)), date: "20261024"},
	}
	for _, tt := range tests {
		code, err := newOrderCode(tt.now)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, pattern.MatchString(code), "code %q", code)
		testx.AssertEqual(t, code[3:11], tt.date, "at %v", tt.now)
	}
	seen := map[string]bool{}
	for range 200 {
		code, _ := newOrderCode(testTime)
		testx.AssertFalse(t, strings.ContainsAny(code[12:], "ILOU"), "Crockford's alphabet: %q", code)
		seen[code] = true
	}
	testx.AssertTrue(t, len(seen) > 190, "random suffixes: only %d of 200 differ", len(seen))
}

// The cart is locked and read again inside the transaction: a checkout of
// a cart that changed since the quote (another checkout took its lines,
// another device edited it) is refused, so one cart never becomes two
// orders.
func TestPostgresRepository_PlaceLocksTheSameCart(t *testing.T) {
	a, b := line(v3, 1, 10000, 5), line(v1, 2, 50000, 5)
	t.Run("the same lines in another order", func(t *testing.T) {
		db := placeDB().only("ListCartLines", cartLines(b, a))
		_, err := place(t, db, placeIn(""))
		testx.AssertNoError(t, err)
	})
	t.Run("a new current price alone is for the locked rows to catch", func(t *testing.T) {
		repriced := b
		repriced.Price = 55000 // the price column of the cart read; the price seen is unchanged
		db := placeDB().only("ListCartLines", cartLines(a, repriced))
		_, err := place(t, db, placeIn(""))
		testx.AssertNoError(t, err)
	})
	changed := func(edit func(l *cart.Line)) cart.Line {
		l := b
		edit(&l)
		return l
	}
	tests := []struct {
		name string
		db   *fakeSQL
	}{
		{name: "a quantity changed", db: placeDB().only("ListCartLines", cartLines(a, changed(func(l *cart.Line) { l.Quantity = 3 })))},
		{name: "the price seen changed (saved again)", db: placeDB().only("ListCartLines", cartLines(a, changed(func(l *cart.Line) { l.AddedPrice = 55000 })))},
		{name: "a line was taken out (another checkout)", db: placeDB().only("ListCartLines", cartLines(a))},
		{name: "the cart is empty now", db: placeDB().only("ListCartLines", fakeAnswer{})},
		{name: "a line was added", db: placeDB().only("ListCartLines", cartLines(a, b, line(v2, 1, 1000, 5)))},
		{name: "another variant, same count", db: placeDB().only("ListCartLines", cartLines(a, changed(func(l *cart.Line) { l.VariantID = v2 })))},
		{name: "no cart at all (the account was deleted)", db: placeDB().only("LockCheckoutCart", fakeAnswer{})},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := place(t, tt.db, placeIn("HEMAT10"))
			testx.AssertTrue(t, errors.Is(err, ErrCartChanged), "err = %v", err)
			assertRolledBack(t, tt.db, "LockCheckoutVariants", "UseVoucher", "InsertOrder")
		})
	}
}
