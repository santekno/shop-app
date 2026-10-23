package user

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Profiles is what the handlers need from the service.
type Profiles interface {
	Get(ctx context.Context, id string) (User, error)
}

// Handler serves /v1/me. Its routes must be mounted behind the auth
// middleware, which puts the caller's user ID in the context (sdk ctxx).
type Handler struct {
	svc Profiles
}

// NewHandler returns a Handler.
func NewHandler(svc Profiles) *Handler {
	return &Handler{svc: svc}
}

// Routes registers the routes on r (mounted under /v1, behind auth).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/me", h.Me)
}

// Me serves GET /v1/me: the caller's own account.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u, err := h.svc.Get(r.Context(), ctxx.UserID(r.Context()))
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: ToJSON(u)})
}

// toHTTPError maps the service's errors to the API's error responses.
func toHTTPError(err error) error {
	switch {
	case errors.Is(err, ErrNotFound):
		// The token is genuine but the account is gone (deleted since it
		// was issued): the caller is no longer anyone.
		return httpapi.UnauthorizedError("this account no longer exists")
	default:
		return err
	}
}

type dataResponse struct {
	Data any `json:"data"`
}
