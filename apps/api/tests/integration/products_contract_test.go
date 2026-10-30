//go:build integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Contract checks for the product endpoints. Field names come from
// api/openapi.yaml through contractSchema; the checks below add the types
// and the rules the schemas state in prose.

type moneyOut struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

type variantOut struct {
	ID    string   `json:"id"`
	SKU   string   `json:"sku"`
	Name  string   `json:"name"`
	Price moneyOut `json:"price"`
	Stock int32    `json:"stock"`
}

type productOut struct {
	ID          string         `json:"id"`
	Slug        string         `json:"slug"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Category    listedCategory `json:"category"`
	PriceFrom   moneyOut       `json:"price_from"`
	InStock     bool           `json:"in_stock"`
	Variants    []variantOut   `json:"variants"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type adminVariantOut struct {
	ID          string   `json:"id"`
	SKU         string   `json:"sku"`
	Name        string   `json:"name"`
	Price       moneyOut `json:"price"`
	Stock       int32    `json:"stock"`
	WeightGrams int32    `json:"weight_grams"`
	Version     int32    `json:"version"`
}

type adminProductOut struct {
	ID          string            `json:"id"`
	CategoryID  string            `json:"category_id"`
	Slug        string            `json:"slug"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Status      string            `json:"status"`
	PriceFrom   *moneyOut         `json:"price_from"`
	Version     int32             `json:"version"`
	Variants    []adminVariantOut `json:"variants"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
}

// object decodes raw as a JSON object that matches the named schema.
func object(t *testing.T, raw json.RawMessage, schemaName, what string) map[string]json.RawMessage {
	t.Helper()
	obj := decodeObject(t, raw)
	assertMatchesSchema(t, obj, contractSchema(t, schemaName), what)
	return obj
}

// array decodes raw as a JSON array.
func array(t *testing.T, raw json.RawMessage, what string) []json.RawMessage {
	t.Helper()
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		t.Fatalf("%s is not an array: %s", what, raw)
	}
	return items
}

func assertMoney(t *testing.T, raw json.RawMessage, what string) {
	t.Helper()
	obj := object(t, raw, "Money", what)
	var m moneyOut
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if m.Currency != "IDR" || m.Amount < 0 || string(obj["amount"]) != strconv.FormatInt(m.Amount, 10) {
		t.Errorf("%s = %s, want a whole, non-negative amount in IDR", what, raw)
	}
}

func assertTimestamp(t *testing.T, raw json.RawMessage, what string) {
	t.Helper()
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("%s = %s, want a string", what, raw)
	}
	if _, err := time.Parse(time.RFC3339, s); err != nil {
		t.Errorf("%s = %q, want an RFC 3339 date-time", what, s)
	}
}

// assertProduct checks one Product and the rules around it: price_from is
// the cheapest variant, in_stock is "some variant has stock", variants come
// cheapest first and there is at least one.
func assertProduct(t *testing.T, raw json.RawMessage, what string) productOut {
	t.Helper()
	obj := object(t, raw, "Product", what)
	object(t, obj["category"], "Category", what+".category")
	assertMoney(t, obj["price_from"], what+".price_from")
	assertTimestamp(t, obj["created_at"], what+".created_at")
	assertTimestamp(t, obj["updated_at"], what+".updated_at")
	if s := string(obj["in_stock"]); s != "true" && s != "false" {
		t.Errorf("%s.in_stock = %s, want a boolean", what, s)
	}
	variants := array(t, obj["variants"], what+".variants")
	if len(variants) == 0 {
		t.Errorf("%s has no variants; the contract promises at least one", what)
	}
	for i, v := range variants {
		vw := what + ".variants[" + strconv.Itoa(i) + "]"
		vo := object(t, v, "ProductVariant", vw)
		assertMoney(t, vo["price"], vw+".price")
	}

	var p productOut
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if !uuidPattern.MatchString(p.ID) || !slugPattern.MatchString(p.Slug) {
		t.Errorf("%s: id %q or slug %q breaks the contract's pattern", what, p.ID, p.Slug)
	}
	inStock, prices := false, []int64{}
	for _, v := range p.Variants {
		inStock = inStock || v.Stock > 0
		prices = append(prices, v.Price.Amount)
		if v.Stock < 0 || !uuidPattern.MatchString(v.ID) {
			t.Errorf("%s: variant %+v breaks the contract", what, v)
		}
	}
	if len(prices) > 0 && p.PriceFrom.Amount != slices.Min(prices) {
		t.Errorf("%s: price_from %d, want the cheapest variant %d", what, p.PriceFrom.Amount, slices.Min(prices))
	}
	if !slices.IsSorted(prices) {
		t.Errorf("%s: variant prices %v are not cheapest first", what, prices)
	}
	if p.InStock != inStock {
		t.Errorf("%s: in_stock %v, but variant stock says %v", what, p.InStock, inStock)
	}
	return p
}

// assertProductList checks a 200 GET /v1/products response against
// ProductList and PageInfo and returns its products and next_cursor ("" on
// the last page).
func assertProductList(t *testing.T, resp response) ([]productOut, string) {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("GET /v1/products = %d, want 200: %s", resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, "GET /v1/products")
	outer := object(t, resp.Body, "ProductList", "ProductList")
	page := object(t, outer["page"], "PageInfo", "page")

	var products []productOut
	for i, raw := range array(t, outer["data"], "data") {
		products = append(products, assertProduct(t, raw, "data["+strconv.Itoa(i)+"]"))
	}
	var cursor *string
	if err := json.Unmarshal(page["next_cursor"], &cursor); err != nil {
		t.Fatalf("page.next_cursor = %s, want a string or null", page["next_cursor"])
	}
	if cursor != nil && *cursor == "" {
		t.Error("page.next_cursor is an empty string; the last page has null")
	}
	if cursor == nil {
		return products, ""
	}
	return products, *cursor
}

// assertProductDetail checks a 200 GET /v1/products/{slug} response.
func assertProductDetail(t *testing.T, resp response) productOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("GET product = %d, want 200: %s", resp.Status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, "GET product")
	outer := object(t, resp.Body, "ProductDetail", "ProductDetail")
	return assertProduct(t, outer["data"], "data")
}

// assertAdminProduct checks an AdminProductDetail body (admin GET, POST and
// PUT) and returns the product.
func assertAdminProduct(t *testing.T, body []byte) adminProductOut {
	t.Helper()
	outer := object(t, body, "AdminProductDetail", "AdminProductDetail")
	obj := object(t, outer["data"], "AdminProduct", "data")
	if string(obj["price_from"]) != "null" {
		assertMoney(t, obj["price_from"], "data.price_from")
	}
	assertTimestamp(t, obj["created_at"], "data.created_at")
	assertTimestamp(t, obj["updated_at"], "data.updated_at")
	for i, v := range array(t, obj["variants"], "data.variants") {
		vw := "data.variants[" + strconv.Itoa(i) + "]"
		vo := object(t, v, "AdminVariant", vw)
		assertMoney(t, vo["price"], vw+".price")
	}
	var p struct {
		Data adminProductOut `json:"data"`
	}
	if err := json.Unmarshal(body, &p); err != nil {
		t.Fatalf("decode AdminProductDetail: %v", err)
	}
	if !slices.Contains([]string{"draft", "active", "archived"}, p.Data.Status) {
		t.Errorf("status %q is not in the contract's enum", p.Data.Status)
	}
	return p.Data
}

// assertErrorDetails checks an error body with details, exactly
// {"error":{"code","message","details":{…}}}, and returns the details.
func assertErrorDetails(t *testing.T, resp response, wantStatus int, wantCode string) map[string]any {
	t.Helper()
	if resp.Status != wantStatus {
		t.Fatalf("status = %d, want %d: %s", resp.Status, wantStatus, resp.Body)
	}
	assertJSONContentType(t, resp.Header, "error")
	outer := decodeObject(t, resp.Body)
	assertKeys(t, outer, []string{"error"}, "error body")
	inner := decodeObject(t, outer["error"])
	assertKeys(t, inner, []string{"code", "message", "details"}, `error body "error"`)
	var e struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	}
	if err := json.Unmarshal(outer["error"], &e); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if e.Code != wantCode || e.Message == "" {
		t.Errorf("error = %s %q, want code %s and a message", e.Code, e.Message, wantCode)
	}
	return e.Details
}

// assertNoErrorLog fails if the server logged anything at ERROR. Every 5xx
// is logged that way, so a bad input that slipped past validation into the
// database shows up here even when the client got a 400.
func assertNoErrorLog(t *testing.T, s *server) {
	t.Helper()
	for line := range strings.Lines(s.logs.String()) {
		if strings.Contains(line, "ERROR") || strings.Contains(line, "request failed") {
			t.Errorf("the server logged an error: %s", line)
		}
	}
}

// productSlugs lists the slugs of products in order.
func productSlugs(products []productOut) []string {
	out := make([]string, 0, len(products))
	for _, p := range products {
		out = append(out, p.Slug)
	}
	return out
}
