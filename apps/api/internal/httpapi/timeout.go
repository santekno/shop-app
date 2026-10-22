package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
	sdkmw "github.com/santekno/sdk/middleware/chi"
)

// Timeout gives every request a deadline d away. Handlers see it through
// r.Context(), so work that honours the context (a database query from Bab 3)
// is cancelled when the deadline passes. If the handler then returns without
// having written anything, the client gets 503 TIMEOUT in the API's error
// shape.
//
// chi's middleware.Timeout is not used because it answers with a bare 504 and
// no body, and http.TimeoutHandler buffers the whole response and sends its
// timeout body as text/plain; both would break the one-error-shape rule.
//
// Like any context deadline, this cannot stop a handler that ignores its
// context; the server's WriteTimeout is the backstop for that.
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()

			ww := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r.WithContext(ctx))

			if ww.Status() == 0 && errors.Is(ctx.Err(), context.DeadlineExceeded) {
				sdkmw.DefaultErrorWriter(ww, r, TimeoutError())
			}
		})
	}
}
