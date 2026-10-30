package product

import (
	"context"
	"errors"
	"net/http"

	"github.com/santekno/sdk/errx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The codes the stock adjustment adds (see api/openapi.yaml).
const (
	CodeStockOutOfRange = "STOCK_OUT_OF_RANGE"
	CodeStockChanged    = "STOCK_CHANGED"
)

// Stock is what the stock adjustment's handler needs from the
// StockService.
type Stock interface {
	Change(ctx context.Context, productID, variantID string, change StockChange) (AdminVariant, error)
}

// WithStock makes h serve the stock adjustments with stock, and returns h.
// Without it AdminRoutes does not register that route.
func (h *Handler) WithStock(stock Stock) *Handler {
	h.stock = stock
	return h
}

// stockBody is the body of POST …/variants/{variant_id}/stock-adjustments:
// either delta, or set with expected.
type stockBody struct {
	Delta    *int32 `json:"delta" validate:"omitnil,min=-1000000,max=1000000"`
	Set      *int32 `json:"set" validate:"omitnil,min=0,max=1000000"`
	Expected *int32 `json:"expected" validate:"omitnil,min=0,max=1000000"`
}

// change is the body as a StockChange, or the VALIDATION_FAILED details
// of a body that is neither one form nor the other.
func (b stockBody) change() (StockChange, map[string]any) {
	switch {
	case b.Delta != nil && (b.Set != nil || b.Expected != nil):
		return StockChange{}, map[string]any{"body": "send either delta, or set with expected, not both"}
	case b.Delta != nil && *b.Delta == 0:
		return StockChange{}, map[string]any{"delta": "must not be 0"}
	case b.Delta != nil:
		return StockChange{Delta: *b.Delta}, nil
	case b.Set != nil && b.Expected == nil:
		return StockChange{}, map[string]any{"expected": "is required with set: the stock you saw before counting"}
	case b.Set != nil:
		return StockChange{IsSet: true, Set: *b.Set, Expected: *b.Expected}, nil
	default:
		return StockChange{}, map[string]any{"body": "send delta, or set with expected"}
	}
}

// AdjustStock serves POST
// /v1/admin/products/{id}/variants/{variant_id}/stock-adjustments: 200
// with the variant afterwards.
func (h *Handler) AdjustStock(w http.ResponseWriter, r *http.Request) {
	productID, ok := pathID(w, r, "id", ErrVariantNotFound)
	if !ok {
		return
	}
	variantID, ok := pathID(w, r, "variant_id", ErrVariantNotFound)
	if !ok {
		return
	}
	var body stockBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.validator.Struct(&body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	change, details := body.change()
	if details != nil {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}
	v, err := h.stock.Change(r.Context(), productID, variantID, change)
	if err != nil {
		httpapi.Error(w, r, toStockHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: adminVariantJSON{
		ID: v.ID, SKU: v.SKU, Name: v.Name, Price: rupiah(v.Price), Stock: v.Stock, WeightGrams: v.WeightGrams,
		Version: v.Version,
	}})
}

func toStockHTTPError(err error) error {
	var stockErr *StockError
	switch {
	case errors.As(err, &stockErr) && errors.Is(err, ErrStockOutOfRange):
		return errx.New(CodeStockOutOfRange, "the change would take the stock below 0, or raise it above the maximum; nothing was changed").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{
				"variant_id": stockErr.VariantID, "stock": stockErr.Stock, "min": 0, "max": MaxVariantStock,
			})
	case errors.As(err, &stockErr) && errors.Is(err, ErrStockChanged):
		return errx.New(CodeStockChanged, "the stock changed since you counted it (a sale or another change); nothing was changed").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"variant_id": stockErr.VariantID, "stock": stockErr.Stock})
	default:
		// NOT_FOUND, VARIANT_ARCHIVED, and anything else as a 500.
		return toHTTPError(err)
	}
}
