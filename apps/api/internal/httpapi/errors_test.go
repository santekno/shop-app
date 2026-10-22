package httpapi_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestErrorConstructors(t *testing.T) {
	tests := []struct {
		name        string
		make        func() *errx.AppError
		wantCode    string
		wantStatus  int
		wantMessage string
	}{
		{"NotFoundError", func() *errx.AppError { return httpapi.NotFoundError("product not found") }, httpapi.CodeNotFound, http.StatusNotFound, "product not found"},
		{"MethodNotAllowedError", httpapi.MethodNotAllowedError, httpapi.CodeMethodNotAllowed, http.StatusMethodNotAllowed, "method not allowed"},
		{"InternalError", httpapi.InternalError, httpapi.CodeInternal, http.StatusInternalServerError, "internal server error"},
		{"TimeoutError", httpapi.TimeoutError, httpapi.CodeTimeout, http.StatusServiceUnavailable, "request timed out"},
		{"ValidationError", func() *errx.AppError { return httpapi.ValidationError("invalid request", nil) }, httpapi.CodeValidationFailed, http.StatusBadRequest, "invalid request"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			first := tt.make()
			testx.AssertEqual(t, first.Code, tt.wantCode)
			testx.AssertEqual(t, first.HTTPStatus, tt.wantStatus)
			testx.AssertEqual(t, first.Message, tt.wantMessage)
			testx.AssertEqual(t, len(first.Details), 0)

			// errx's WithDetail mutates its receiver, so each call must hand
			// out a new value or one request's details leak into the next.
			_ = first.WithDetail("leak", true)
			second := tt.make()
			testx.AssertTrue(t, first != second, "constructor returned a shared value")
			testx.AssertEqual(t, len(second.Details), 0, "details leaked between calls")
		})
	}
}

func TestToAppError(t *testing.T) {
	notFound := httpapi.NotFoundError("product not found")
	conflict := errx.New("CONFLICT", "slug taken").WithHTTPStatus(http.StatusConflict)
	tests := []struct {
		name       string
		err        error
		wantCode   string
		wantStatus int
		wantSame   *errx.AppError // the 4xx error passed through unchanged
	}{
		{name: "4xx passes through", err: notFound, wantCode: httpapi.CodeNotFound, wantStatus: 404, wantSame: notFound},
		{name: "wrapped 4xx passes through", err: fmt.Errorf("get product: %w", conflict), wantCode: "CONFLICT", wantStatus: 409, wantSame: conflict},
		{name: "400 lower bound", err: errx.New("BAD", "bad").WithHTTPStatus(400), wantCode: "BAD", wantStatus: 400},
		{name: "499 upper bound", err: errx.New("CLOSED", "closed").WithHTTPStatus(499), wantCode: "CLOSED", wantStatus: 499},
		{name: "TimeoutError", err: httpapi.TimeoutError(), wantCode: httpapi.CodeTimeout, wantStatus: 503},
		{name: "wrapped TimeoutError", err: fmt.Errorf("x: %w", httpapi.TimeoutError()), wantCode: httpapi.CodeTimeout, wantStatus: 503},
		{name: "TIMEOUT code without status", err: errx.New(httpapi.CodeTimeout, "slow"), wantCode: httpapi.CodeTimeout, wantStatus: 503},
		{name: "DeadlineExceeded", err: context.DeadlineExceeded, wantCode: httpapi.CodeTimeout, wantStatus: 503},
		{name: "wrapped DeadlineExceeded", err: fmt.Errorf("query: %w", context.DeadlineExceeded), wantCode: httpapi.CodeTimeout, wantStatus: 503},
		{name: "Canceled is internal", err: context.Canceled, wantCode: httpapi.CodeInternal, wantStatus: 500},
		{name: "plain error", err: errors.New("pq: password authentication failed"), wantCode: httpapi.CodeInternal, wantStatus: 500},
		{name: "AppError with 5xx", err: errx.New("DB_DOWN", "db at 10.0.0.5 down").WithHTTPStatus(502), wantCode: httpapi.CodeInternal, wantStatus: 500},
		{name: "AppError without status", err: errx.New("SECRET", "leaky message"), wantCode: httpapi.CodeInternal, wantStatus: 500},
		{name: "AppError with 3xx", err: errx.New("MOVED", "moved").WithHTTPStatus(301), wantCode: httpapi.CodeInternal, wantStatus: 500},
		{name: "nil", err: nil, wantCode: httpapi.CodeInternal, wantStatus: 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := httpapi.ToAppError(tt.err)
			if got == nil {
				t.Fatal("ToAppError returned nil")
			}
			testx.AssertEqual(t, got.Code, tt.wantCode)
			testx.AssertEqual(t, got.HTTPStatus, tt.wantStatus)
			if tt.wantSame != nil {
				testx.AssertTrue(t, got == tt.wantSame, "4xx error must be returned as is")
			}
			if tt.wantCode == httpapi.CodeInternal {
				testx.AssertEqual(t, got.Message, "internal server error")
			}
		})
	}
}

func TestError(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		wantStatus  int
		wantCode    string
		wantMessage string
		wantDetails map[string]any
		wantLog     string // the "error" field logged; "" when nothing is logged
	}{
		{
			name:        "4xx with details, not logged",
			err:         httpapi.ValidationError("invalid query parameters", map[string]any{"limit": "must be an integer"}),
			wantStatus:  400,
			wantCode:    httpapi.CodeValidationFailed,
			wantMessage: "invalid query parameters",
			wantDetails: map[string]any{"limit": "must be an integer"},
		},
		{
			name:        "404, not logged",
			err:         httpapi.NotFoundError("route not found"),
			wantStatus:  404,
			wantCode:    httpapi.CodeNotFound,
			wantMessage: "route not found",
		},
		{
			name:        "internal error is logged with its cause, sent generic",
			err:         errors.New("dial tcp 10.0.0.5:5432: refused"),
			wantStatus:  500,
			wantCode:    httpapi.CodeInternal,
			wantMessage: "internal server error",
			wantLog:     "dial tcp 10.0.0.5:5432: refused",
		},
		{
			name:        "timeout is logged",
			err:         context.DeadlineExceeded,
			wantStatus:  503,
			wantCode:    httpapi.CodeTimeout,
			wantMessage: "request timed out",
			wantLog:     "context deadline exceeded",
		},
		{
			name:        "nil error is logged as <nil>",
			err:         nil,
			wantStatus:  500,
			wantCode:    httpapi.CodeInternal,
			wantMessage: "internal server error",
			wantLog:     "<nil>",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, logs := requestWithLogger(http.MethodGet, "/v1/products?limit=x")
			rec := httptest.NewRecorder()

			httpapi.Error(rec, r, tt.err)

			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			testx.AssertEqual(t, rec.Header().Get("Content-Type"), "application/json; charset=utf-8")
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			testx.AssertEqual(t, body.Error.Message, tt.wantMessage)
			testx.AssertEqual(t, fmt.Sprint(body.Error.Details), fmt.Sprint(tt.wantDetails))
			if tt.err != nil && tt.wantLog != "" {
				testx.AssertFalse(t, strings.Contains(rec.Body.String(), tt.err.Error()),
					"cause leaked into the response: %s", rec.Body.String())
			}

			lines := logLines(t, logs)
			if tt.wantLog == "" {
				testx.AssertEqual(t, len(lines), 0, "client errors are not logged: %v", lines)
				return
			}
			if len(lines) != 1 {
				t.Fatalf("want 1 log line, got %d: %v", len(lines), lines)
			}
			line := lines[0]
			testx.AssertEqual(t, line["level"], any("ERROR"))
			testx.AssertEqual(t, line["msg"], any("request failed"))
			testx.AssertEqual(t, line["code"], any(tt.wantCode))
			testx.AssertEqual(t, line["error"], any(tt.wantLog))
			testx.AssertEqual(t, line["method"], any("GET"))
			testx.AssertEqual(t, line["path"], any("/v1/products"))
		})
	}
}

// A client that hung up is not a server failure: it is logged at INFO, so
// it never pages anyone, and the usual 500 body is still written.
func TestError_ClientCanceled(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{name: "context.Canceled", err: context.Canceled},
		{name: "wrapped", err: fmt.Errorf("list categories: %w", context.Canceled)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, logs := requestWithLogger(http.MethodGet, "/v1/categories")
			rec := httptest.NewRecorder()

			httpapi.Error(rec, r, tt.err)

			testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, httpapi.CodeInternal)
			testx.AssertEqual(t, body.Error.Message, "internal server error")

			lines := logLines(t, logs)
			if len(lines) != 1 {
				t.Fatalf("want 1 log line, got %d: %v", len(lines), lines)
			}
			testx.AssertEqual(t, lines[0]["level"], any("INFO"))
			testx.AssertEqual(t, lines[0]["msg"], any("request canceled by the client"))
			testx.AssertEqual(t, lines[0]["method"], any("GET"))
			testx.AssertEqual(t, lines[0]["path"], any("/v1/categories"))
		})
	}
}
