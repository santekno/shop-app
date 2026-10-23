package order

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeCartEmpty           = "CART_EMPTY"
	CodeCheckoutProblems    = "CHECKOUT_PROBLEMS"
	CodeShippingUnavailable = "SHIPPING_UNAVAILABLE"
	CodeVoucher             = "VOUCHER_NOT_APPLICABLE"
	CodeEmailUnverified     = "EMAIL_UNVERIFIED"
	CodeTooManyPending      = "TOO_MANY_PENDING_ORDERS"
	CodeCartChanged         = "CART_CHANGED"
)

// Checkout is what the checkout handlers need from the service.
type Checkout interface {
	Preview(ctx context.Context, userID string, in PreviewInput) (Preview, error)
	ShippingQuotes(ctx context.Context, userID, addressID string) (Quotes, error)
	Checkout(ctx context.Context, userID string, in CheckoutInput) (Order, error)
}

// Handler serves checkout and orders. Its routes are mounted behind the
// auth middleware: the buyer is the caller in the access token.
type Handler struct {
	checkout  Checkout
	validator *httpapi.Validator
	limiter   auth.RateLimiter
	limits    Limits
}

// NewHandler returns a Handler.
func NewHandler(checkout Checkout, validator *httpapi.Validator) *Handler {
	return &Handler{checkout: checkout, validator: validator}
}

// Routes registers the buyer's routes on r (mounted under /v1, behind
// auth).
func (h *Handler) Routes(r chi.Router) {
	r.Post("/checkout/preview", h.Preview)
	r.Get("/checkout/shipping-quotes", h.ShippingQuotes)
	r.Post("/checkout", h.Checkout)
}

// checkoutBody is the request body of POST /v1/checkout.
type checkoutBody struct {
	AddressID   string `json:"address_id" validate:"required,uuid"`
	Courier     string `json:"courier" validate:"required,oneof=jne jnt sicepat"`
	Service     string `json:"service" validate:"required,max=20"`
	VoucherCode string `json:"voucher_code" validate:"omitempty,alphanum,min=3,max=32"`
}

// Checkout serves POST /v1/checkout: 201 with the order, waiting for
// payment, and its URL in Location.
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, h.limits.Checkout) {
		return
	}
	var body checkoutBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.validator.Struct(body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	o, err := h.checkout.Checkout(r.Context(), ctxx.UserID(r.Context()), CheckoutInput{
		AddressID: body.AddressID, Courier: shipping.Courier(body.Courier), Service: body.Service,
		VoucherCode: NormalizeVoucherCode(body.VoucherCode),
	})
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.Header().Set("Location", "/v1/orders/"+o.ID)
	httpapi.JSON(w, r, http.StatusCreated, dataResponse{Data: toOrderJSON(o)})
}

// previewBody is the request body of POST /v1/checkout/preview.
type previewBody struct {
	AddressID string `json:"address_id" validate:"omitempty,uuid"`
	Courier   string `json:"courier" validate:"omitempty,oneof=jne jnt sicepat"`
	Service   string `json:"service" validate:"omitempty,max=20"`
	// VoucherCode is matched case-insensitively.
	VoucherCode string `json:"voucher_code" validate:"omitempty,alphanum,min=3,max=32"`
}

// checkChoice adds a message when the courier choice is incomplete: a
// courier and a service go together, and both need an address.
func checkChoice(details map[string]any, addressID, courier, service string) {
	switch {
	case courier != "" && service == "":
		details["service"] = "is required with courier"
	case service != "" && courier == "":
		details["courier"] = "is required with service"
	case courier != "" && addressID == "":
		details["address_id"] = "is required to price shipping"
	}
}

// Preview serves POST /v1/checkout/preview: 200 with what checkout would
// charge, or 409 with the lines it would refuse.
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, h.limits.Preview) {
		return
	}
	var body previewBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	details, err := h.validator.StructFields(body, "")
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	checkChoice(details, body.AddressID, body.Courier, body.Service)
	if len(details) > 0 {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}
	p, err := h.checkout.Preview(r.Context(), ctxx.UserID(r.Context()), PreviewInput{
		AddressID: body.AddressID, Courier: shipping.Courier(body.Courier), Service: body.Service,
		VoucherCode: NormalizeVoucherCode(body.VoucherCode),
	})
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toPreviewJSON(p)})
}

// quotesQuery is the query string of GET /v1/checkout/shipping-quotes.
type quotesQuery struct {
	AddressID string `query:"address_id" validate:"required,uuid"`
}

// ShippingQuotes serves GET /v1/checkout/shipping-quotes?address_id=…:
// every courier service for the caller's cart to that address.
func (h *Handler) ShippingQuotes(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, h.limits.Quotes) {
		return
	}
	var q quotesQuery
	if err := h.validator.BindQuery(r, &q); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	quotes, err := h.checkout.ShippingQuotes(r.Context(), ctxx.UserID(r.Context()), q.AddressID)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	out := quotesJSON{WeightGrams: quotes.WeightGrams, Quotes: make([]quoteJSON, 0, len(quotes.Quotes))}
	for _, quote := range quotes.Quotes {
		out.Quotes = append(out.Quotes, toQuoteJSON(quote))
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: out})
}

// toHTTPError maps the service's errors to the API's error responses.
func toHTTPError(err error) error {
	var problems *ProblemsError
	var voucherErr *VoucherError
	switch {
	case errors.As(err, &voucherErr):
		reason := voucherErr.Reason
		if reason == VoucherNotStarted {
			// A promo that has not started answers like an unknown code,
			// so its code cannot be found out by trying (OWASP API6).
			reason = VoucherNotFound
		}
		details := map[string]any{"voucher_code": voucherErr.Code, "reason": reason}
		if voucherErr.Reason == VoucherMinSpend {
			details["min_spend"] = cart.Rupiah(voucherErr.MinSpend)
		}
		return errx.New(CodeVoucher, "this voucher cannot be used on this order").
			WithHTTPStatus(http.StatusConflict).WithDetails(details)
	case errors.Is(err, ErrNotFound):
		return httpapi.NotFoundError("order not found")
	case errors.Is(err, ErrEmailUnverified):
		return errx.New(CodeEmailUnverified, "verify your email address before placing an order").
			WithHTTPStatus(http.StatusForbidden)
	case errors.Is(err, ErrAccountGone):
		return httpapi.UnauthorizedError("this account no longer exists")
	case errors.Is(err, ErrTooManyPendingOrders):
		return errx.New(CodeTooManyPending, "pay or cancel one of your unpaid orders first").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"max": MaxPendingOrders})
	case errors.Is(err, ErrCartChanged):
		return errx.New(CodeCartChanged, "the cart changed while checking out; review it and try again").
			WithHTTPStatus(http.StatusConflict)
	case errors.Is(err, ErrUnknownAddress):
		return httpapi.ValidationError("invalid request", map[string]any{"address_id": "names none of your addresses"})
	case errors.Is(err, ErrUnknownShippingService):
		return httpapi.ValidationError("invalid request", map[string]any{
			"service": "is not offered for this parcel now; choose one from GET /v1/checkout/shipping-quotes",
		})
	case errors.Is(err, shipping.ErrNotServed):
		return errx.New(CodeShippingUnavailable, "no courier serves this address; choose another address").
			WithHTTPStatus(http.StatusUnprocessableEntity)
	case errors.Is(err, shipping.ErrUnavailable):
		return httpapi.UpstreamUnavailableError("the shipping rate service is not answering; try again shortly")
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
	Lines    []cart.LineJSON `json:"lines"`
	Totals   totalsJSON      `json:"totals"`
	Shipping *quoteJSON      `json:"shipping"` // null until a service is chosen
	Voucher  *voucherJSON    `json:"voucher"`  // null without a voucher
}

// voucherJSON is AppliedVoucher in api/openapi.yaml.
type voucherJSON struct {
	Code        string          `json:"code"`
	Kind        string          `json:"kind"`
	Value       int64           `json:"value"`
	MaxDiscount *cart.MoneyJSON `json:"max_discount"`
}

func toVoucherJSON(v Voucher) *voucherJSON {
	out := &voucherJSON{Code: v.Code, Kind: v.Kind, Value: v.Value}
	if v.MaxDiscount > 0 {
		m := cart.Rupiah(v.MaxDiscount)
		out.MaxDiscount = &m
	}
	return out
}

// quoteJSON is ShippingQuote in api/openapi.yaml.
type quoteJSON struct {
	Courier     string         `json:"courier"`
	CourierName string         `json:"courier_name"`
	Service     string         `json:"service"`
	ServiceName string         `json:"service_name"`
	Price       cart.MoneyJSON `json:"price"`
	ETD         string         `json:"etd"`
}

func toQuoteJSON(q shipping.Quote) quoteJSON {
	return quoteJSON{
		Courier: string(q.Courier), CourierName: q.CourierName, Service: q.Service,
		ServiceName: q.ServiceName, Price: cart.Rupiah(q.Price), ETD: q.ETD,
	}
}

// quotesJSON is ShippingQuotes in api/openapi.yaml.
type quotesJSON struct {
	WeightGrams int64       `json:"weight_grams"`
	Quotes      []quoteJSON `json:"quotes"`
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
	out := previewJSON{Lines: cart.ToJSON(cart.Cart{Lines: p.Lines}).Lines, Totals: toTotalsJSON(p.Totals)}
	if p.Shipping != nil {
		q := toQuoteJSON(*p.Shipping)
		out.Shipping = &q
	}
	if p.Voucher != nil {
		out.Voucher = toVoucherJSON(*p.Voucher)
	}
	return out
}
