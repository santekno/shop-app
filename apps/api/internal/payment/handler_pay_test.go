package payment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/order"
)

// Handler test helpers (first needed by Bab 6 artikel 02).

// fakePayer is the handler's Payer: it records each call and answers from
// its fields.
type fakePayer struct {
	calls []string

	payment Payment
	created bool
	payErr  error

	outcome       Outcome
	notifyErr     error
	notifications []Notification
}

func (p *fakePayer) Pay(_ context.Context, buyer, id string) (Payment, bool, error) {
	p.calls = append(p.calls, "Pay "+buyer+" "+id)
	return p.payment, p.created, p.payErr
}

func (p *fakePayer) ClientKey() string { return "SB-Mid-client-abc" }

func (p *fakePayer) HandleNotification(_ context.Context, n Notification) (Outcome, error) {
	p.calls = append(p.calls, "HandleNotification")
	p.notifications = append(p.notifications, n)
	return p.outcome, p.notifyErr
}

// fakeLimiter refuses the limits named in refuse, fails with err, and
// records each check as "<limit>:<key>".
type fakeLimiter struct {
	refuse map[string]bool
	err    error
	checks []string
}

func (l *fakeLimiter) Allow(_ context.Context, limit auth.Limit, key string) (bool, time.Duration, error) {
	l.checks = append(l.checks, limit.Name+":"+key)
	if l.err != nil {
		return false, 0, l.err
	}
	if l.refuse[limit.Name] {
		return false, 42 * time.Second, nil
	}
	return true, 0, nil
}

// serve sends method path with body through a router carrying both the
// public and the protected routes, as the buyer.
func serve(h *Handler, method, path, body string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Route("/v1", func(r chi.Router) {
		h.Routes(r)
		h.ProtectedRoutes(r)
	})
	ctx := ctxx.WithUserID(context.Background(), buyerID)
	req := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(body))
	req.RemoteAddr = "203.0.113.7:51234"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func assertError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) errorBody {
	t.Helper()
	testx.AssertEqual(t, rec.Code, status, "body %s", rec.Body.String())
	var b errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	testx.AssertEqual(t, b.Error.Code, code, "body %s", rec.Body.String())
	return b
}

func decodeData(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var b struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return b.Data
}

var payPath = "/v1/orders/" + orderID + "/pay"

func TestHandler_Pay(t *testing.T) {
	jakarta := time.FixedZone("WIB", 7*3600)
	p := testPayment()
	p.ExpiresAt = time.Date(2026, 10, 24, 17, 59, 0, 0, jakarta)
	p.CreatedAt = time.Date(2026, 10, 24, 17, 0, 0, 0, jakarta)
	tests := []struct {
		name    string
		created bool
		status  int
	}{
		{"created now", true, http.StatusCreated},
		{"the open one again", false, http.StatusOK},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			payer := &fakePayer{payment: p, created: tc.created}
			limiter := &fakeLimiter{}
			rec := serve(NewHandler(HandlerDeps{Payer: payer, Limiter: limiter}), http.MethodPost, payPath, "")
			testx.AssertEqual(t, rec.Code, tc.status, "body %s", rec.Body.String())
			testx.AssertEqual(t, len(payer.calls), 1)
			testx.AssertEqual(t, payer.calls[0], "Pay "+buyerID+" "+orderID)
			testx.AssertEqual(t, len(limiter.checks), 1)
			testx.AssertEqual(t, limiter.checks[0], "pay-user:"+buyerID)

			d := decodeData(t, rec)
			testx.AssertEqual(t, d["id"], any(paymentID))
			testx.AssertEqual(t, d["order_id"], any(orderID))
			testx.AssertEqual(t, d["provider"], any("midtrans"))
			testx.AssertEqual(t, d["status"], any("pending"))
			testx.AssertEqual(t, d["token"], any("snap-token-1"))
			testx.AssertEqual(t, d["redirect_url"], any(p.RedirectURL))
			testx.AssertEqual(t, d["client_key"], any("SB-Mid-client-abc"))
			testx.AssertEqual(t, d["expires_at"], any("2026-10-24T10:59:00Z"))
			testx.AssertEqual(t, d["created_at"], any("2026-10-24T10:00:00Z"))
			amount, ok := d["amount"].(map[string]any)
			testx.AssertTrue(t, ok, "amount %v", d["amount"])
			testx.AssertEqual(t, amount["amount"], any(float64(117000)))
			testx.AssertEqual(t, amount["currency"], any("IDR"))
		})
	}
}

func TestHandler_Pay_InvalidID(t *testing.T) {
	payer := &fakePayer{}
	limiter := &fakeLimiter{}
	rec := serve(NewHandler(HandlerDeps{Payer: payer, Limiter: limiter}), http.MethodPost, "/v1/orders/not-a-uuid/pay", "")
	assertError(t, rec, http.StatusNotFound, httpapi.CodeNotFound)
	testx.AssertEqual(t, len(payer.calls), 0)
	testx.AssertEqual(t, len(limiter.checks), 0)
}

func TestHandler_Pay_RateLimited(t *testing.T) {
	payer := &fakePayer{payment: testPayment(), created: true}
	limiter := &fakeLimiter{refuse: map[string]bool{"pay-user": true}}
	rec := serve(NewHandler(HandlerDeps{Payer: payer, Limiter: limiter}), http.MethodPost, payPath, "")
	assertError(t, rec, http.StatusTooManyRequests, httpapi.CodeRateLimited)
	testx.AssertEqual(t, rec.Header().Get("Retry-After"), "42")
	testx.AssertEqual(t, len(payer.calls), 0, "the service is not called")

	// No limiter counts nothing.
	rec = serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, payPath, "")
	testx.AssertEqual(t, rec.Code, http.StatusCreated)
}

// Every service error has its answer.
func TestHandler_Pay_Errors(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"order not found", ErrOrderNotFound, http.StatusNotFound, httpapi.CodeNotFound},
		{"window closed", ErrWindowClosed, http.StatusConflict, CodeWindowClosed},
		{"invalid signature", ErrInvalidSignature, http.StatusForbidden, CodeInvalidSignature},
		{"payment not found", ErrPaymentNotFound, http.StatusNotFound, httpapi.CodeNotFound},
		{"gateway unavailable", fmt.Errorf("pay order x: %w", ErrGatewayUnavailable), http.StatusServiceUnavailable, httpapi.CodeUpstreamUnavailable},
		{"anything else", errBoom, http.StatusInternalServerError, httpapi.CodeInternal},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			payer := &fakePayer{payErr: tc.err}
			rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, payPath, "")
			b := assertError(t, rec, tc.status, tc.code)
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "boom"), "no internals in %s", rec.Body.String())
			testx.AssertNotEqual(t, b.Error.Message, "")
		})
	}
	t.Run("not payable", func(t *testing.T) {
		payer := &fakePayer{payErr: &NotPayableError{Status: "cancelled"}}
		rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, payPath, "")
		b := assertError(t, rec, http.StatusConflict, order.CodeInvalidTransition)
		testx.AssertEqual(t, b.Error.Details["status"], any("cancelled"))
		testx.AssertEqual(t, b.Error.Details["to"], any("paid"))
	})
}

// toHTTPError maps each service error to its AppError, wrapped or not.
func TestToHTTPError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"disabled", ErrDisabled, http.StatusServiceUnavailable, CodeDisabled},
		{"order not found", fmt.Errorf("x: %w", ErrOrderNotFound), http.StatusNotFound, httpapi.CodeNotFound},
		{"not payable", fmt.Errorf("x: %w", &NotPayableError{Status: "paid"}), http.StatusConflict, order.CodeInvalidTransition},
		{"window closed", ErrWindowClosed, http.StatusConflict, CodeWindowClosed},
		{"invalid signature", ErrInvalidSignature, http.StatusForbidden, CodeInvalidSignature},
		{"payment not found", ErrPaymentNotFound, http.StatusNotFound, httpapi.CodeNotFound},
		{"gateway unavailable", fmt.Errorf("%w: %w", ErrGatewayUnavailable, ErrTransactionNotFound), http.StatusServiceUnavailable, httpapi.CodeUpstreamUnavailable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var appErr *errx.AppError
			testx.AssertTrue(t, errors.As(toHTTPError(tc.err), &appErr), "not an AppError")
			testx.AssertEqual(t, appErr.HTTPStatus, tc.status)
			testx.AssertEqual(t, appErr.Code, tc.code)
		})
	}
	testx.AssertTrue(t, errors.Is(toHTTPError(errBoom), errBoom), "unknown errors pass through")
}

func TestLimits(t *testing.T) {
	testx.AssertEqual(t, LimitPayPerBuyer, auth.Limit{Name: "pay-user", Max: 10, Window: time.Minute})
	testx.AssertEqual(t, LimitNotificationPerIP, auth.Limit{Name: "payment-notification-ip", Max: 120, Window: time.Minute})
	testx.AssertEqual(t, len(Limits), 2)
	testx.AssertEqual(t, Limits[0], LimitPayPerBuyer)
	testx.AssertEqual(t, Limits[1], LimitNotificationPerIP)
}
