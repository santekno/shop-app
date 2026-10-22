// Package httpapi holds the HTTP helpers every handler shares: the JSON and
// error responses, the request timeout, and query validation. It keeps the
// API's one error body, {"error":{"code","message","details?"}}, in one place.
package httpapi

import (
	"net/http"

	"github.com/santekno/sdk/errx"
)

// Error codes the API sends. Clients branch on these, never on the message.
const (
	CodeTimeout = "TIMEOUT"
)

// The constructors below return a new *errx.AppError on every call, rather
// than sharing package-level values, because errx's WithDetail mutates the
// error it is called on.

// TimeoutError is 503 TIMEOUT: the request ran past the server's time limit.
func TimeoutError() *errx.AppError {
	return errx.New(CodeTimeout, "request timed out").WithHTTPStatus(http.StatusServiceUnavailable)
}
