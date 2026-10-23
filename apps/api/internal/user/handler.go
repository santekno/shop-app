package user

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Profiles is what the handlers need from the service.
type Profiles interface {
	Get(ctx context.Context, id string) (User, error)
	Update(ctx context.Context, id string, p ProfileUpdate) (User, error)
	Delete(ctx context.Context, id string) error
}

// Handler serves /v1/me. Its routes must be mounted behind the auth
// middleware, which puts the caller's user ID in the context (sdk ctxx).
type Handler struct {
	svc       Profiles
	validator *httpapi.Validator
}

// NewHandler returns a Handler.
func NewHandler(svc Profiles, validator *httpapi.Validator) *Handler {
	return &Handler{svc: svc, validator: validator}
}

// Routes registers the routes on r (mounted under /v1, behind auth).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/me", h.Me)
	r.Patch("/me", h.UpdateMe)
	r.Delete("/me", h.DeleteMe)
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

// patchBody is the request body of PATCH /v1/me. A field left out keeps
// its value; phone null removes the phone number. Phone is decoded by hand
// because encoding/json cannot tell null from a missing field.
type patchBody struct {
	Name  *string         `json:"name"`
	Phone json.RawMessage `json:"phone"`
}

// UpdateMe serves PATCH /v1/me: 200 with the updated account.
func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	var body patchBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	update, details := h.profileUpdate(body)
	if len(details) > 0 {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}
	u, err := h.svc.Update(r.Context(), ctxx.UserID(r.Context()), update)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: ToJSON(u)})
}

// The values of a PATCH /v1/me body, each checked on its own with validate
// tags, so their messages match every other endpoint's.
type (
	nameField struct {
		Name string `json:"name" validate:"required,max=100"`
	}
	phoneField struct {
		Phone string `json:"phone" validate:"required,id_phone"`
	}
)

// profileUpdate turns body into a ProfileUpdate, trimming values, and
// returns a message per invalid field.
func (h *Handler) profileUpdate(body patchBody) (ProfileUpdate, map[string]any) {
	var update ProfileUpdate
	details := map[string]any{}
	if body.Name != nil {
		name := strings.TrimSpace(*body.Name)
		h.check(details, nameField{Name: name})
		if _, failed := details["name"]; !failed && !httpapi.ValidText(name) {
			details["name"] = httpapi.InvalidTextMessage
		}
		update.Name = &name
	}
	if len(body.Phone) > 0 {
		update.SetPhone = true
		if string(body.Phone) != "null" {
			var phone string
			if err := json.Unmarshal(body.Phone, &phone); err != nil {
				details["phone"] = "must be a string or null"
				return update, details
			}
			phone = strings.TrimSpace(phone)
			h.check(details, phoneField{Phone: phone})
			update.Phone = &phone
		}
	}
	return update, details
}

// check validates v and copies its failures into details.
func (h *Handler) check(details map[string]any, v any) {
	failed, err := h.validator.StructFields(v, "")
	if err != nil {
		details["body"] = "could not be validated"
		return
	}
	maps.Copy(details, failed)
}

// DeleteMe serves DELETE /v1/me: 204. The account is anonymised (its
// orders keep pointing at it), its addresses and sign-in identities are
// deleted, and every session ends.
func (h *Handler) DeleteMe(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Delete(r.Context(), ctxx.UserID(r.Context())); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
