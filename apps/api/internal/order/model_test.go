package order

import (
	"errors"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
)

const (
	buyerID   = "0190c8a0-0000-7000-8000-0000000000aa"
	orderID1  = "0190c8a0-0000-7000-8000-0000000000d1"
	addressID = "0190c8a0-0000-7000-8000-0000000000e1"
	voucherID = "0190c8a0-0000-7000-8000-0000000000f1"
	v1        = "0190c8a0-0000-7000-9000-000000000001"
	v2        = "0190c8a0-0000-7000-9000-000000000002"
	v3        = "0190c8a0-0000-7000-9000-000000000003"
)

var (
	errBoom = errors.New("boom")
	// testTime is "now" in these tests, and the creation time of rows.
	testTime = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
)

// line is a sellable cart line of quantity at price with stock on hand.
func line(variantID string, quantity int32, price int64, stock int32) cart.Line {
	return cart.Line{
		VariantID: variantID, SKU: "SKU-" + variantID[len(variantID)-1:], ProductID: "p", ProductSlug: "kaos",
		ProductName: "Kaos", VariantName: "M", Quantity: quantity, AddedPrice: price, Price: price,
		Stock: stock, WeightGrams: 250, Sellable: true,
	}
}

func TestValidateLines(t *testing.T) {
	t.Run("every line can be bought", func(t *testing.T) {
		testx.AssertNoError(t, validateLines([]cart.Line{line(v1, 2, 1000, 2), line(v2, 1, 500, 9)}))
		testx.AssertNoError(t, validateLines(nil))
	})

	unavailable := line(v1, 2, 1000, 7)
	unavailable.Sellable = false
	short := line(v2, 5, 2000, 3)
	repriced := line(v3, 1, 3000, 9)
	repriced.Price = 3500
	ok := line("0190c8a0-0000-7000-9000-000000000004", 1, 100, 1)

	err := validateLines([]cart.Line{unavailable, ok, short, repriced})
	var problems *ProblemsError
	if !errors.As(err, &problems) {
		t.Fatalf("want *ProblemsError, got %v", err)
	}
	testx.AssertEqual(t, err.Error(), "checkout problems")
	testx.AssertEqual(t, len(problems.Lines), 3, "only the lines with a problem, in cart order")
	testx.AssertEqual(t, problems.Lines[0], LineProblem{
		VariantID: v1, SKU: "SKU-1", Problem: cart.ProblemUnavailable, Quantity: 2,
		Available: 0, AddedPrice: 1000, Price: 1000,
	}, "an unavailable variant has 0 available, whatever its stock column says")
	testx.AssertEqual(t, problems.Lines[1], LineProblem{
		VariantID: v2, SKU: "SKU-2", Problem: cart.ProblemInsufficientStock, Quantity: 5,
		Available: 3, AddedPrice: 2000, Price: 2000,
	})
	testx.AssertEqual(t, problems.Lines[2], LineProblem{
		VariantID: v3, SKU: "SKU-3", Problem: cart.ProblemPriceChanged, Quantity: 1,
		Available: 9, AddedPrice: 3000, Price: 3500,
	}, "both prices, so the buyer sees the change")
}

// hemat10 is a voucher valid for October 2026: 10% from Rp100.000, at most
// Rp25.000, 1000 uses, once per buyer.
func hemat10() Voucher {
	return Voucher{
		ID: voucherID, Code: "HEMAT10", Kind: VoucherPercent, Value: 10, MinSpend: 100000, MaxDiscount: 25000,
		StartsAt: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), EndsAt: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC),
		UsageLimit: 1000, UsedCount: 10, PerUserLimit: 1,
	}
}
