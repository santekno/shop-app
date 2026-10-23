// Package httpapi holds the HTTP helpers every handler shares: the JSON and
// error responses, the request timeout, and query validation. It keeps the
// API's one error body, {"error":{"code","message","details?"}}, in one place.
package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/logx"
	sdkmw "github.com/santekno/sdk/middleware/chi"
)

// Error codes the API sends (see api/openapi.yaml). Clients branch on these,
// never on the message.
const (
	CodeNotFound         = "NOT_FOUND"
	CodeMethodNotAllowed = "METHOD_NOT_ALLOWED"
	CodeInternal         = "INTERNAL_ERROR" // the code sdk Recovery uses after a panic
	CodeTimeout          = "TIMEOUT"
	CodeUnauthorized     = "UNAUTHORIZED" // the code sdk middleware/chi JWTAuth uses
	CodeForbidden        = "FORBIDDEN"
	CodeRateLimited      = "RATE_LIMITED"
	// CodeUpstreamUnavailable is a 503 for a service the API depends on
	// that did not answer (the courier rates API). Unlike other 5xx errors
	// it is sent as it is: the client may retry, and the message names no
	// internals.
	CodeUpstreamUnavailable = "UPSTREAM_UNAVAILABLE"
)

// The constructors below return a new *errx.AppError on every call, rather
// than sharing package-level values, because errx's WithDetail mutates the
// error it is called on.

// NotFoundError is 404 NOT_FOUND with message, e.g. "product not found".
func NotFoundError(message string) *errx.AppError {
	return errx.New(CodeNotFound, message).WithHTTPStatus(http.StatusNotFound)
}

// UnauthorizedError is 401 UNAUTHORIZED: the request has no valid access
// token. The client refreshes its tokens or logs in again.
func UnauthorizedError(message string) *errx.AppError {
	return errx.New(CodeUnauthorized, message).WithHTTPStatus(http.StatusUnauthorized)
}

// ForbiddenError is 403 FORBIDDEN: the caller is known but their role may
// not do this.
func ForbiddenError() *errx.AppError {
	return errx.New(CodeForbidden, "your role is not allowed to do this").WithHTTPStatus(http.StatusForbidden)
}

// RateLimitedError is 429 RATE_LIMITED: too many attempts. The caller also
// sets Retry-After, and the same number of seconds is in details.
func RateLimitedError(retryAfterSeconds int) *errx.AppError {
	return errx.New(CodeRateLimited, "too many attempts; try again later").
		WithHTTPStatus(http.StatusTooManyRequests).
		WithDetails(map[string]any{"retry_after_seconds": retryAfterSeconds})
}

// MethodNotAllowedError is 405 METHOD_NOT_ALLOWED.
func MethodNotAllowedError() *errx.AppError {
	return errx.New(CodeMethodNotAllowed, "method not allowed").WithHTTPStatus(http.StatusMethodNotAllowed)
}

// InternalError is 500 INTERNAL_ERROR. Its message is deliberately generic:
// what went wrong is logged, never sent.
func InternalError() *errx.AppError {
	return errx.New(CodeInternal, "internal server error").WithHTTPStatus(http.StatusInternalServerError)
}

// TimeoutError is 503 TIMEOUT: the request ran past the server's time limit.
func TimeoutError() *errx.AppError {
	return errx.New(CodeTimeout, "request timed out").WithHTTPStatus(http.StatusServiceUnavailable)
}

// UpstreamUnavailableError is 503 UPSTREAM_UNAVAILABLE with message, which
// must name no internals: an outside service did not answer; retry later.
func UpstreamUnavailableError(message string) *errx.AppError {
	return errx.New(CodeUpstreamUnavailable, message).WithHTTPStatus(http.StatusServiceUnavailable)
}

// ToAppError decides what the client may see of err:
//
//   - an *errx.AppError with a 4xx status anywhere in the chain is sent as it
//     is: client errors are written for the client, with a safe message;
//   - a timeout (context.DeadlineExceeded, or TimeoutError itself) becomes
//     503 TIMEOUT;
//   - an UpstreamUnavailableError is sent as it is (503);
//   - anything else, including an AppError without a status or with a 5xx
//     one, becomes 500 INTERNAL_ERROR, so a driver message or an internal
//     address never reaches the response.
func ToAppError(err error) *errx.AppError {
	var appErr *errx.AppError
	if errors.As(err, &appErr) {
		if appErr.HTTPStatus >= 400 && appErr.HTTPStatus < 500 {
			return appErr
		}
		if appErr.Code == CodeTimeout {
			return TimeoutError()
		}
		if appErr.Code == CodeUpstreamUnavailable && appErr.HTTPStatus == http.StatusServiceUnavailable {
			return appErr
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return TimeoutError()
	}
	return InternalError()
}

// Error writes err as the API's error response. Server-side failures (5xx)
// are logged with the full error and the request's logger, which carries the
// request ID the client sees in X-Request-ID; client errors are not, because
// the access log already records their status, and a client that hung up
// (context.Canceled) is logged at info.
func Error(w http.ResponseWriter, r *http.Request, err error) {
	appErr := ToAppError(err)
	log := logx.FromContext(r.Context())
	switch {
	case errors.Is(err, context.Canceled):
		// The client hung up: not a server failure, so no ERROR line. The
		// usual 500 body is still written; nobody reads it, and writing to a
		// closed connection is harmless, so there is no special case below.
		log.Info("request canceled by the client", "method", r.Method, "path", r.URL.Path)
	case appErr.HTTPStatus >= http.StatusInternalServerError:
		cause := "<nil>"
		if err != nil {
			cause = err.Error()
		}
		log.Error("request failed",
			"code", appErr.Code, "error", cause, "method", r.Method, "path", r.URL.Path)
	}
	if appErr.Code == CodeUnauthorized {
		// RFC 6750: a 401 for a missing or unusable access token says which
		// scheme to use, so every UNAUTHORIZED carries it, from the guard
		// and from a handler that finds the account gone alike.
		w.Header().Set("WWW-Authenticate", `Bearer realm="goshop"`)
	}
	sdkmw.DefaultErrorWriter(w, r, appErr)
}
