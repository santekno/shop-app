package httpapi_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// RFC 6750: every UNAUTHORIZED tells the client to use a Bearer token,
// whoever wrote the 401; no other error asks for credentials.
func TestError_WWWAuthenticate(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		want   string
	}{
		{name: "unauthorized", err: httpapi.UnauthorizedError("log in again"), status: http.StatusUnauthorized, want: `Bearer realm="goshop"`},
		{name: "unauthorized, wrapped", err: errors.Join(errors.New("ctx"), httpapi.UnauthorizedError("x")), status: http.StatusUnauthorized, want: `Bearer realm="goshop"`},
		{name: "another 401 code", err: errx.New("INVALID_CREDENTIALS", "no").WithHTTPStatus(http.StatusUnauthorized), status: http.StatusUnauthorized},
		{name: "forbidden", err: httpapi.ForbiddenError(), status: http.StatusForbidden},
		{name: "not found", err: httpapi.NotFoundError("nope"), status: http.StatusNotFound},
		{name: "rate limited", err: httpapi.RateLimitedError(3), status: http.StatusTooManyRequests},
		{name: "validation", err: httpapi.ValidationError("bad", map[string]any{"a": "b"}), status: http.StatusBadRequest},
		{name: "internal", err: errors.New("boom"), status: http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			httpapi.Error(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil), tt.err)
			testx.AssertEqual(t, rec.Code, tt.status)
			testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), tt.want)
		})
	}
}
