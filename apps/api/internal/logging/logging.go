// Package logging sets up the API's structured logger (santekno/sdk logx on
// log/slog) and gives every request its own logger that already carries the
// request ID.
package logging

import (
	"context"
	"io"
	"net/http"

	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/logx"
)

// logx.Logger.WithContext only adds the fields of registered extractors, and
// logx registers none itself, so the request and user IDs that sdk
// middleware stores with ctxx are registered here. logx asks for this to
// happen at init time, before any logger is used concurrently.
func init() {
	logx.RegisterContextExtractor(stringField("request_id", ctxx.RequestID))
	logx.RegisterContextExtractor(stringField("user_id", ctxx.UserID))
}

func stringField(key string, get func(context.Context) string) logx.ContextExtractor {
	return func(ctx context.Context) (string, any, bool) {
		v := get(ctx)
		return key, v, v != ""
	}
}

// New returns the API's logger writing to out. Development gets slog's
// human-readable text format; every other environment gets one JSON object
// per line, which log platforms such as Railway's parse into fields.
func New(out io.Writer, development bool, level string) logx.Logger {
	return NewService(out, development, level, "api")
}

// NewService is New for another binary of the module: every line carries
// service=<service>, e.g. "worker".
func NewService(out io.Writer, development bool, level, service string) logx.Logger {
	format := "json"
	if development {
		format = "console"
	}
	return logx.New(
		logx.WithOutput(out),
		logx.WithFormat(format),
		logx.WithLevel(level),
		logx.WithFields("service", service),
	)
}

// Middleware stores a logger for the request in its context, derived from
// base with the request's ID (and, from Bab 4, user ID). Code further down
// gets it with logx.FromContext(ctx) and never has to pass IDs around.
//
// It must run after the middleware that sets the request ID.
func Middleware(base logx.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := logx.WithContextLogger(r.Context(), base.WithContext(r.Context()))
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
