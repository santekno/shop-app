package cart

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeVariantUnavailable = "VARIANT_UNAVAILABLE"
	CodeInsufficientStock  = "INSUFFICIENT_STOCK"
	CodeQuantityLimit      = "QUANTITY_LIMIT"
	CodeCartFull           = "CART_FULL"
	CodeCartNotFound       = "CART_NOT_FOUND"
)

// LimitGuestCartPerIP bounds how many guest carts one client address may
// create (OWASP API4): each is a row that lives until it is merged. Bab 5
// has no job that deletes abandoned guest carts; Bab 6's worker adds one
// (SECURITY.md, known limits).
var LimitGuestCartPerIP = auth.Limit{Name: "guest-cart-ip", Max: 30, Window: time.Hour}

// Carts is what the handlers need from the service.
type Carts interface {
	Get(ctx context.Context, owner Owner) (Cart, error)
	Add(ctx context.Context, owner Owner, variantID string, quantity int32) (Cart, string, error)
	SetQuantity(ctx context.Context, owner Owner, variantID string, quantity int32) (Cart, error)
	Remove(ctx context.Context, owner Owner, variantID string) (Cart, error)
	Merge(ctx context.Context, userID, token string) (Cart, error)
}

// Handler serves /v1/cart for guests and logged-in users alike.
type Handler struct {
	svc         Carts
	validator   *httpapi.Validator
	limiter     auth.RateLimiter
	trustedHops int
}

// HandlerDeps is what the handler needs; all but TrustedProxyHops are
// required.
type HandlerDeps struct {
	Service   Carts
	Validator *httpapi.Validator
	// Limiter counts new guest carts (LimitGuestCartPerIP).
	Limiter auth.RateLimiter
	// TrustedProxyHops is APP_TRUSTED_PROXY_HOPS, for httpapi.ClientIP.
	TrustedProxyHops int
}

// NewHandler returns a Handler built from deps.
func NewHandler(deps HandlerDeps) *Handler {
	return &Handler{
		svc: deps.Service, validator: deps.Validator, limiter: deps.Limiter, trustedHops: deps.TrustedProxyHops,
	}
}

// Routes registers the cart routes on r (mounted under /v1) behind
// auth.Guard.Optional: with an access token they work on the user's cart,
// without one on the guest cart of the X-Cart-Token header.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/cart", h.Get)
	r.Post("/cart/items", h.AddItem)
	r.Patch("/cart/items/{variant_id}", h.UpdateItem)
	r.Delete("/cart/items/{variant_id}", h.RemoveItem)
}

// ProtectedRoutes registers the routes that need a logged-in user, behind
// auth.Guard.Authenticate.
func (h *Handler) ProtectedRoutes(r chi.Router) {
	r.Post("/cart/merge", h.Merge)
}

// Get serves GET /v1/cart.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	c, err := h.svc.Get(r.Context(), ownerOf(r))
	h.respond(w, r, c, err)
}

// addBody is the request body of POST /v1/cart/items.
type addBody struct {
	VariantID string `json:"variant_id" validate:"required,uuid"`
	Quantity  int32  `json:"quantity" validate:"min=1,max=99"`
}

// AddItem serves POST /v1/cart/items: 200 with the whole cart.
func (h *Handler) AddItem(w http.ResponseWriter, r *http.Request) {
	var body addBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.validator.Struct(body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	owner := ownerOf(r)
	if owner.IsGuest() && owner.Token == "" &&
		!auth.Allow(w, r, h.limiter, LimitGuestCartPerIP, httpapi.RateLimitKey(httpapi.ClientIP(r, h.trustedHops))) {
		return
	}
	c, token, err := h.svc.Add(r.Context(), owner, body.VariantID, body.Quantity)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	if token != "" {
		// A new guest cart: the only time its token is sent. The client
		// keeps it and sends it as X-Cart-Token from now on.
		w.Header().Set(HeaderToken, token)
		httpapi.JSON(w, r, http.StatusOK, newCartResponse{Data: ToJSON(c), CartToken: token})
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: ToJSON(c)})
}

// Merge serves POST /v1/cart/merge: the client calls it right after any
// login, with the guest cart's X-Cart-Token, and forgets the token after
// a 200 (or a 404: the cart is gone).
func (h *Handler) Merge(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get(HeaderToken)
	if token == "" {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", map[string]any{
			HeaderToken: "is required: the guest cart token to merge",
		}))
		return
	}
	c, err := h.svc.Merge(r.Context(), ctxx.UserID(r.Context()), token)
	h.respond(w, r, c, err)
}

// updateBody is the request body of PATCH /v1/cart/items/{variant_id}.
type updateBody struct {
	Quantity int32 `json:"quantity" validate:"min=1,max=99"`
}

// UpdateItem serves PATCH /v1/cart/items/{variant_id}.
func (h *Handler) UpdateItem(w http.ResponseWriter, r *http.Request) {
	variantID, ok := lineID(w, r)
	if !ok {
		return
	}
	var body updateBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.validator.Struct(body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	c, err := h.svc.SetQuantity(r.Context(), ownerOf(r), variantID, body.Quantity)
	h.respond(w, r, c, err)
}

// RemoveItem serves DELETE /v1/cart/items/{variant_id}: 200 with the cart
// that is left.
func (h *Handler) RemoveItem(w http.ResponseWriter, r *http.Request) {
	variantID, ok := lineID(w, r)
	if !ok {
		return
	}
	c, err := h.svc.Remove(r.Context(), ownerOf(r), variantID)
	h.respond(w, r, c, err)
}

func (h *Handler) respond(w http.ResponseWriter, r *http.Request, c Cart, err error) {
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: ToJSON(c)})
}

// ownerOf is the caller of r as a cart owner: the logged-in user, or the
// guest with the token in X-Cart-Token (none for a guest's first add).
func ownerOf(r *http.Request) Owner {
	return Owner{UserID: ctxx.UserID(r.Context()), Token: r.Header.Get(HeaderToken)}
}

// lineID reads {variant_id}; one that is not a UUID is 404 like an unknown
// line, without a query.
func lineID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "variant_id")
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toHTTPError(ErrLineNotFound))
		return "", false
	}
	return id, true
}

// toHTTPError maps the service's errors to the API's error responses.
func toHTTPError(err error) error {
	var stockErr *InsufficientStockError
	switch {
	case errors.Is(err, ErrAccountGone):
		return httpapi.UnauthorizedError("this account no longer exists")
	case errors.Is(err, ErrCartNotFound):
		return errx.New(CodeCartNotFound, "this cart token is not valid any more; forget it and start a new cart").
			WithHTTPStatus(http.StatusNotFound)
	case errors.Is(err, ErrLineNotFound):
		return httpapi.NotFoundError("this variant is not in the cart")
	case errors.Is(err, ErrVariantUnavailable):
		return errx.New(CodeVariantUnavailable, "this variant is not for sale").
			WithHTTPStatus(http.StatusConflict)
	case errors.As(err, &stockErr):
		return errx.New(CodeInsufficientStock, "not enough stock for this quantity").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"available": stockErr.Available})
	case errors.Is(err, ErrQuantityLimit):
		return errx.New(CodeQuantityLimit, "a cart line holds at most 99 units").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"max": MaxQuantity})
	case errors.Is(err, ErrCartFull):
		return errx.New(CodeCartFull, "the cart already has the maximum number of lines; remove one first").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"max": MaxLines})
	default:
		return err
	}
}

type dataResponse struct {
	Data any `json:"data"`
}

// newCartResponse is the answer that created a guest cart.
type newCartResponse struct {
	Data      any    `json:"data"`
	CartToken string `json:"cart_token"`
}
