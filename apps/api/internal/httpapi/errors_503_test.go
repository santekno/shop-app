package httpapi_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Bab 6 (ADR 0007): a 503 AppError is GoShop's own "try again later" or
// "switched off here" (UPSTREAM_UNAVAILABLE, PAYMENTS_DISABLED,
// STORAGE_DISABLED), built on purpose with a message for the client, so it
// passes through with its code. Every other 5xx still becomes 500.
func TestToAppError_503PassesThroughWithItsCode(t *testing.T) {
	disabled := errx.New("PAYMENTS_DISABLED", "payments are not configured on this server").
		WithHTTPStatus(http.StatusServiceUnavailable)
	tests := []struct {
		name       string
		err        error
		wantCode   string
		wantStatus int
		wantSame   *errx.AppError
	}{
		{name: "503 with its own code", err: disabled, wantCode: "PAYMENTS_DISABLED", wantStatus: 503, wantSame: disabled},
		{name: "wrapped 503", err: fmt.Errorf("pay: %w", disabled), wantCode: "PAYMENTS_DISABLED", wantStatus: 503, wantSame: disabled},
		{name: "upstream unavailable", err: httpapi.UpstreamUnavailableError("later"), wantCode: httpapi.CodeUpstreamUnavailable, wantStatus: 503},
		{name: "502 is internal", err: errx.New("BAD_GATEWAY", "proxy at 10.0.0.9").WithHTTPStatus(http.StatusBadGateway), wantCode: httpapi.CodeInternal, wantStatus: 500},
		{name: "500 is internal", err: errx.New("BOOM", "driver said x").WithHTTPStatus(http.StatusInternalServerError), wantCode: httpapi.CodeInternal, wantStatus: 500},
		{name: "504 is internal", err: errx.New("GATEWAY_TIMEOUT", "x").WithHTTPStatus(http.StatusGatewayTimeout), wantCode: httpapi.CodeInternal, wantStatus: 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := httpapi.ToAppError(tt.err)
			testx.AssertEqual(t, got.Code, tt.wantCode)
			testx.AssertEqual(t, got.HTTPStatus, tt.wantStatus)
			if tt.wantSame != nil {
				testx.AssertTrue(t, got == tt.wantSame, "the 503 must come back as it is")
			}
			if tt.wantStatus == 500 {
				testx.AssertEqual(t, got.Message, "internal server error")
			}
		})
	}
}

// What the client sees: the 503's code and message, never "internal".
func TestError_Writes503WithItsCode(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/v1/orders/x/pay", nil)
	httpapi.Error(rec, req, errx.New("STORAGE_DISABLED", "image storage is not configured on this server").
		WithHTTPStatus(http.StatusServiceUnavailable))
	testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable)
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	testx.AssertEqual(t, body.Error.Code, "STORAGE_DISABLED")
	testx.AssertEqual(t, body.Error.Message, "image storage is not configured on this server")
}

// A 503 for a feature the configuration switched off is the operator's
// choice, told at start: each request it refuses is a WARN. A timeout or
// an upstream that did not answer is a fault, logged at ERROR like any 5xx.
func TestError_LogLevelOf5xx(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantLevel string
		wantMsg   string
		wantCode  string
	}{
		{"payments off", errx.New("PAYMENTS_DISABLED", "off").WithHTTPStatus(http.StatusServiceUnavailable),
			"WARN", "request refused: switched off by configuration", "PAYMENTS_DISABLED"},
		{"storage off", fmt.Errorf("upload: %w", errx.New("STORAGE_DISABLED", "off").WithHTTPStatus(http.StatusServiceUnavailable)),
			"WARN", "request refused: switched off by configuration", "STORAGE_DISABLED"},
		{"timeout", httpapi.TimeoutError(), "ERROR", "request failed", httpapi.CodeTimeout},
		{"upstream unavailable", httpapi.UpstreamUnavailableError("later"), "ERROR", "request failed", httpapi.CodeUpstreamUnavailable},
		{"500", errors.New("pq: connection reset"), "ERROR", "request failed", httpapi.CodeInternal},
		{"502 becomes 500", errx.New("BAD_GATEWAY", "x").WithHTTPStatus(http.StatusBadGateway), "ERROR", "request failed", httpapi.CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, buf := requestWithLogger(http.MethodPost, "/v1/orders/x/pay")
			rec := httptest.NewRecorder()
			httpapi.Error(rec, r, tt.err)
			lines := logLines(t, buf)
			testx.AssertEqual(t, len(lines), 1, "one line per refused request: %s", buf.String())
			testx.AssertEqual(t, lines[0]["level"], any(tt.wantLevel))
			testx.AssertEqual(t, lines[0]["msg"], any(tt.wantMsg))
			testx.AssertEqual(t, lines[0]["code"], any(tt.wantCode))
			testx.AssertEqual(t, lines[0]["path"], any("/v1/orders/x/pay"))
			if tt.wantLevel == "WARN" {
				_, hasError := lines[0]["error"]
				testx.AssertFalse(t, hasError, "a switched-off feature is not an error: %v", lines[0])
			}
		})
	}
}
