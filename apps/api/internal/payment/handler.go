package payment

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
	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/order"
)

// The codes this feature adds (see api/openapi.yaml).
const (
	CodeDisabled     = "PAYMENTS_DISABLED"
	CodeWindowClosed = "PAYMENT_WINDOW_CLOSED"
)

// LimitPayPerBuyer bounds how often one buyer may ask for a payment page:
// every new one is a call to Midtrans (OWASP API4).
var LimitPayPerBuyer = auth.Limit{Name: "pay-user", Max: 10, Window: time.Minute}

// Limits lists the payment limits, for auth.NewRedisRateLimiter.
var Limits = []auth.Limit{LimitPayPerBuyer}

// Payer is what the buyer's payment handler needs from the service.
type Payer interface {
	Pay(ctx context.Context, buyerID, orderID string) (Payment, bool, error)
	ClientKey() string
}

// Handler serves the payment endpoints.
type Handler struct {
	payer   Payer
	limiter auth.RateLimiter
}

// HandlerDeps is what the handler needs.
type HandlerDeps struct {
	Payer Payer
	// Limiter counts the per-buyer and per-IP limits; nil counts nothing
	// (a seam for handler tests; internal/app always sets it).
	Limiter auth.RateLimiter
}

// NewHandler returns a Handler.
func NewHandler(deps HandlerDeps) *Handler {
	return &Handler{payer: deps.Payer, limiter: deps.Limiter}
}

// ProtectedRoutes registers the buyer's routes on r (under /v1, behind
// auth).
func (h *Handler) ProtectedRoutes(r chi.Router) {
	r.Post("/orders/{id}/pay", h.Pay)
}

// Pay serves POST /v1/orders/{id}/pay: the buyer's Snap payment page for
// their unpaid order, 201 when it was created now and 200 when the open
// one is returned again. The request has no body: the amount is the
// order's total.
func (h *Handler) Pay(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toHTTPError(ErrOrderNotFound))
		return
	}
	buyerID := ctxx.UserID(r.Context())
	if h.limiter != nil && !auth.Allow(w, r, h.limiter, LimitPayPerBuyer, buyerID) {
		return
	}
	p, created, err := h.payer.Pay(r.Context(), buyerID, id)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	httpapi.JSON(w, r, status, dataResponse{Data: toSessionJSON(p, h.payer.ClientKey())})
}

// toHTTPError maps the service's errors to the API's error responses.
func toHTTPError(err error) error {
	var notPayable *NotPayableError
	switch {
	case errors.Is(err, ErrDisabled):
		return errx.New(CodeDisabled, "payments are not configured on this server").
			WithHTTPStatus(http.StatusServiceUnavailable)
	case errors.Is(err, ErrOrderNotFound):
		return httpapi.NotFoundError("order not found")
	case errors.As(err, &notPayable):
		// The same answer as any other move the order cannot make now.
		return errx.New(order.CodeInvalidTransition, "the order cannot make this change in its current status").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"status": notPayable.Status, "to": string(order.StatusPaid)})
	case errors.Is(err, ErrWindowClosed):
		return errx.New(CodeWindowClosed, "the payment deadline of this order is too close to start a payment").
			WithHTTPStatus(http.StatusConflict)
	case errors.Is(err, ErrGatewayUnavailable):
		return httpapi.UpstreamUnavailableError("the payment service is not answering; try again shortly")
	default:
		return err
	}
}

type dataResponse struct {
	Data any `json:"data"`
}

// sessionJSON is PaymentSession in api/openapi.yaml.
type sessionJSON struct {
	ID          string         `json:"id"`
	OrderID     string         `json:"order_id"`
	Provider    string         `json:"provider"`
	Status      string         `json:"status"`
	Amount      cart.MoneyJSON `json:"amount"`
	Token       string         `json:"token"`
	RedirectURL string         `json:"redirect_url"`
	ClientKey   string         `json:"client_key"`
	ExpiresAt   time.Time      `json:"expires_at"`
	CreatedAt   time.Time      `json:"created_at"`
}

func toSessionJSON(p Payment, clientKey string) sessionJSON {
	return sessionJSON{
		ID: p.ID, OrderID: p.OrderID, Provider: p.Provider, Status: string(p.Status), Amount: cart.Rupiah(p.Amount),
		Token: p.Token, RedirectURL: p.RedirectURL, ClientKey: clientKey,
		ExpiresAt: p.ExpiresAt.UTC(), CreatedAt: p.CreatedAt.UTC(),
	}
}
