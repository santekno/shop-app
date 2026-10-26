package payment

import (
	"net/http"
	"testing"
)

// With payments off (no gateway), both payment routes answer 503
// PAYMENTS_DISABLED (ADR 0007, api/openapi.yaml PaymentUnavailable), not
// 500: httpapi.ToAppError passes every 503 AppError through with its code.
func TestHandler_PaymentsDisabledAnswers503(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		payer            *fakePayer
	}{
		{"pay", payPath, "", &fakePayer{payErr: ErrDisabled}},
		{"notification", notifyPath, "", &fakePayer{notifyErr: ErrDisabled}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := tc.body
			if tc.path == notifyPath {
				body = notificationBody(t, nil)
			}
			rec := serve(NewHandler(HandlerDeps{Payer: tc.payer}), http.MethodPost, tc.path, body)
			assertError(t, rec, http.StatusServiceUnavailable, CodeDisabled)
		})
	}
}
