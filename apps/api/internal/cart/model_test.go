package cart

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/santekno/sdk/testx"
)

const (
	userID = "0190c8a0-0000-7000-8000-0000000000aa"
	v1     = "0190c8a0-0000-7000-9000-000000000001"
	v2     = "0190c8a0-0000-7000-9000-000000000002"
	v3     = "0190c8a0-0000-7000-9000-000000000003"
)

var errBoom = errors.New("boom")

// okLine is a sellable line of quantity at price, with stock on hand, that
// was added at the same price.
func okLine(variantID string, quantity int32, price int64, stock int32) Line {
	return Line{
		VariantID: variantID, SKU: "SKU-" + variantID[len(variantID)-1:], Quantity: quantity,
		AddedPrice: price, Price: price, Stock: stock, WeightGrams: 200, Sellable: true,
	}
}

func TestOwner_IsGuest(t *testing.T) {
	testx.AssertTrue(t, Owner{}.IsGuest())
	testx.AssertTrue(t, Owner{Token: "x"}.IsGuest(), "a token alone is a guest")
	testx.AssertFalse(t, Owner{UserID: userID}.IsGuest())
	testx.AssertFalse(t, Owner{UserID: userID, Token: "x"}.IsGuest(), "a user wins over a token")
}

// Problem checks unavailable, then stock, then price: a line can have
// several problems, and the buyer is told about the one to fix first.
func TestLine_Problem(t *testing.T) {
	tests := []struct {
		name string
		edit func(l *Line)
		want Problem
	}{
		{name: "nothing wrong", edit: func(*Line) {}, want: ProblemNone},
		{name: "not sellable", edit: func(l *Line) { l.Sellable = false }, want: ProblemUnavailable},
		{name: "stock below quantity", edit: func(l *Line) { l.Stock = 1 }, want: ProblemInsufficientStock},
		{name: "stock equal to quantity is fine", edit: func(l *Line) { l.Stock = 2 }, want: ProblemNone},
		{name: "sold out", edit: func(l *Line) { l.Stock = 0 }, want: ProblemInsufficientStock},
		{name: "price went up", edit: func(l *Line) { l.Price = 60000 }, want: ProblemPriceChanged},
		{name: "price went down", edit: func(l *Line) { l.Price = 40000 }, want: ProblemPriceChanged},
		{name: "unavailable beats stock and price", edit: func(l *Line) { l.Sellable, l.Stock, l.Price = false, 0, 1 }, want: ProblemUnavailable},
		{name: "stock beats price", edit: func(l *Line) { l.Stock, l.Price = 0, 1 }, want: ProblemInsufficientStock},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := okLine(v1, 2, 50000, 10)
			tt.edit(&l)
			testx.AssertEqual(t, l.Problem(), tt.want)
		})
	}
}

func TestCart_Totals(t *testing.T) {
	t.Run("empty cart", func(t *testing.T) {
		testx.AssertEqual(t, Cart{}.Subtotal(), int64(0))
		testx.AssertEqual(t, Cart{}.ItemCount(), 0)
	})
	t.Run("at today's price, not the added one", func(t *testing.T) {
		a := okLine(v1, 2, 89000, 10)
		a.AddedPrice = 79000
		c := Cart{Lines: []Line{a, okLine(v2, 3, 15000, 10)}}
		testx.AssertEqual(t, a.LineTotal(), int64(178000))
		testx.AssertEqual(t, c.Subtotal(), int64(178000+45000))
		testx.AssertEqual(t, c.ItemCount(), 5, "units, not lines")
	})
	t.Run("the largest cart does not overflow", func(t *testing.T) {
		lines := make([]Line, MaxLines)
		for i := range lines {
			lines[i] = okLine(v1, MaxQuantity, 1_000_000_000, MaxQuantity)
		}
		c := Cart{Lines: lines}
		testx.AssertEqual(t, c.Subtotal(), int64(MaxLines)*MaxQuantity*1_000_000_000)
		testx.AssertEqual(t, c.ItemCount(), MaxLines*MaxQuantity)
	})
}

func TestToJSON(t *testing.T) {
	good := okLine(v1, 2, 89000, 10)
	good.ProductID, good.ProductSlug, good.ProductName, good.VariantName = "p1", "kaos", "Kaos", "M"
	changed := okLine(v2, 1, 60000, 5)
	changed.AddedPrice = 50000

	out := ToJSON(Cart{Lines: []Line{good, changed}})

	testx.AssertEqual(t, out.ItemCount, 3)
	testx.AssertEqual(t, out.Subtotal, MoneyJSON{Amount: 238000, Currency: "IDR"})
	testx.AssertEqual(t, len(out.Lines), 2)
	g := out.Lines[0]
	testx.AssertEqual(t, g.VariantID, v1)
	testx.AssertEqual(t, g.ProductID, "p1")
	testx.AssertEqual(t, g.ProductSlug, "kaos")
	testx.AssertEqual(t, g.ProductName, "Kaos")
	testx.AssertEqual(t, g.VariantName, "M")
	testx.AssertEqual(t, g.SKU, good.SKU)
	testx.AssertEqual(t, g.Quantity, int32(2))
	testx.AssertEqual(t, g.UnitPrice, Rupiah(89000))
	testx.AssertEqual(t, g.PriceWhenAdded, Rupiah(89000))
	testx.AssertEqual(t, g.LineTotal, Rupiah(178000))
	testx.AssertEqual(t, g.Stock, int32(10))
	testx.AssertEqual(t, g.WeightGrams, int32(200))
	testx.AssertTrue(t, g.Problem == nil, "a good line has problem null")
	c := out.Lines[1]
	testx.AssertEqual(t, c.UnitPrice, Rupiah(60000), "today's price")
	testx.AssertEqual(t, c.PriceWhenAdded, Rupiah(50000), "the price the buyer saw")
	if c.Problem == nil {
		t.Fatal("a changed price is a problem")
	}
	testx.AssertEqual(t, *c.Problem, "price_changed")

	// An empty cart is [] in JSON, never null.
	b, err := json.Marshal(ToJSON(Cart{}))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, string(b), `{"lines":[],"item_count":0,"subtotal":{"amount":0,"currency":"IDR"}}`)
}

func TestInsufficientStockError(t *testing.T) {
	var err error = &InsufficientStockError{Available: 3}
	testx.AssertEqual(t, err.Error(), "insufficient stock")
	var target *InsufficientStockError
	testx.AssertTrue(t, errors.As(err, &target))
	testx.AssertEqual(t, target.Available, int32(3))
}
