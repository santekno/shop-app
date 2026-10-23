package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/errx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeEmailTaken = "EMAIL_TAKEN"
)

// Authenticator is what the handlers need from the service.
type Authenticator interface {
	Register(ctx context.Context, in RegisterInput) (user.User, error)
}

// Handler serves the /v1/auth endpoints.
type Handler struct {
	svc       Authenticator
	validator *httpapi.Validator
}

// NewHandler returns a Handler.
func NewHandler(svc Authenticator, validator *httpapi.Validator) *Handler {
	return &Handler{svc: svc, validator: validator}
}

// Routes registers the auth routes on r (mounted under /v1).
func (h *Handler) Routes(r chi.Router) {
	r.Post("/auth/register", h.Register)
}

// registerBody is the request body of POST /v1/auth/register. The
// password has no length rule here: CheckPassword owns the policy.
type registerBody struct {
	Email    string `json:"email" validate:"required,max=254,email"`
	Password string `json:"password" validate:"required"`
	Name     string `json:"name" validate:"required,max=100"`
}

// Register serves POST /v1/auth/register: 201 with the new account.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var body registerBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	body.Email, body.Name = strings.TrimSpace(body.Email), strings.TrimSpace(body.Name)
	details, err := h.validator.StructFields(body, "")
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	checkEmail(details, body.Email)
	checkText(details, "name", body.Name)
	checkPassword(details, "password", body.Password)
	if len(details) > 0 {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}

	u, err := h.svc.Register(r.Context(), RegisterInput{Email: body.Email, Password: body.Password, Name: body.Name})
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusCreated, dataResponse{Data: user.ToJSON(u)})
}

// checkEmail adds a message to details when email, already checked for
// shape by the validator, is not plain ASCII.
func checkEmail(details map[string]any, email string) {
	if _, failed := details["email"]; !failed && !isASCII(email) {
		details["email"] = "must contain only ASCII characters"
	}
}

// checkPassword adds the policy's reason to details, so a sign-up form
// learns about every field in one round trip. The service checks again.
func checkPassword(details map[string]any, field, password string) {
	var pwErr *PasswordError
	if _, failed := details[field]; !failed && errors.As(CheckPassword(password), &pwErr) {
		details[field] = pwErr.Reason
	}
}

// checkText adds a message to details when value cannot be stored as text.
func checkText(details map[string]any, field, value string) {
	if _, failed := details[field]; !failed && !httpapi.ValidText(value) {
		details[field] = httpapi.InvalidTextMessage
	}
}

// toHTTPError maps the service's errors to the API's error responses.
// Anything it does not know stays as it is and becomes a 500.
func toHTTPError(err error) error {
	var pwErr *PasswordError
	switch {
	case errors.As(err, &pwErr):
		return httpapi.ValidationError("invalid request", map[string]any{"password": pwErr.Reason})
	case errors.Is(err, ErrEmailTaken):
		return errx.New(CodeEmailTaken, "an account with this email already exists").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"email": "is already registered; log in or reset the password"})
	case errors.Is(err, ErrInvalidText):
		return httpapi.ValidationError("invalid request", map[string]any{"body": httpapi.InvalidTextMessage})
	default:
		return err
	}
}

type dataResponse struct {
	Data any `json:"data"`
}
