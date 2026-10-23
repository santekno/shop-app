package httpapi_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestAuthErrors(t *testing.T) {
	u := httpapi.UnauthorizedError("log in again")
	testx.AssertEqual(t, u.Code, "UNAUTHORIZED")
	testx.AssertEqual(t, u.Message, "log in again")
	testx.AssertEqual(t, u.HTTPStatus, http.StatusUnauthorized)
	first, second := httpapi.UnauthorizedError("x"), httpapi.UnauthorizedError("x")
	testx.AssertTrue(t, first != second, "a new value each call")

	f := httpapi.ForbiddenError()
	testx.AssertEqual(t, f.Code, "FORBIDDEN")
	testx.AssertEqual(t, f.HTTPStatus, http.StatusForbidden)
	testx.AssertEqual(t, f.Message, "your role is not allowed to do this")

	rl := httpapi.RateLimitedError(42)
	testx.AssertEqual(t, rl.Code, "RATE_LIMITED")
	testx.AssertEqual(t, rl.HTTPStatus, http.StatusTooManyRequests)
	testx.AssertEqual(t, rl.Details["retry_after_seconds"], any(42))

	// All three are client errors: sent as they are, not turned into 500.
	for _, e := range []error{u, f, rl} {
		testx.AssertTrue(t, httpapi.ToAppError(e) == e, "%v", e) //nolint:errorlint // the very same value must come back, not a 500
	}
	testx.AssertEqual(t, httpapi.CodeUnauthorized, "UNAUTHORIZED")
	testx.AssertEqual(t, httpapi.CodeForbidden, "FORBIDDEN")
	testx.AssertEqual(t, httpapi.CodeRateLimited, "RATE_LIMITED")
}
