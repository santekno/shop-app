package payment

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

const notifyPath = "/v1/payments/midtrans/notification"

// notificationBody is a notification as Midtrans sends it, with fields
// changed by change (a nil value drops the field).
func notificationBody(t *testing.T, change map[string]any) string {
	t.Helper()
	body := map[string]any{
		"order_id": providerOrderID, "status_code": "200", "gross_amount": "117000.00",
		"signature_key": "abc123sig", "transaction_status": "settlement", "transaction_id": "tx-1",
		"payment_type": "bank_transfer", "currency": "IDR", "fraud_status": "accept",
	}
	for k, v := range change {
		if v == nil {
			delete(body, k)
			continue
		}
		body[k] = v
	}
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestHandler_Notify(t *testing.T) {
	payer := &fakePayer{outcome: OutcomePaid}
	limiter := &fakeLimiter{}
	rec := serve(NewHandler(HandlerDeps{Payer: payer, Limiter: limiter}), http.MethodPost, notifyPath,
		notificationBody(t, map[string]any{"a_field_midtrans_adds_later": map[string]any{"x": 1}}))
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertEqual(t, decodeData(t, rec)["outcome"], any("paid"))
	testx.AssertEqual(t, len(payer.notifications), 1)
	testx.AssertEqual(t, payer.notifications[0], Notification{
		OrderID: providerOrderID, StatusCode: "200", GrossAmount: "117000.00", SignatureKey: "abc123sig",
	})
	testx.AssertEqual(t, len(limiter.checks), 1)
	testx.AssertEqual(t, limiter.checks[0], "payment-notification-ip:203.0.113.7")
}

// Every outcome is 200, so Midtrans stops sending.
func TestHandler_Notify_Outcomes(t *testing.T) {
	for _, o := range []Outcome{OutcomeRecorded, OutcomeDuplicate, OutcomeAmountMismatch, OutcomeRefundRequired, OutcomeOrderCancelled} {
		payer := &fakePayer{outcome: o}
		rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, notifyPath, notificationBody(t, nil))
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		testx.AssertEqual(t, decodeData(t, rec)["outcome"], any(string(o)))
	}
}

func TestHandler_Notify_InvalidFields(t *testing.T) {
	long := strings.Repeat("a", 257)
	for _, field := range []string{"order_id", "status_code", "gross_amount", "signature_key"} {
		tests := []struct {
			name  string
			value any
		}{
			{"missing", nil},
			{"empty", ""},
			{"longer than 256", long},
			{"NUL", "abc\u0000def"},
		}
		for _, tc := range tests {
			t.Run(field+"/"+tc.name, func(t *testing.T) {
				var body string
				if tc.value == nil {
					body = notificationBody(t, map[string]any{field: nil})
				} else {
					body = notificationBody(t, map[string]any{field: tc.value})
				}
				payer := &fakePayer{outcome: OutcomePaid}
				rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, notifyPath, body)
				b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
				testx.AssertEqual(t, len(b.Error.Details), 1, "details %v", b.Error.Details)
				_, named := b.Error.Details[field]
				testx.AssertTrue(t, named, "details %v name %s", b.Error.Details, field)
				testx.AssertEqual(t, len(payer.calls), 0, "the service is not called")
			})
		}
		t.Run(field+"/256 characters", func(t *testing.T) {
			payer := &fakePayer{outcome: OutcomePaid}
			rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, notifyPath,
				notificationBody(t, map[string]any{field: strings.Repeat("7", 256)}))
			testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
		})
	}
	t.Run("every bad field is named", func(t *testing.T) {
		payer := &fakePayer{}
		rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, notifyPath, `{}`)
		b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, len(b.Error.Details), 4, "details %v", b.Error.Details)
	})
}

func TestHandler_Notify_BadBody(t *testing.T) {
	for name, body := range map[string]string{
		"not JSON":     "order_id=1&status_code=200",
		"empty":        "",
		"a JSON array": `[{"order_id":"x"}]`,
		"wrong type":   `{"order_id": 5}`,
	} {
		t.Run(name, func(t *testing.T) {
			payer := &fakePayer{}
			rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, notifyPath, body)
			b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
			testx.AssertEqual(t, b.Error.Details["body"], any("must be a JSON object of at most 64 KiB"))
			testx.AssertEqual(t, len(payer.calls), 0)
		})
	}
}

// A body is read up to MaxNotificationBytes; Midtrans' unknown fields
// count towards it.
func TestHandler_Notify_BodyLimit(t *testing.T) {
	testx.AssertEqual(t, MaxNotificationBytes, 64*1024)
	padded := func(size int) string {
		base := notificationBody(t, map[string]any{"padding": ""})
		body := strings.Replace(base, `"padding":""`, `"padding":"`+strings.Repeat("x", size-len(base))+`"`, 1)
		testx.AssertEqual(t, len(body), size)
		return body
	}
	for _, tc := range []struct {
		size int
		ok   bool
	}{
		{MaxNotificationBytes - 1, true},
		{MaxNotificationBytes, true},
		{MaxNotificationBytes + 1, false},
		{2 * MaxNotificationBytes, false},
	} {
		t.Run(fmt.Sprint(tc.size), func(t *testing.T) {
			payer := &fakePayer{outcome: OutcomeRecorded}
			rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, notifyPath, padded(tc.size))
			if tc.ok {
				testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
				testx.AssertEqual(t, len(payer.calls), 1)
				return
			}
			b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
			_, named := b.Error.Details["body"]
			testx.AssertTrue(t, named, "details %v", b.Error.Details)
			testx.AssertEqual(t, len(payer.calls), 0, "the service is not called")
		})
	}
}

func TestHandler_Notify_Errors(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"bad signature", ErrInvalidSignature, http.StatusForbidden, CodeInvalidSignature},
		{"unknown payment", ErrPaymentNotFound, http.StatusNotFound, httpapi.CodeNotFound},
		{"status API down", fmt.Errorf("%w: %w", ErrGatewayUnavailable, ErrTransactionNotFound), http.StatusServiceUnavailable, httpapi.CodeUpstreamUnavailable},
		{"database", errBoom, http.StatusInternalServerError, httpapi.CodeInternal},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			payer := &fakePayer{notifyErr: tc.err}
			rec := serve(NewHandler(HandlerDeps{Payer: payer}), http.MethodPost, notifyPath, notificationBody(t, nil))
			assertError(t, rec, tc.status, tc.code)
			testx.AssertEqual(t, len(payer.calls), 1)
		})
	}
}

func TestHandler_Notify_RateLimited(t *testing.T) {
	payer := &fakePayer{outcome: OutcomePaid}
	limiter := &fakeLimiter{refuse: map[string]bool{"payment-notification-ip": true}}
	rec := serve(NewHandler(HandlerDeps{Payer: payer, Limiter: limiter}), http.MethodPost, notifyPath, notificationBody(t, nil))
	assertError(t, rec, http.StatusTooManyRequests, httpapi.CodeRateLimited)
	testx.AssertEqual(t, rec.Header().Get("Retry-After"), "42")
	testx.AssertEqual(t, len(payer.calls), 0, "the service is not called")

	// A limiter that fails is a 500, not a pass.
	limiter = &fakeLimiter{err: errBoom}
	rec = serve(NewHandler(HandlerDeps{Payer: payer, Limiter: limiter}), http.MethodPost, notifyPath, notificationBody(t, nil))
	assertError(t, rec, http.StatusInternalServerError, httpapi.CodeInternal)
	testx.AssertEqual(t, len(payer.calls), 0)
}
