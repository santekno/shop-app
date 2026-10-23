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
	CodeInvalidTransition   = "INVALID_TRANSITION"
	CodeKeyRequired         = "IDEMPOTENCY_KEY_REQUIRED"
	CodeKeyReused           = "IDEMPOTENCY_KEY_REUSED"
	CodeKeyInProgress       = "IDEMPOTENCY_IN_PROGRESS"
)

// Idempotency headers (ADR 0006).
const (
	HeaderIdempotencyKey = "Idempotency-Key"
	HeaderReplayed       = "Idempotency-Replayed"
)

// Orders is what the buyer's order handlers need from the service.
type Orders interface {
	Get(ctx context.Context, userID, id string) (Order, error)
	History(ctx context.Context, userID, cursor string, limit int) (Page, error)
	Complete(ctx context.Context, buyerID, id string) error
	CancelByBuyer(ctx context.Context, buyerID, id string) error
}

// Checkout is what the checkout handlers need from the service.
type Checkout interface {
	Preview(ctx context.Context, userID string, in PreviewInput) (Preview, error)
	ShippingQuotes(ctx context.Context, userID, addressID string) (Quotes, error)
	Checkout(ctx context.Context, userID string, idem Idempotency, in CheckoutInput) (Response, error)
}

// Handler serves checkout and orders. Its routes are mounted behind the
// auth middleware: the buyer is the caller in the access token.
type Handler struct {
	checkout  Checkout
	orders    Orders
	staff     Staff
	validator *httpapi.Validator
	limiter   auth.RateLimiter
	limits    Limits
}

// NewHandler returns a Handler. svc is usually one *Service that is
// Checkout, Orders and Staff.
func NewHandler(checkout Checkout, orders Orders, staff Staff, validator *httpapi.Validator) *Handler {
	return &Handler{checkout: checkout, orders: orders, staff: staff, validator: validator}
}

// Routes registers the buyer's routes on r (mounted under /v1, behind
// auth).
func (h *Handler) Routes(r chi.Router) {
	r.Post("/checkout/preview", h.Preview)
	r.Get("/checkout/shipping-quotes", h.ShippingQuotes)
	r.Post("/checkout", h.Checkout)
	r.Get("/orders", h.History)
	r.Get("/orders/{id}", h.GetOrder)
	r.Post("/orders/{id}/cancel", h.buyerMove(h.orders.CancelByBuyer))
	r.Post("/orders/{id}/complete", h.buyerMove(h.orders.Complete))
}

// historyQuery is the query string of GET /v1/orders.
type historyQuery struct {
	Cursor string `query:"cursor" validate:"omitempty,max=512"`
	Limit  int    `query:"limit" validate:"min=1,max=50"`
}

// History serves GET /v1/orders: the caller's orders, newest first.
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	q := historyQuery{Limit: 20}
	if err := h.validator.BindQuery(r, &q); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	page, err := h.orders.History(r.Context(), ctxx.UserID(r.Context()), q.Cursor, q.Limit)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, toPageJSON(page))
}

// GetOrder serves GET /v1/orders/{id}. Another user's order is 404 like a
// missing one (OWASP API1): the query is scoped by the caller.
func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	id, ok := orderID(w, r)
	if !ok {
		return
	}
	o, err := h.orders.Get(r.Context(), ctxx.UserID(r.Context()), id)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toOrderJSON(o)})
}

// buyerMove is a buyer's status change on their own order {id}: 200 with
// the order afterwards. Another user's order is 404.
func (h *Handler) buyerMove(move func(ctx context.Context, buyerID, id string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := orderID(w, r)
		if !ok {
			return
		}
		buyer := ctxx.UserID(r.Context())
		if err := move(r.Context(), buyer, id); err != nil {
			httpapi.Error(w, r, toHTTPError(err))
			return
		}
		o, err := h.orders.Get(r.Context(), buyer, id)
		if err != nil {
			httpapi.Error(w, r, toHTTPError(err))
			return
		}
		httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toOrderJSON(o)})
	}
}

// checkoutBody is the request body of POST /v1/checkout.
type checkoutBody struct {
	AddressID   string `json:"address_id" validate:"required,uuid"`
	Courier     string `json:"courier" validate:"required,oneof=jne jnt sicepat"`
	Service     string `json:"service" validate:"required,max=20"`
	VoucherCode string `json:"voucher_code" validate:"omitempty,alphanum,min=3,max=32"`
}

// Checkout serves POST /v1/checkout: 201 with the order, waiting for
// payment, and its URL in Location. It needs an Idempotency-Key; a retry
// with the same key and body gets the same answer with
// Idempotency-Replayed: true, and never a second order.
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, h.limits.Checkout) {
		return
	}
	key := r.Header.Get(HeaderIdempotencyKey)
	if !validIdempotencyKey(key) {
		httpapi.Error(w, r, errx.New(CodeKeyRequired,
			"send an Idempotency-Key header (1 to 255 printable ASCII characters, a UUID is best), and the same one when you retry").
			WithHTTPStatus(http.StatusBadRequest))
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
	body.VoucherCode = NormalizeVoucherCode(body.VoucherCode)
	hash, err := RequestHash(body)
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	resp, err := h.checkout.Checkout(r.Context(), ctxx.UserID(r.Context()), Idempotency{Key: key, RequestHash: hash}, CheckoutInput{
		AddressID: body.AddressID, Courier: shipping.Courier(body.Courier), Service: body.Service,
		VoucherCode: body.VoucherCode,
	})
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	if resp.Replayed {
		w.Header().Set(HeaderReplayed, "true")
	}
	if resp.OrderID != "" {
		w.Header().Set("Location", "/v1/orders/"+resp.OrderID)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(resp.Status)
	_, _ = w.Write(resp.Body) // the client may be gone; nothing left to do
}

// validIdempotencyKey: 1 to 255 printable ASCII characters.
func validIdempotencyKey(key string) bool {
	if key == "" || len(key) > 255 {
		return false
	}
	for i := range len(key) {
		if key[i] < 0x21 || key[i] > 0x7e {
			return false
		}
	}
	return true
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
	var transitionErr *TransitionError
	switch {
	case errors.As(err, &transitionErr):
		return errx.New(CodeInvalidTransition, "the order cannot make this change in its current status").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"status": string(transitionErr.Current), "to": string(transitionErr.To)})
	case errors.Is(err, ErrInvalidCursor):
		return httpapi.ValidationError("invalid query parameters", map[string]any{
			"cursor": "is not a cursor from page.next_cursor for this list; start again without it",
		})
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
	case errors.Is(err, ErrIdempotencyKeyReused):
		return errx.New(CodeKeyReused, "this Idempotency-Key was used for a different checkout; use a new key for a new checkout").
			WithHTTPStatus(http.StatusUnprocessableEntity)
	case errors.Is(err, ErrIdempotencyInProgress):
		return errx.New(CodeKeyInProgress, "a checkout with this Idempotency-Key is still running; retry in a moment").
			WithHTTPStatus(http.StatusConflict)
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
