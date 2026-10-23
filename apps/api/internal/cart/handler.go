package cart

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeVariantUnavailable = "VARIANT_UNAVAILABLE"
	CodeInsufficientStock  = "INSUFFICIENT_STOCK"
	CodeQuantityLimit      = "QUANTITY_LIMIT"
	CodeCartFull           = "CART_FULL"
)

// Carts is what the handlers need from the service.
type Carts interface {
	Get(ctx context.Context, owner Owner) (Cart, error)
	Add(ctx context.Context, owner Owner, variantID string, quantity int32) (Cart, error)
	SetQuantity(ctx context.Context, owner Owner, variantID string, quantity int32) (Cart, error)
	Remove(ctx context.Context, owner Owner, variantID string) (Cart, error)
}

// Handler serves /v1/cart. Its routes are mounted behind the auth
// middleware: the cart's owner is the caller in the access token.
type Handler struct {
	svc       Carts
	validator *httpapi.Validator
}

// NewHandler returns a Handler.
func NewHandler(svc Carts, validator *httpapi.Validator) *Handler {
	return &Handler{svc: svc, validator: validator}
}

// Routes registers the cart routes on r (mounted under /v1).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/cart", h.Get)
	r.Post("/cart/items", h.AddItem)
	r.Patch("/cart/items/{variant_id}", h.UpdateItem)
	r.Delete("/cart/items/{variant_id}", h.RemoveItem)
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
	c, err := h.svc.Add(r.Context(), ownerOf(r), body.VariantID, body.Quantity)
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

// ownerOf is the caller of r as a cart owner.
func ownerOf(r *http.Request) Owner {
	return Owner{UserID: ctxx.UserID(r.Context())}
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
