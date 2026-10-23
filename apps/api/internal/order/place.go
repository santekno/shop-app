package order

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// PlaceInput is everything checkout decided before its transaction: the
// cart lines as the buyer saw them, the address to copy, the shipping
// quote (asked for outside the transaction, so a slow courier API never
// holds a lock) and the voucher code.
type PlaceInput struct {
	UserID      string
	Lines       []cart.Line
	Address     ShippingAddress
	Shipping    shipping.Quote
	WeightGrams int64 // what Shipping was quoted for
	VoucherCode string
	Now         time.Time
	PaymentTTL  time.Duration
}

// Place creates the order in one transaction (ADR 0006):
//
//  1. lock the buyer's users row (ADR 0005's users-first order), refuse a
//     deleted account, an unverified email and too many unpaid orders;
//  2. lock the buyer's cart and read it again: its lines must be the ones
//     the shipping quote was made for (ErrCartChanged otherwise), which is
//     what stops one cart from becoming two orders;
//  3. lock the variants in id order and re-validate every line on the
//     locked rows: sellable, in stock, at the price the buyer saw;
//  4. check and count the voucher with its guarded UPDATE;
//  5. insert the order and its line snapshots, decrement the stock with the
//     guarded UPDATE, and take the lines out of the cart.
//
// Any error rolls everything back. It returns the new order's ID.
func (r *PostgresRepository) Place(ctx context.Context, in PlaceInput) (string, error) {
	var orderID string
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if err := lockBuyer(ctx, q, in.UserID); err != nil {
			return err
		}
		if err := lockSameCart(ctx, q, in.UserID, in.Lines); err != nil {
			return err
		}
		lines, err := lockLines(ctx, q, in.Lines)
		if err != nil {
			return err
		}
		// The goods' weight and subtotal do not depend on the discount, so
		// they are checked before the voucher, and the totals computed
		// once, after it.
		goods := CalculateTotals(TotalsInput{Lines: totalsLines(lines)})
		if goods.WeightGrams != in.WeightGrams {
			return ErrCartChanged
		}
		input := TotalsInput{Lines: totalsLines(lines), ShippingFee: in.Shipping.Price}
		var voucher *Voucher
		if in.VoucherCode != "" {
			v, err := useVoucher(ctx, q, in.UserID, in.VoucherCode, goods.Subtotal, in.Now)
			if err != nil {
				return err
			}
			voucher, input.Discount = &v, v.discount()
		}
		orderID, err = insertOrder(ctx, q, in, CalculateTotals(input), voucher)
		if err != nil {
			return err
		}
		return insertItems(ctx, q, in.UserID, orderID, lines, in.Now)
	})
	return orderID, err
}

// lockBuyer takes the users-first lock and applies the buyer's rules.
func lockBuyer(ctx context.Context, q *sqlc.Queries, userID string) error {
	verifiedAt, err := q.LockCheckoutUser(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrAccountGone
	}
	if err != nil {
		return fmt.Errorf("lock buyer: %w", err)
	}
	if !verifiedAt.Valid {
		return ErrEmailUnverified
	}
	pending, err := q.CountPendingOrders(ctx, userID)
	if err != nil {
		return fmt.Errorf("count pending orders: %w", err)
	}
	if pending >= MaxPendingOrders {
		return ErrTooManyPendingOrders
	}
	return nil
}

// lockSameCart locks the buyer's cart and returns ErrCartChanged unless it
// still holds exactly lines: the same variants, quantities and prices the
// buyer saw. A cart that is gone (an account deletion) or changed (another
// checkout took the lines, the buyer edited it on another device) is
// refused rather than ordered from a stale read.
func lockSameCart(ctx context.Context, q *sqlc.Queries, userID string, lines []cart.Line) error {
	cartID, err := q.LockCheckoutCart(ctx, &userID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCartChanged
	}
	if err != nil {
		return fmt.Errorf("lock cart: %w", err)
	}
	current, err := q.ListCartLines(ctx, cartID)
	if err != nil {
		return fmt.Errorf("read cart: %w", err)
	}
	if len(current) != len(lines) {
		return ErrCartChanged
	}
	type line struct {
		quantity int32
		price    int64
	}
	want := make(map[string]line, len(lines))
	for _, l := range lines {
		want[l.VariantID] = line{l.Quantity, l.AddedPrice}
	}
	for _, c := range current {
		if want[c.VariantID] != (line{c.Quantity, c.AddedPrice}) {
			return ErrCartChanged
		}
	}
	return nil
}

// lockLines locks the variants of lines in id order and returns the lines
// with the locked rows' data, after the same validation as the preview.
func lockLines(ctx context.Context, q *sqlc.Queries, lines []cart.Line) ([]cart.Line, error) {
	ids := make([]string, 0, len(lines))
	for _, l := range lines {
		ids = append(ids, l.VariantID)
	}
	slices.Sort(ids) // the query sorts too; this documents the lock order
	rows, err := q.LockCheckoutVariants(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("lock variants: %w", err)
	}
	locked := make(map[string]sqlc.LockCheckoutVariantsRow, len(rows))
	for _, row := range rows {
		locked[row.ID] = row
	}
	out := make([]cart.Line, 0, len(lines))
	for _, l := range lines {
		row, ok := locked[l.VariantID]
		if !ok {
			// Cannot happen while variants are never deleted; treat it
			// as unavailable rather than fail.
			l.Sellable = false
		} else {
			l.SKU, l.VariantName, l.Price, l.Stock = row.Sku, row.Name, row.Price, row.Stock
			l.WeightGrams, l.Sellable = row.WeightGrams, row.Sellable
			l.ProductID, l.ProductSlug, l.ProductName = row.ProductID, row.ProductSlug, row.ProductName
		}
		out = append(out, l)
	}
	if err := validateLines(out); err != nil {
		return nil, err
	}
	return out, nil
}

// useVoucher checks the voucher for this buyer and subtotal, then counts
// the use with the guarded UPDATE, which is what makes the total limit
// race-safe. The per-user count is safe because the buyer's row is locked.
func useVoucher(ctx context.Context, q *sqlc.Queries, userID, code string, subtotal int64, now time.Time) (Voucher, error) {
	v, err := voucherByCode(ctx, q, code)
	if err != nil {
		return Voucher{}, err
	}
	uses, err := q.CountVoucherUses(ctx, sqlc.CountVoucherUsesParams{VoucherID: &v.ID, UserID: userID})
	if err != nil {
		return Voucher{}, fmt.Errorf("count voucher uses: %w", err)
	}
	if err := v.check(now, subtotal, uses); err != nil {
		return Voucher{}, err
	}
	n, err := q.UseVoucher(ctx, sqlc.UseVoucherParams{ID: v.ID, Now: now})
	if err != nil {
		return Voucher{}, fmt.Errorf("use voucher: %w", err)
	}
	if n == 0 {
		// Another checkout took the last use after the check above read
		// the row.
		return Voucher{}, &VoucherError{Code: v.Code, Reason: VoucherExhausted}
	}
	return v, nil
}

// maxCodeAttempts bounds the retries on a taken order code. With 32^6
// codes per day a second attempt is already rare.
const maxCodeAttempts = 5

// insertOrder inserts the order with a fresh random code and returns its
// ID.
func insertOrder(ctx context.Context, q *sqlc.Queries, in PlaceInput, t Totals, v *Voucher) (string, error) {
	p := sqlc.InsertOrderParams{
		ID: uuidx.NewV7(), UserID: in.UserID,
		Subtotal: t.Subtotal, Discount: t.Discount, ShippingFee: t.ShippingFee, Total: t.Total,
		TotalWeightGrams: int32(t.WeightGrams), // #nosec G115 -- at most 50 lines × 99 units × 100 kg
		Courier:          string(in.Shipping.Courier), CourierService: in.Shipping.Service,
		ShippingRecipient: in.Address.Recipient, ShippingPhone: in.Address.Phone,
		ShippingStreet: in.Address.Street, ShippingCity: in.Address.City,
		ShippingProvince: in.Address.Province, ShippingPostalCode: in.Address.PostalCode,
		PaymentExpiresAt: in.Now.Add(in.PaymentTTL), Now: in.Now,
	}
	if v != nil {
		p.VoucherID, p.VoucherCode = &v.ID, sql.NullString{String: v.Code, Valid: true}
	}
	for range maxCodeAttempts {
		code, err := newOrderCode(in.Now)
		if err != nil {
			return "", err
		}
		p.Code = code
		n, err := q.InsertOrder(ctx, p)
		if err != nil {
			return "", fmt.Errorf("insert order: %w", err)
		}
		if n == 1 {
			return p.ID, nil
		}
	}
	return "", fmt.Errorf("insert order: no free order code after %d attempts", maxCodeAttempts)
}

// insertItems stores the line snapshots, takes the stock with the guarded
// decrement, and removes the ordered lines from the buyer's cart.
func insertItems(ctx context.Context, q *sqlc.Queries, userID, orderID string, lines []cart.Line, now time.Time) error {
	ids := make([]string, 0, len(lines))
	for _, l := range lines {
		err := q.InsertOrderItem(ctx, sqlc.InsertOrderItemParams{
			ID: uuidx.NewV7(), OrderID: orderID, VariantID: l.VariantID,
			ProductName: l.ProductName, VariantName: l.VariantName, Sku: l.SKU,
			UnitPrice: l.Price, Quantity: l.Quantity, LineTotal: l.LineTotal(), Now: now,
		})
		if err != nil {
			return fmt.Errorf("insert order item: %w", err)
		}
		n, err := q.DecrementStock(ctx, sqlc.DecrementStockParams{ID: l.VariantID, Quantity: l.Quantity})
		if err != nil {
			return fmt.Errorf("decrement stock: %w", err)
		}
		if n == 0 {
			// The rows are locked and were validated, so this is the
			// guard catching a bug, not a race.
			return &ProblemsError{Lines: []LineProblem{{
				VariantID: l.VariantID, SKU: l.SKU, Problem: cart.ProblemInsufficientStock,
				Quantity: l.Quantity, Available: l.Stock, AddedPrice: l.AddedPrice, Price: l.Price,
			}}}
		}
		ids = append(ids, l.VariantID)
	}
	if err := q.DeleteOrderedCartItems(ctx, sqlc.DeleteOrderedCartItemsParams{UserID: &userID, VariantIds: ids}); err != nil {
		return fmt.Errorf("clear ordered cart lines: %w", err)
	}
	return nil
}

// orderCodeAlphabet is Crockford's base32: digits and capitals without I,
// L, O and U, so a code read aloud or copied by hand stays unambiguous.
const orderCodeAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// wib is Western Indonesia Time, the date in an order code. A fixed zone,
// so the binary needs no time zone database.
var wib = time.FixedZone("WIB", 7*60*60)

// newOrderCode returns GS-YYYYMMDD-XXXXXX for now's date in WIB, with six
// random characters.
func newOrderCode(now time.Time) (string, error) {
	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("random order code: %w", err)
	}
	suffix := make([]byte, len(random))
	for i, b := range random {
		suffix[i] = orderCodeAlphabet[int(b)%len(orderCodeAlphabet)] // 256 is a multiple of 32: no bias
	}
	return "GS-" + now.In(wib).Format("20060102") + "-" + string(suffix), nil
}
