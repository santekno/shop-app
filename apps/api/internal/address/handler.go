package address

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeAddressLimit    = "ADDRESS_LIMIT_REACHED"
	CodeDefaultRequired = "DEFAULT_ADDRESS_REQUIRED"
)

// Book is what the handlers need from the service.
type Book interface {
	List(ctx context.Context, userID string) ([]Address, error)
	Get(ctx context.Context, userID, id string) (Address, error)
	Create(ctx context.Context, userID string, in Input) (Address, error)
	Update(ctx context.Context, userID, id string, p Patch) (Address, error)
	Delete(ctx context.Context, userID, id string) error
}

// Handler serves /v1/me/addresses. Its routes must be mounted behind the
// auth middleware: the caller's user ID comes from the context (sdk ctxx),
// never from the URL or the body, so a client cannot name someone else's
// account.
type Handler struct {
	svc       Book
	validator *httpapi.Validator
}

// NewHandler returns a Handler.
func NewHandler(svc Book, validator *httpapi.Validator) *Handler {
	return &Handler{svc: svc, validator: validator}
}

// Routes registers the routes on r (mounted under /v1, behind auth).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/me/addresses", h.List)
	r.Post("/me/addresses", h.Create)
	r.Get("/me/addresses/{id}", h.Get)
	r.Patch("/me/addresses/{id}", h.Update)
	r.Delete("/me/addresses/{id}", h.Delete)
}

// List serves GET /v1/me/addresses.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.List(r.Context(), ctxx.UserID(r.Context()))
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	data := make([]addressJSON, 0, len(list))
	for _, a := range list {
		data = append(data, toJSON(a))
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: data})
}

// Get serves GET /v1/me/addresses/{id}. Another user's address, and an id
// that is not a UUID, are 404 like a missing one.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := addressID(w, r)
	if !ok {
		return
	}
	a, err := h.svc.Get(r.Context(), ctxx.UserID(r.Context()), id)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toJSON(a)})
}

// createBody is the request body of POST /v1/me/addresses.
type createBody struct {
	Label         string `json:"label" validate:"required,max=50"`
	RecipientName string `json:"recipient_name" validate:"required,max=100"`
	Phone         string `json:"phone" validate:"required,id_phone"`
	Street        string `json:"street" validate:"required,max=500"`
	City          string `json:"city" validate:"required,max=100"`
	Province      string `json:"province" validate:"required,max=100"`
	PostalCode    string `json:"postal_code" validate:"required,id_postal"`
	IsDefault     bool   `json:"is_default"`
}

// Create serves POST /v1/me/addresses: 201 with the address and its URL in
// Location.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body createBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	fields := []*string{&body.Label, &body.RecipientName, &body.Phone, &body.Street, &body.City, &body.Province, &body.PostalCode}
	for _, f := range fields {
		*f = strings.TrimSpace(*f)
	}
	details, err := h.validator.StructFields(body, "")
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	checkText(details, map[string]*string{
		"label": &body.Label, "recipient_name": &body.RecipientName, "street": &body.Street,
		"city": &body.City, "province": &body.Province,
	})
	if len(details) > 0 {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}
	a, err := h.svc.Create(r.Context(), ctxx.UserID(r.Context()), Input(body))
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.Header().Set("Location", "/v1/me/addresses/"+a.ID)
	httpapi.JSON(w, r, http.StatusCreated, dataResponse{Data: toJSON(a)})
}

// patchBody is the request body of PATCH /v1/me/addresses/{id}: every field
// is optional, and a field that is left out (or sent as null) keeps its
// value. No address field can be cleared: each one is required.
type patchBody struct {
	Label         *string `json:"label" validate:"omitnil,min=1,max=50"`
	RecipientName *string `json:"recipient_name" validate:"omitnil,min=1,max=100"`
	Phone         *string `json:"phone" validate:"omitnil,id_phone"`
	Street        *string `json:"street" validate:"omitnil,min=1,max=500"`
	City          *string `json:"city" validate:"omitnil,min=1,max=100"`
	Province      *string `json:"province" validate:"omitnil,min=1,max=100"`
	PostalCode    *string `json:"postal_code" validate:"omitnil,id_postal"`
	IsDefault     *bool   `json:"is_default"`
}

// Update serves PATCH /v1/me/addresses/{id}.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := addressID(w, r)
	if !ok {
		return
	}
	var body patchBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	fields := []*string{body.Label, body.RecipientName, body.Phone, body.Street, body.City, body.Province, body.PostalCode}
	for _, f := range fields {
		if f != nil {
			*f = strings.TrimSpace(*f)
		}
	}
	details, err := h.validator.StructFields(body, "")
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	checkText(details, map[string]*string{
		"label": body.Label, "recipient_name": body.RecipientName, "street": body.Street,
		"city": body.City, "province": body.Province,
	})
	if len(details) > 0 {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}
	a, err := h.svc.Update(r.Context(), ctxx.UserID(r.Context()), id, Patch(body))
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toJSON(a)})
}

// Delete serves DELETE /v1/me/addresses/{id}: 204. When it was the
// default, the newest remaining address becomes the default.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := addressID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), ctxx.UserID(r.Context()), id); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// addressID reads {id}; one that is not a UUID is answered 404 here, like
// an unknown one, without a query.
func addressID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toHTTPError(ErrNotFound))
		return "", false
	}
	return id, true
}

// checkText adds a message for every set value that cannot be stored as
// text and has no other problem.
func checkText(details map[string]any, values map[string]*string) {
	for field, v := range values {
		if _, failed := details[field]; !failed && v != nil && !httpapi.ValidText(*v) {
			details[field] = httpapi.InvalidTextMessage
		}
	}
}

// toHTTPError maps the service's errors to the API's error responses.
func toHTTPError(err error) error {
	switch {
	case errors.Is(err, ErrNotFound):
		return httpapi.NotFoundError("address not found")
	case errors.Is(err, ErrLimitReached):
		return errx.New(CodeAddressLimit, "you already have the maximum number of addresses; delete one first").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"max": MaxPerUser})
	case errors.Is(err, ErrDefaultRequired):
		return errx.New(CodeDefaultRequired, "make another address the default instead").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"is_default": "the default address cannot be unset; set is_default on another address"})
	case errors.Is(err, ErrNoUser):
		return httpapi.UnauthorizedError("this account no longer exists")
	case errors.Is(err, ErrInvalidText):
		return httpapi.ValidationError("invalid request", map[string]any{"body": httpapi.InvalidTextMessage})
	default:
		return err
	}
}

// addressJSON is Address in api/openapi.yaml.
type addressJSON struct {
	ID            string    `json:"id"`
	Label         string    `json:"label"`
	RecipientName string    `json:"recipient_name"`
	Phone         string    `json:"phone"`
	Street        string    `json:"street"`
	City          string    `json:"city"`
	Province      string    `json:"province"`
	PostalCode    string    `json:"postal_code"`
	IsDefault     bool      `json:"is_default"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func toJSON(a Address) addressJSON {
	return addressJSON{
		ID: a.ID, Label: a.Label, RecipientName: a.RecipientName, Phone: a.Phone, Street: a.Street,
		City: a.City, Province: a.Province, PostalCode: a.PostalCode, IsDefault: a.IsDefault,
		CreatedAt: a.CreatedAt.UTC(), UpdatedAt: a.UpdatedAt.UTC(),
	}
}

type dataResponse struct {
	Data any `json:"data"`
}
