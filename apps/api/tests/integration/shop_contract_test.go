//go:build integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"testing"
	"time"
)

// Contract checks for carts, checkout and orders. As for the catalog, the
// field names come from api/openapi.yaml (contractSchema), level by level;
// the checks add the types and the arithmetic the schemas state in prose.

// cartLineOut is CartLine.
type cartLineOut struct {
	VariantID      string   `json:"variant_id"`
	ProductID      string   `json:"product_id"`
	ProductSlug    string   `json:"product_slug"`
	ProductName    string   `json:"product_name"`
	VariantName    string   `json:"variant_name"`
	SKU            string   `json:"sku"`
	Quantity       int32    `json:"quantity"`
	UnitPrice      moneyOut `json:"unit_price"`
	PriceWhenAdded moneyOut `json:"price_when_added"`
	LineTotal      moneyOut `json:"line_total"`
	Stock          int32    `json:"stock"`
	WeightGrams    int32    `json:"weight_grams"`
	Problem        *string  `json:"problem"`
}

// cartOut is Cart, plus cart_token of a CartAddResult.
type cartOut struct {
	Lines     []cartLineOut `json:"lines"`
	ItemCount int           `json:"item_count"`
	Subtotal  moneyOut      `json:"subtotal"`
	// Token is cart_token (and the X-Cart-Token header) of the answer that
	// created a guest cart; empty otherwise.
	Token string `json:"-"`
}

// line returns the line of variantID, or fails.
func (c cartOut) line(t *testing.T, variantID string) cartLineOut {
	t.Helper()
	for _, l := range c.Lines {
		if l.VariantID == variantID {
			return l
		}
	}
	t.Fatalf("cart has no line for %s: %+v", variantID, c.Lines)
	return cartLineOut{}
}

// quantities maps variant ID to quantity.
func (c cartOut) quantities() map[string]int32 {
	out := map[string]int32{}
	for _, l := range c.Lines {
		out[l.VariantID] = l.Quantity
	}
	return out
}

var cartProblems = []string{"unavailable", "insufficient_stock", "price_changed"}

// assertCartLine checks one CartLine and its arithmetic.
func assertCartLine(t *testing.T, raw json.RawMessage, what string) cartLineOut {
	t.Helper()
	obj := object(t, raw, "CartLine", what)
	for _, m := range []string{"unit_price", "price_when_added", "line_total"} {
		assertMoney(t, obj[m], what+"."+m)
	}
	var l cartLineOut
	if err := json.Unmarshal(raw, &l); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if !uuidPattern.MatchString(l.VariantID) || !uuidPattern.MatchString(l.ProductID) || !slugPattern.MatchString(l.ProductSlug) {
		t.Errorf("%s: ids or slug break the contract: %+v", what, l)
	}
	if l.Quantity < 1 || l.Quantity > 99 || l.Stock < 0 || l.WeightGrams < 1 {
		t.Errorf("%s: quantity %d, stock %d or weight %d out of the contract's range", what, l.Quantity, l.Stock, l.WeightGrams)
	}
	if l.LineTotal.Amount != l.UnitPrice.Amount*int64(l.Quantity) {
		t.Errorf("%s: line_total %d, want unit_price %d × %d", what, l.LineTotal.Amount, l.UnitPrice.Amount, l.Quantity)
	}
	if l.Problem != nil && !slices.Contains(cartProblems, *l.Problem) {
		t.Errorf("%s: problem %q is not in the contract's enum", what, *l.Problem)
	}
	return l
}

// assertCartObject checks a Cart and its totals.
func assertCartObject(t *testing.T, raw json.RawMessage, what string) cartOut {
	t.Helper()
	obj := object(t, raw, "Cart", what)
	assertMoney(t, obj["subtotal"], what+".subtotal")
	var c cartOut
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	c.Lines = nil
	var subtotal int64
	items := 0
	for i, l := range array(t, obj["lines"], what+".lines") {
		cl := assertCartLine(t, l, what+".lines["+strconv.Itoa(i)+"]")
		c.Lines = append(c.Lines, cl)
		subtotal += cl.LineTotal.Amount
		items += int(cl.Quantity)
	}
	if len(c.Lines) > 50 {
		t.Errorf("%s: %d lines, the contract allows 50", what, len(c.Lines))
	}
	if c.Subtotal.Amount != subtotal || c.ItemCount != items {
		t.Errorf("%s: subtotal %d and item_count %d, want the lines' %d and %d", what, c.Subtotal.Amount, c.ItemCount, subtotal, items)
	}
	return c
}

// assertCart checks a 200 cart answer: CartDetail, or CartAddResult with
// the new guest cart's token in the body and in X-Cart-Token.
func assertCart(t *testing.T, resp response, what string) cartOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := decodeObject(t, resp.Body)
	schemaName := "CartDetail"
	if _, ok := top["cart_token"]; ok {
		schemaName = "CartAddResult"
	}
	assertMatchesSchema(t, top, contractSchema(t, schemaName), what)
	c := assertCartObject(t, top["data"], what+" data")
	if raw, ok := top["cart_token"]; ok {
		if err := json.Unmarshal(raw, &c.Token); err != nil || !emailTokenPattern.MatchString(c.Token) {
			t.Errorf("%s: cart_token %s, want an opaque token", what, raw)
		}
		if h := resp.Header.Get("X-Cart-Token"); h != c.Token {
			t.Errorf("%s: X-Cart-Token %q, want the body's cart_token %q", what, h, c.Token)
		}
	} else if h := resp.Header.Get("X-Cart-Token"); h != "" {
		t.Errorf("%s: X-Cart-Token %q on an answer that created no cart", what, h)
	}
	return c
}

// totalsOut is OrderTotals.
type totalsOut struct {
	Subtotal    moneyOut `json:"subtotal"`
	Discount    moneyOut `json:"discount"`
	ShippingFee moneyOut `json:"shipping_fee"`
	Total       moneyOut `json:"total"`
	WeightGrams int64    `json:"weight_grams"`
}

// assertTotals checks an OrderTotals and that it adds up.
func assertTotals(t *testing.T, raw json.RawMessage, what string) totalsOut {
	t.Helper()
	obj := object(t, raw, "OrderTotals", what)
	for _, m := range []string{"subtotal", "discount", "shipping_fee", "total"} {
		assertMoney(t, obj[m], what+"."+m)
	}
	var tot totalsOut
	if err := json.Unmarshal(raw, &tot); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if tot.Total.Amount != tot.Subtotal.Amount-tot.Discount.Amount+tot.ShippingFee.Amount ||
		tot.Discount.Amount > tot.Subtotal.Amount || tot.WeightGrams < 0 {
		t.Errorf("%s = %+v: want total = subtotal - discount + shipping_fee and discount <= subtotal", what, tot)
	}
	return tot
}

// quoteOut is ShippingQuote.
type quoteOut struct {
	Courier     string   `json:"courier"`
	CourierName string   `json:"courier_name"`
	Service     string   `json:"service"`
	ServiceName string   `json:"service_name"`
	Price       moneyOut `json:"price"`
	ETD         string   `json:"etd"`
}

var couriers = []string{"jne", "jnt", "sicepat"}

func assertQuote(t *testing.T, raw json.RawMessage, what string) quoteOut {
	t.Helper()
	obj := object(t, raw, "ShippingQuote", what)
	assertMoney(t, obj["price"], what+".price")
	var q quoteOut
	if err := json.Unmarshal(raw, &q); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if !slices.Contains(couriers, q.Courier) || q.Service == "" || q.CourierName == "" || q.ETD == "" {
		t.Errorf("%s = %+v breaks the contract", what, q)
	}
	return q
}

// quotesOut is ShippingQuotes.
type quotesOut struct {
	WeightGrams int64
	Quotes      []quoteOut
}

// assertQuotes checks a 200 GET /v1/checkout/shipping-quotes: cheapest
// first.
func assertQuotes(t *testing.T, resp response) quotesOut {
	t.Helper()
	what := "GET /v1/checkout/shipping-quotes"
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "ShippingQuotesDetail", what)
	data := object(t, top["data"], "ShippingQuotes", what+" data")
	var out quotesOut
	if err := json.Unmarshal(data["weight_grams"], &out.WeightGrams); err != nil {
		t.Fatalf("%s: weight_grams %s", what, data["weight_grams"])
	}
	prices := []int64{}
	for i, raw := range array(t, data["quotes"], what+" quotes") {
		q := assertQuote(t, raw, what+" quotes["+strconv.Itoa(i)+"]")
		out.Quotes = append(out.Quotes, q)
		prices = append(prices, q.Price.Amount)
	}
	if !slices.IsSorted(prices) {
		t.Errorf("%s: prices %v are not cheapest first", what, prices)
	}
	return out
}

// previewOut is CheckoutPreview.
type previewOut struct {
	Lines    []cartLineOut
	Totals   totalsOut
	Shipping *quoteOut
	Voucher  *appliedVoucherOut
}

// appliedVoucherOut is AppliedVoucher.
type appliedVoucherOut struct {
	Code        string    `json:"code"`
	Kind        string    `json:"kind"`
	Value       int64     `json:"value"`
	MaxDiscount *moneyOut `json:"max_discount"`
}

// assertPreview checks a 200 POST /v1/checkout/preview, including that the
// totals match its lines and quote.
func assertPreview(t *testing.T, resp response) previewOut {
	t.Helper()
	what := "POST /v1/checkout/preview"
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "CheckoutPreviewDetail", what)
	data := object(t, top["data"], "CheckoutPreview", what+" data")
	var p previewOut
	var subtotal, weight int64
	for i, raw := range array(t, data["lines"], what+" lines") {
		l := assertCartLine(t, raw, what+" lines["+strconv.Itoa(i)+"]")
		p.Lines = append(p.Lines, l)
		subtotal += l.LineTotal.Amount
		weight += int64(l.WeightGrams) * int64(l.Quantity)
	}
	p.Totals = assertTotals(t, data["totals"], what+" totals")
	if p.Totals.Subtotal.Amount != subtotal || p.Totals.WeightGrams != weight {
		t.Errorf("%s: totals %+v, want subtotal %d and weight %d from the lines", what, p.Totals, subtotal, weight)
	}
	if raw, ok := data["shipping"]; ok && string(raw) != "null" {
		q := assertQuote(t, raw, what+" shipping")
		p.Shipping = &q
		if p.Totals.ShippingFee.Amount != q.Price.Amount {
			t.Errorf("%s: shipping_fee %d, want the quote's %d", what, p.Totals.ShippingFee.Amount, q.Price.Amount)
		}
	} else if p.Totals.ShippingFee.Amount != 0 {
		t.Errorf("%s: shipping_fee %d without a chosen service", what, p.Totals.ShippingFee.Amount)
	}
	if raw, ok := data["voucher"]; ok && string(raw) != "null" {
		obj := object(t, raw, "AppliedVoucher", what+" voucher")
		if string(obj["max_discount"]) != "null" {
			assertMoney(t, obj["max_discount"], what+" voucher.max_discount")
		}
		var v appliedVoucherOut
		if err := json.Unmarshal(raw, &v); err != nil {
			t.Fatal(err)
		}
		p.Voucher = &v
	} else if p.Totals.Discount.Amount != 0 {
		t.Errorf("%s: discount %d without a voucher", what, p.Totals.Discount.Amount)
	}
	return p
}

// orderItemOut is OrderItem.
type orderItemOut struct {
	ID          string   `json:"id"`
	VariantID   string   `json:"variant_id"`
	ProductName string   `json:"product_name"`
	VariantName string   `json:"variant_name"`
	SKU         string   `json:"sku"`
	UnitPrice   moneyOut `json:"unit_price"`
	Quantity    int32    `json:"quantity"`
	LineTotal   moneyOut `json:"line_total"`
}

// orderOut is Order.
type orderOut struct {
	ID           string         `json:"id"`
	Code         string         `json:"code"`
	Status       string         `json:"status"`
	CancelReason *string        `json:"cancel_reason"`
	Items        []orderItemOut `json:"items"`
	Totals       totalsOut      `json:"totals"`
	VoucherCode  *string        `json:"voucher_code"`
	Shipping     struct {
		Courier        string  `json:"courier"`
		Service        string  `json:"service"`
		TrackingNumber *string `json:"tracking_number"`
		Address        struct {
			RecipientName string `json:"recipient_name"`
			Phone         string `json:"phone"`
			Street        string `json:"street"`
			City          string `json:"city"`
			Province      string `json:"province"`
			PostalCode    string `json:"postal_code"`
		} `json:"address"`
	} `json:"shipping"`
	LatestPayment    *latestPaymentOut `json:"latest_payment"`
	PaymentExpiresAt time.Time         `json:"payment_expires_at"`
	PaidAt           *time.Time        `json:"paid_at"`
	ShippedAt        *time.Time        `json:"shipped_at"`
	CompletedAt      *time.Time        `json:"completed_at"`
	CancelledAt      *time.Time        `json:"cancelled_at"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

var (
	orderStatuses = []string{"pending_payment", "paid", "processing", "shipped", "completed", "cancelled"}
	cancelReasons = []string{"payment_expired", "buyer_cancelled", "seller_cancelled"}
	orderCode     = regexp.MustCompile(`^GS-[0-9]{8}-[0-9A-Z]{6}$`)
)

// latestPaymentOut is OrderLatestPayment (Bab 11): the order's newest
// payment, null until the buyer first starts paying.
type latestPaymentOut struct {
	Status    string    `json:"status"`
	ExpiresAt time.Time `json:"expires_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// paymentStatuses are OrderLatestPayment.status's enum.
var paymentStatuses = []string{"pending", "challenge", "paid", "denied", "cancelled", "failed", "expired", "refunded", "partially_refunded"}

// assertNullableTime checks a [string, null] date-time.
func assertNullableTime(t *testing.T, raw json.RawMessage, what string) {
	t.Helper()
	if string(raw) != "null" {
		assertTimestamp(t, raw, what)
	}
}

// assertOrder checks an Order level by level, its arithmetic, and that each
// status carries the timestamps the schema's CHECKs promise.
func assertOrder(t *testing.T, raw json.RawMessage, what string) orderOut {
	t.Helper()
	obj := object(t, raw, "Order", what)
	totals := assertTotals(t, obj["totals"], what+".totals")
	ship := object(t, obj["shipping"], "OrderShipping", what+".shipping")
	object(t, ship["address"], "ShippingAddressSnapshot", what+".shipping.address")
	assertTimestamp(t, obj["payment_expires_at"], what+".payment_expires_at")
	assertTimestamp(t, obj["created_at"], what+".created_at")
	assertTimestamp(t, obj["updated_at"], what+".updated_at")
	for _, k := range []string{"paid_at", "shipped_at", "completed_at", "cancelled_at"} {
		assertNullableTime(t, obj[k], what+"."+k)
	}
	if raw := obj["latest_payment"]; raw != nil && string(raw) != "null" {
		lp := object(t, raw, "OrderLatestPayment", what+".latest_payment")
		assertTimestamp(t, lp["expires_at"], what+".latest_payment.expires_at")
		assertTimestamp(t, lp["updated_at"], what+".latest_payment.updated_at")
		var status string
		if err := json.Unmarshal(lp["status"], &status); err != nil || !slices.Contains(paymentStatuses, status) {
			t.Errorf("%s.latest_payment.status = %s, want one of %v", what, lp["status"], paymentStatuses)
		}
	}
	var subtotal int64
	for i, it := range array(t, obj["items"], what+".items") {
		iw := what + ".items[" + strconv.Itoa(i) + "]"
		io := object(t, it, "OrderItem", iw)
		assertMoney(t, io["unit_price"], iw+".unit_price")
		assertMoney(t, io["line_total"], iw+".line_total")
	}
	var o orderOut
	if err := json.Unmarshal(raw, &o); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	for _, it := range o.Items {
		if it.LineTotal.Amount != it.UnitPrice.Amount*int64(it.Quantity) || it.Quantity < 1 || !uuidPattern.MatchString(it.ID) {
			t.Errorf("%s: item %+v breaks the contract", what, it)
		}
		subtotal += it.LineTotal.Amount
	}
	if totals.Subtotal.Amount != subtotal {
		t.Errorf("%s: subtotal %d, want the items' %d", what, totals.Subtotal.Amount, subtotal)
	}
	if !uuidPattern.MatchString(o.ID) || !orderCode.MatchString(o.Code) || !slices.Contains(orderStatuses, o.Status) ||
		!slices.Contains(couriers, o.Shipping.Courier) {
		t.Errorf("%s: id %q, code %q, status %q or courier %q break the contract", what, o.ID, o.Code, o.Status, o.Shipping.Courier)
	}
	cancelled := o.Status == "cancelled"
	if cancelled != (o.CancelReason != nil) || cancelled != (o.CancelledAt != nil) ||
		(o.CancelReason != nil && !slices.Contains(cancelReasons, *o.CancelReason)) {
		t.Errorf("%s: status %s with cancel_reason %v and cancelled_at %v", what, o.Status, o.CancelReason, o.CancelledAt)
	}
	if slices.Contains([]string{"shipped", "completed"}, o.Status) && (o.ShippedAt == nil || o.Shipping.TrackingNumber == nil) {
		t.Errorf("%s: a %s order without shipped_at or tracking_number", what, o.Status)
	}
	if o.Status == "completed" && o.CompletedAt == nil {
		t.Errorf("%s: a completed order without completed_at", what)
	}
	if (o.VoucherCode == nil) && totals.Discount.Amount != 0 {
		t.Errorf("%s: discount %d without a voucher_code", what, totals.Discount.Amount)
	}
	return o
}

// assertOrderDetail checks an OrderDetail answer with status.
func assertOrderDetail(t *testing.T, resp response, status int, what string) orderOut {
	t.Helper()
	if resp.Status != status {
		t.Fatalf("%s = %d, want %d: %s", what, resp.Status, status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "OrderDetail", what)
	return assertOrder(t, top["data"], what+" data")
}

// orderSummaryOut is OrderSummary.
type orderSummaryOut struct {
	ID     string   `json:"id"`
	Code   string   `json:"code"`
	Status string   `json:"status"`
	Total  moneyOut `json:"total"`
}

// assertOrderList checks a 200 OrderList and returns its orders and
// next_cursor ("" on the last page).
func assertOrderList(t *testing.T, resp response, what string) ([]orderSummaryOut, string) {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200: %s", what, resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "OrderList", what)
	page := object(t, top["page"], "PageInfo", what+" page")
	var out []orderSummaryOut
	for i, raw := range array(t, top["data"], what+" data") {
		iw := what + " data[" + strconv.Itoa(i) + "]"
		obj := object(t, raw, "OrderSummary", iw)
		assertMoney(t, obj["total"], iw+".total")
		for _, k := range []string{"payment_expires_at", "created_at", "updated_at"} {
			assertTimestamp(t, obj[k], iw+"."+k)
		}
		var s orderSummaryOut
		if err := json.Unmarshal(raw, &s); err != nil {
			t.Fatal(err)
		}
		if !orderCode.MatchString(s.Code) || !slices.Contains(orderStatuses, s.Status) {
			t.Errorf("%s = %+v breaks the contract", iw, s)
		}
		out = append(out, s)
	}
	var cursor *string
	if err := json.Unmarshal(page["next_cursor"], &cursor); err != nil {
		t.Fatalf("%s: page.next_cursor = %s", what, page["next_cursor"])
	}
	if cursor == nil {
		return out, ""
	}
	if *cursor == "" {
		t.Errorf("%s: next_cursor is an empty string; the last page has null", what)
	}
	return out, *cursor
}

// problemOut is CheckoutProblem.
type problemOut struct {
	VariantID      string   `json:"variant_id"`
	SKU            string   `json:"sku"`
	Problem        string   `json:"problem"`
	Quantity       int32    `json:"quantity"`
	Available      int32    `json:"available"`
	UnitPrice      moneyOut `json:"unit_price"`
	PriceWhenAdded moneyOut `json:"price_when_added"`
}

// assertCheckoutProblems checks a 409 CHECKOUT_PROBLEMS body against
// CheckoutProblemsError and returns its lines.
func assertCheckoutProblems(t *testing.T, resp response, what string) []problemOut {
	t.Helper()
	details := assertError(t, resp, http.StatusConflict, "CHECKOUT_PROBLEMS")
	top := object(t, resp.Body, "CheckoutProblemsError", what)
	inner := decodeObject(t, top["error"])
	d := decodeObject(t, inner["details"])
	if len(details) != 1 {
		t.Errorf("%s: details %v, want only lines", what, details)
	}
	var out []problemOut
	for i, raw := range array(t, d["lines"], what+" details.lines") {
		lw := what + " details.lines[" + strconv.Itoa(i) + "]"
		obj := object(t, raw, "CheckoutProblem", lw)
		assertMoney(t, obj["unit_price"], lw+".unit_price")
		assertMoney(t, obj["price_when_added"], lw+".price_when_added")
		var p problemOut
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatal(err)
		}
		if !slices.Contains(cartProblems, p.Problem) || p.Available < 0 {
			t.Errorf("%s = %+v breaks the contract", lw, p)
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		t.Errorf("%s: CHECKOUT_PROBLEMS without a line", what)
	}
	return out
}
