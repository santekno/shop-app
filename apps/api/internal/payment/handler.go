package payment

import (
	"context"
	"encoding/json"
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
	CodeDisabled         = "PAYMENTS_DISABLED"
	CodeWindowClosed     = "PAYMENT_WINDOW_CLOSED"
	CodeInvalidSignature = "INVALID_SIGNATURE"
)

// MaxNotificationBytes bounds a notification body: Midtrans sends about
// 1 KiB.
const MaxNotificationBytes = 64 << 10

// LimitPayPerBuyer bounds how often one buyer may ask for a payment page:
// every new one is a call to Midtrans (OWASP API4).
var LimitPayPerBuyer = auth.Limit{Name: "pay-user", Max: 10, Window: time.Minute}

// LimitNotificationPerIP bounds the public notification route per client
// IP: Midtrans sends a few per payment, and each costs a status call to
// Midtrans (OWASP API4).
var LimitNotificationPerIP = auth.Limit{Name: "payment-notification-ip", Max: 120, Window: time.Minute}

// Limits lists the payment limits, for auth.NewRedisRateLimiter.
var Limits = []auth.Limit{LimitPayPerBuyer, LimitNotificationPerIP}

// Payer is what the payment handlers need from the service.
type Payer interface {
	Pay(ctx context.Context, buyerID, orderID string) (Payment, bool, error)
	ClientKey() string
	HandleNotification(ctx context.Context, n Notification) (Outcome, error)
}

// Handler serves the payment endpoints.
type Handler struct {
	payer       Payer
	limiter     auth.RateLimiter
	trustedHops int
}

// HandlerDeps is what the handler needs.
type HandlerDeps struct {
	Payer Payer
	// Limiter counts the per-buyer and per-IP limits; nil counts nothing
	// (a seam for handler tests; internal/app always sets it).
	Limiter auth.RateLimiter
	// TrustedProxyHops is APP_TRUSTED_PROXY_HOPS, for the client IP.
	TrustedProxyHops int
}

// NewHandler returns a Handler.
func NewHandler(deps HandlerDeps) *Handler {
	return &Handler{payer: deps.Payer, limiter: deps.Limiter, trustedHops: deps.TrustedProxyHops}
}

// Routes registers the public routes on r (under /v1): the gateway's
// notification, which Midtrans calls without a GoShop token.
func (h *Handler) Routes(r chi.Router) {
	r.Post("/payments/midtrans/notification", h.Notify)
}

// notifyResponse is NotificationResult in api/openapi.yaml.
type notifyResponse struct {
	Outcome string `json:"outcome"`
}

// Notify serves POST /v1/payments/midtrans/notification (ADR 0007). The
// body is only a hint: its signature must check, and then the status
// comes from Midtrans' status API. 200 whatever GoShop did with it, so
// Midtrans stops sending it; 403 for a bad signature, 503 when Midtrans'
// status API did not answer (Midtrans sends the notification again).
func (h *Handler) Notify(w http.ResponseWriter, r *http.Request) {
	ip := httpapi.RateLimitKey(httpapi.ClientIP(r, h.trustedHops))
	if h.limiter != nil && !auth.Allow(w, r, h.limiter, LimitNotificationPerIP, ip) {
		return
	}
	var n Notification
	if err := decodeNotification(w, r, &n); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	outcome, err := h.payer.HandleNotification(r.Context(), n)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: notifyResponse{Outcome: string(outcome)}})
}

// decodeNotification reads a notification body: at most
// MaxNotificationBytes, one JSON object. Unknown fields are allowed (unlike
// GoShop's own bodies): Midtrans sends many, and adds new ones.
func decodeNotification(w http.ResponseWriter, r *http.Request, n *Notification) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxNotificationBytes))
	if err := dec.Decode(n); err != nil {
		return httpapi.ValidationError("invalid notification", map[string]any{"body": "must be a JSON object of at most 64 KiB"})
	}
	missing := map[string]any{}
	for field, value := range map[string]string{
		"order_id": n.OrderID, "status_code": n.StatusCode, "gross_amount": n.GrossAmount, "signature_key": n.SignatureKey,
	} {
		if value == "" || len(value) > 256 || !httpapi.ValidText(value) {
			missing[field] = "is required: 1 to 256 characters of text"
		}
	}
	if len(missing) > 0 {
		return httpapi.ValidationError("invalid notification", missing)
	}
	return nil
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
	case errors.Is(err, ErrInvalidSignature):
		return errx.New(CodeInvalidSignature, "the notification signature is not valid").
			WithHTTPStatus(http.StatusForbidden)
	case errors.Is(err, ErrPaymentNotFound):
		return httpapi.NotFoundError("payment not found")
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
