package product_test

// Bab 12 artikel-05: POST
// /v1/admin/products/{id}/variants/{variant_id}/stock-adjustments.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// fakeStock is a product.Stock that records each change.
type fakeStock struct {
	ids     []string
	changes []product.StockChange
	variant product.AdminVariant
	err     error
}

func (f *fakeStock) Change(_ context.Context, productID, variantID string, c product.StockChange) (product.AdminVariant, error) {
	f.ids = append(f.ids, productID+"/"+variantID)
	f.changes = append(f.changes, c)
	return f.variant, f.err
}

func stockTarget(productID, variantID string) string {
	return "/v1/admin/products/" + productID + "/variants/" + variantID + "/stock-adjustments"
}

// serveStock POSTs body through the admin routes of a handler with stock
// (none when stock is nil).
func serveStock(stock product.Stock, target, body string) *httptest.ResponseRecorder {
	svc := &fakeService{}
	h := product.NewHandler(svc, svc, httpapi.NewValidator())
	if stock != nil {
		h = h.WithStock(stock)
	}
	r := chi.NewRouter()
	r.Route("/v1/admin", h.AdminRoutes)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodPost, target, strings.NewReader(body)))
	return rec
}

func TestHandler_AdjustStock(t *testing.T) {
	tests := []struct {
		body string
		want product.StockChange
	}{
		{body: `{"delta":20}`, want: product.StockChange{Delta: 20}},
		{body: `{"delta":-2}`, want: product.StockChange{Delta: -2}},
		{body: `{"delta":1000000}`, want: product.StockChange{Delta: 1000000}},
		{body: `{"delta":-1000000}`, want: product.StockChange{Delta: -1000000}},
		{body: `{"set":15,"expected":12}`, want: product.StockChange{IsSet: true, Set: 15, Expected: 12}},
		{body: `{"set":0,"expected":0}`, want: product.StockChange{IsSet: true}},
		{body: `{"set":1000000,"expected":1000000}`, want: product.StockChange{IsSet: true, Set: 1000000, Expected: 1000000}},
		// null is the same as leaving the field out.
		{body: `{"delta":5,"set":null,"expected":null}`, want: product.StockChange{Delta: 5}},
	}
	for _, tt := range tests {
		t.Run(tt.body, func(t *testing.T) {
			stock := &fakeStock{variant: product.AdminVariant{
				ID: variantID, SKU: "KPH-S", Name: "S", Price: 89000, Stock: 24, WeightGrams: 180, Version: 6,
			}}
			rec := serveStock(stock, stockTarget(productID, variantID), tt.body)

			testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
			testx.AssertEqual(t, len(stock.changes), 1)
			testx.AssertEqual(t, stock.changes[0], tt.want)
			testx.AssertEqual(t, stock.ids[0], productID+"/"+variantID)
			testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()),
				`{"data":{"id":"`+variantID+`","sku":"KPH-S","name":"S","price":{"amount":89000,"currency":"IDR"},"stock":24,"weight_grams":180,"version":6}}`)
		})
	}
}

// A body that is neither form, or out of bounds, is 400 VALIDATION_FAILED
// with exact details, and the service is never asked.
func TestHandler_AdjustStock_Invalid(t *testing.T) {
	const either = "send either delta, or set with expected, not both"
	tests := []struct {
		body   string
		want   map[string]any
		prefix string // details.body starts with it, when want is nil
	}{
		{body: `{"delta":0}`, want: map[string]any{"delta": "must not be 0"}},
		{body: `{"delta":5,"set":3,"expected":1}`, want: map[string]any{"body": either}},
		{body: `{"delta":5,"set":3}`, want: map[string]any{"body": either}},
		{body: `{"delta":5,"expected":3}`, want: map[string]any{"body": either}},
		{body: `{"set":3}`, want: map[string]any{"expected": "is required with set: the stock you saw before counting"}},
		{body: `{"expected":3}`, want: map[string]any{"body": "send delta, or set with expected"}},
		{body: `{}`, want: map[string]any{"body": "send delta, or set with expected"}},
		{body: `{"delta":null}`, want: map[string]any{"body": "send delta, or set with expected"}},
		{body: `{"delta":1000001}`, want: map[string]any{"delta": "must be between -1000000 and 1000000"}},
		{body: `{"delta":-1000001}`, want: map[string]any{"delta": "must be between -1000000 and 1000000"}},
		{body: `{"set":-1,"expected":0}`, want: map[string]any{"set": "must be between 0 and 1000000"}},
		{body: `{"set":1000001,"expected":0}`, want: map[string]any{"set": "must be between 0 and 1000000"}},
		{body: `{"set":1,"expected":-1}`, want: map[string]any{"expected": "must be between 0 and 1000000"}},
		{body: `{"set":1,"expected":1000001}`, want: map[string]any{"expected": "must be between 0 and 1000000"}},
		{body: `{"delta":"20"}`, want: map[string]any{"body": "field delta has the wrong JSON type"}},
		{body: `{"delta":2.5}`, want: map[string]any{"body": "field delta has the wrong JSON type"}},
		{body: `{"delta":5,"reason":"received"}`, want: map[string]any{"body": `must be valid JSON matching the schema: json: unknown field "reason"`}},
		{body: `not json`, prefix: "must be valid JSON matching the schema: "},
		{body: ``, want: map[string]any{"body": "is empty"}},
	}
	for _, tt := range tests {
		t.Run(tt.body, func(t *testing.T) {
			stock := &fakeStock{}
			rec := serveStock(stock, stockTarget(productID, variantID), tt.body)

			testx.AssertEqual(t, rec.Code, http.StatusBadRequest, "body %s", rec.Body.String())
			got := decodeError(t, rec).Error
			testx.AssertEqual(t, got.Code, httpapi.CodeValidationFailed)
			if tt.prefix != "" {
				msg, _ := got.Details["body"].(string)
				testx.AssertTrue(t, strings.HasPrefix(msg, tt.prefix), "details.body = %q", msg)
			}
			if tt.want != nil {
				testx.AssertEqual(t, len(got.Details), len(tt.want), "details %v", got.Details)
				for k, v := range tt.want {
					testx.AssertEqual(t, got.Details[k], v, "details[%q]", k)
				}
			}
			testx.AssertEqual(t, len(stock.changes), 0, "the service was asked")
		})
	}
}

// A path id that is not a UUID is 404, before the body is read.
func TestHandler_AdjustStock_NonUUIDIsNotFound(t *testing.T) {
	for _, target := range []string{
		stockTarget("123", variantID), stockTarget(productID, "KPH-S"), stockTarget(productID+"0", variantID),
	} {
		t.Run(target, func(t *testing.T) {
			stock := &fakeStock{}
			rec := serveStock(stock, target, `{"delta":1}`)
			testx.AssertEqual(t, rec.Code, http.StatusNotFound)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, httpapi.CodeNotFound)
			testx.AssertEqual(t, body.Error.Message, "variant not found")
			testx.AssertEqual(t, len(stock.changes), 0)
		})
	}
}

func TestHandler_AdjustStock_Errors(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		wantStatus  int
		wantCode    string
		wantMessage string
		wantDetails map[string]any
	}{
		{
			name: "out of range", err: &product.StockError{Err: product.ErrStockOutOfRange, VariantID: variantID, Stock: 3},
			wantStatus: 409, wantCode: product.CodeStockOutOfRange,
			wantMessage: "the change would take the stock below 0, or raise it above the maximum; nothing was changed",
			wantDetails: map[string]any{"variant_id": variantID, "stock": float64(3), "min": float64(0), "max": float64(1000000)},
		},
		{
			name: "stock changed", err: &product.StockError{Err: product.ErrStockChanged, VariantID: variantID, Stock: 10},
			wantStatus: 409, wantCode: product.CodeStockChanged,
			wantMessage: "the stock changed since you counted it (a sale or another change); nothing was changed",
			wantDetails: map[string]any{"variant_id": variantID, "stock": float64(10)},
		},
		{
			name: "archived", err: &product.VariantArchivedError{VariantID: variantID},
			wantStatus: 409, wantCode: product.CodeVariantArchived,
			wantMessage: "the variant is archived and can no longer be written; reload the product",
			wantDetails: map[string]any{"variant_id": variantID},
		},
		{name: "not a variant of the product", err: product.ErrVariantNotFound, wantStatus: 404, wantCode: httpapi.CodeNotFound, wantMessage: "variant not found"},
		{name: "failure", err: errors.New("connection refused"), wantStatus: 500, wantCode: httpapi.CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Wrapped, as the service returns them.
			stock := &fakeStock{err: fmt.Errorf("change stock of variant %s: %w", variantID, tt.err)}
			rec := serveStock(stock, stockTarget(productID, variantID), `{"delta":-5}`)

			testx.AssertEqual(t, rec.Code, tt.wantStatus, "body %s", rec.Body.String())
			var body struct {
				Error struct {
					Code    string         `json:"code"`
					Message string         `json:"message"`
					Details map[string]any `json:"details"`
				} `json:"error"`
			}
			testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			if tt.wantMessage != "" {
				testx.AssertEqual(t, body.Error.Message, tt.wantMessage)
			}
			testx.AssertEqual(t, len(body.Error.Details), len(tt.wantDetails), "details %v", body.Error.Details)
			for k, v := range tt.wantDetails {
				testx.AssertEqual(t, body.Error.Details[k], v, "details[%q]", k)
			}
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "the cause does not leak")
		})
	}
}

// Without WithStock the route is not registered.
func TestHandler_AdjustStock_NotRegisteredWithoutStock(t *testing.T) {
	rec := serveStock(nil, stockTarget(productID, variantID), `{"delta":1}`)
	testx.AssertEqual(t, rec.Code, http.StatusNotFound)

	svc := &fakeService{}
	r := chi.NewRouter()
	product.NewHandler(svc, svc, httpapi.NewValidator()).WithStock(&fakeStock{}).AdminRoutes(r)
	testx.AssertTrue(t, r.Match(chi.NewRouteContext(), http.MethodPost, "/products/"+productID+"/variants/"+variantID+"/stock-adjustments"))
	testx.AssertFalse(t, r.Match(chi.NewRouteContext(), http.MethodGet, "/products/"+productID+"/variants/"+variantID+"/stock-adjustments"), "POST only")
}
