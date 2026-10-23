package cart

// The JSON shapes of the contract (Cart and CartLine in api/openapi.yaml).
// They are exported so checkout can show the same lines in its answers.

// MoneyJSON is Money in the contract: whole rupiah plus the currency.
type MoneyJSON struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// Rupiah is amount as MoneyJSON.
func Rupiah(amount int64) MoneyJSON { return MoneyJSON{Amount: amount, Currency: "IDR"} }

// LineJSON is CartLine.
type LineJSON struct {
	VariantID      string    `json:"variant_id"`
	ProductID      string    `json:"product_id"`
	ProductSlug    string    `json:"product_slug"`
	ProductName    string    `json:"product_name"`
	VariantName    string    `json:"variant_name"`
	SKU            string    `json:"sku"`
	Quantity       int32     `json:"quantity"`
	UnitPrice      MoneyJSON `json:"unit_price"`
	PriceWhenAdded MoneyJSON `json:"price_when_added"`
	LineTotal      MoneyJSON `json:"line_total"`
	Stock          int32     `json:"stock"`
	WeightGrams    int32     `json:"weight_grams"`
	Problem        *string   `json:"problem"` // null when the line can be bought
}

// JSON is Cart.
type JSON struct {
	Lines     []LineJSON `json:"lines"`
	ItemCount int        `json:"item_count"`
	Subtotal  MoneyJSON  `json:"subtotal"`
}

// ToJSON turns c into its contract shape.
func ToJSON(c Cart) JSON {
	out := JSON{Lines: make([]LineJSON, 0, len(c.Lines)), ItemCount: c.ItemCount(), Subtotal: Rupiah(c.Subtotal())}
	for _, l := range c.Lines {
		line := LineJSON{
			VariantID: l.VariantID, ProductID: l.ProductID, ProductSlug: l.ProductSlug, ProductName: l.ProductName,
			VariantName: l.VariantName, SKU: l.SKU, Quantity: l.Quantity,
			UnitPrice: Rupiah(l.Price), PriceWhenAdded: Rupiah(l.AddedPrice), LineTotal: Rupiah(l.LineTotal()),
			Stock: l.Stock, WeightGrams: l.WeightGrams,
		}
		if p := l.Problem(); p != ProblemNone {
			s := string(p)
			line.Problem = &s
		}
		out.Lines = append(out.Lines, line)
	}
	return out
}
