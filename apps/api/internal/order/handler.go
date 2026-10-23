package order

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeCartEmpty        = "CART_EMPTY"
	CodeCheckoutProblems = "CHECKOUT_PROBLEMS"
)

// Checkout is what the checkout handlers need from the service.
type Checkout interface {
	Preview(ctx context.Context, userID string) (Preview, error)
}

// Handler serves checkout and orders. Its routes are mounted behind the
// auth middleware: the buyer is the caller in the access token.
type Handler struct {
	checkout  Checkout
	validator *httpapi.Validator
}

// NewHandler returns a Handler.
func NewHandler(checkout Checkout, validator *httpapi.Validator) *Handler {
	return &Handler{checkout: checkout, validator: validator}
}

// Routes registers the buyer's routes on r (mounted under /v1, behind
// auth).
func (h *Handler) Routes(r chi.Router) {
	r.Post("/checkout/preview", h.Preview)
}

// previewBody is the request body of POST /v1/checkout/preview.
type previewBody struct{}

// Preview serves POST /v1/checkout/preview: 200 with what checkout would
// charge, or 409 with the lines it would refuse.
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	var body previewBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	p, err := h.checkout.Preview(r.Context(), ctxx.UserID(r.Context()))
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toPreviewJSON(p)})
}

// toHTTPError maps the service's errors to the API's error responses.
func toHTTPError(err error) error {
	var problems *ProblemsError
	switch {
	case errors.Is(err, ErrCartEmpty):
		return errx.New(CodeCartEmpty, "the cart is empty").WithHTTPStatus(http.StatusConflict)
	case errors.As(err, &problems):
		return errx.New(CodeCheckoutProblems, "some cart lines cannot be bought as they are; fix them and try again").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"lines": toProblemsJSON(problems.Lines)})
	default:
		return err
	}
}

type dataResponse struct {
	Data any `json:"data"`
}

// problemJSON is CheckoutProblem in api/openapi.yaml.
type problemJSON struct {
	VariantID      string         `json:"variant_id"`
	SKU            string         `json:"sku"`
	Problem        string         `json:"problem"`
	Quantity       int32          `json:"quantity"`
	Available      int32          `json:"available"`
	UnitPrice      cart.MoneyJSON `json:"unit_price"`
	PriceWhenAdded cart.MoneyJSON `json:"price_when_added"`
}

func toProblemsJSON(lines []LineProblem) []problemJSON {
	out := make([]problemJSON, 0, len(lines))
	for _, l := range lines {
		out = append(out, problemJSON{
			VariantID: l.VariantID, SKU: l.SKU, Problem: string(l.Problem), Quantity: l.Quantity,
			Available: l.Available, UnitPrice: cart.Rupiah(l.Price), PriceWhenAdded: cart.Rupiah(l.AddedPrice),
		})
	}
	return out
}

// previewJSON is CheckoutPreview in api/openapi.yaml.
type previewJSON struct {
	Lines  []cart.LineJSON `json:"lines"`
	Totals totalsJSON      `json:"totals"`
}

// totalsJSON is OrderTotals in api/openapi.yaml.
type totalsJSON struct {
	Subtotal    cart.MoneyJSON `json:"subtotal"`
	Discount    cart.MoneyJSON `json:"discount"`
	ShippingFee cart.MoneyJSON `json:"shipping_fee"`
	Total       cart.MoneyJSON `json:"total"`
	WeightGrams int64          `json:"weight_grams"`
}

func toTotalsJSON(t Totals) totalsJSON {
	return totalsJSON{
		Subtotal: cart.Rupiah(t.Subtotal), Discount: cart.Rupiah(t.Discount),
		ShippingFee: cart.Rupiah(t.ShippingFee), Total: cart.Rupiah(t.Total), WeightGrams: t.WeightGrams,
	}
}

func toPreviewJSON(p Preview) previewJSON {
	return previewJSON{Lines: cart.ToJSON(cart.Cart{Lines: p.Lines}).Lines, Totals: toTotalsJSON(p.Totals)}
}
