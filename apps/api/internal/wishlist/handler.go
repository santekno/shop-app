package wishlist

import (
	"context"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// CodeLimitReached is the 409 code of a wishlist that is full (see
// api/openapi.yaml).
const CodeLimitReached = "WISHLIST_LIMIT_REACHED"

// slugPattern and maxSlug are the contract's product slug rules.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

const maxSlug = 200

// List is what the handler needs from the service.
type List interface {
	Add(ctx context.Context, userID, slug string) error
	Remove(ctx context.Context, userID, slug string) error
	List(ctx context.Context, userID, cursor string, limit int) (Page, error)
}

// Handler serves /v1/me/wishlist. Its routes must be mounted behind the
// auth middleware: the caller's user ID comes from the context (sdk ctxx),
// never from the URL, so a client cannot name someone else's wishlist.
type Handler struct {
	svc       List
	validator *httpapi.Validator
	// productJSON renders a product exactly as GET /v1/products does
	// (product.Handler.ProductJSON), so the HTTP shape lives in one place.
	productJSON func(product.Product) any
}

// NewHandler returns a Handler. productJSON is product.Handler.ProductJSON.
func NewHandler(svc List, validator *httpapi.Validator, productJSON func(product.Product) any) *Handler {
	return &Handler{svc: svc, validator: validator, productJSON: productJSON}
}

// Routes registers the routes on r (mounted under /v1, behind auth).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/me/wishlist", h.List)
	r.Put("/me/wishlist/{slug}", h.Add)
	r.Delete("/me/wishlist/{slug}", h.Remove)
}

// listQuery is the query string of GET /v1/me/wishlist.
type listQuery struct {
	Cursor string `query:"cursor" validate:"omitempty,max=512"`
	Limit  int    `query:"limit" validate:"min=1,max=100"`
}

// List serves GET /v1/me/wishlist: the caller's saved products, newest
// saved first, in the shape of the storefront list.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := listQuery{Limit: 20}
	if err := h.validator.BindQuery(r, &q); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	page, err := h.svc.List(r.Context(), ctxx.UserID(r.Context()), q.Cursor, q.Limit)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	data := make([]any, 0, len(page.Products)) // [] rather than null
	for _, p := range page.Products {
		data = append(data, h.productJSON(p))
	}
	resp := listResponse{Data: data}
	if page.NextCursor != "" {
		resp.Page.NextCursor = &page.NextCursor
	}
	httpapi.JSON(w, r, http.StatusOK, resp)
}

// Add serves PUT /v1/me/wishlist/{slug}: 204, also when the product was on
// the wishlist already. A malformed slug is answered like an unknown one,
// 404, without a query.
func (h *Handler) Add(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if len(slug) > maxSlug || !slugPattern.MatchString(slug) {
		httpapi.Error(w, r, toHTTPError(ErrProductNotFound))
		return
	}
	if err := h.svc.Add(r.Context(), ctxx.UserID(r.Context()), slug); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Remove serves DELETE /v1/me/wishlist/{slug}: 204 whether or not the
// product was on the wishlist, and for a slug that names no product. A
// malformed slug cannot be on any wishlist, so it is 204 without a query.
func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if len(slug) <= maxSlug && slugPattern.MatchString(slug) {
		if err := h.svc.Remove(r.Context(), ctxx.UserID(r.Context()), slug); err != nil {
			httpapi.Error(w, r, toHTTPError(err))
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// toHTTPError maps the service's errors to the API's error responses.
func toHTTPError(err error) error {
	switch {
	case errors.Is(err, ErrProductNotFound):
		return httpapi.NotFoundError("product not found")
	case errors.Is(err, ErrLimitReached):
		return errx.New(CodeLimitReached, "your wishlist is full; remove a product first").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"max": MaxItems})
	case errors.Is(err, ErrInvalidCursor):
		return httpapi.ValidationError("invalid query parameters", map[string]any{
			"cursor": "is not a cursor from page.next_cursor for the wishlist; start again without it",
		})
	case errors.Is(err, ErrNoUser):
		return httpapi.UnauthorizedError("this account no longer exists")
	default:
		return err
	}
}

// The JSON shape of the contract (api/openapi.yaml): the storefront's
// ProductList.

type pageJSON struct {
	NextCursor *string `json:"next_cursor"` // null on the last page
}

type listResponse struct {
	Data []any    `json:"data"`
	Page pageJSON `json:"page"`
}
