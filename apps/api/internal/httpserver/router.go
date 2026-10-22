package httpserver

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/santekno/sdk/logx"
	sdkmw "github.com/santekno/sdk/middleware/chi"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

// Options configures the router's middleware.
type Options struct {
	// Logger is the base logger; every request gets a child of it.
	Logger logx.Logger
	// AllowedOrigins are the browser origins allowed by CORS.
	AllowedOrigins []string
	// RequestTimeout is the deadline of each request.
	RequestTimeout time.Duration
}

// NewRouter returns the chi router of the API with the middleware chain every
// request goes through, unknown routes included. mount registers the routes;
// keeping it a callback lets the wiring code decide which features exist
// while this package owns how every request is handled.
func NewRouter(opts Options, mount func(r chi.Router)) http.Handler {
	r := chi.NewRouter()

	// The order matters: each middleware wraps everything listed after it.
	r.Use(
		// 1. First, so every later step, log line and response (even a
		//    panic or a timeout) has the request ID, and the client gets it
		//    back in X-Request-ID.
		sdkmw.RequestID(),
		// 2. Puts a logger carrying the request ID into the context, for
		//    handlers and the error writer.
		logging.Middleware(opts.Logger),
		// 3. The access log: one line per request once it has finished.
		//    It sits outside Recovery, so a panicking request is still
		//    logged, with the 500 that Recovery wrote.
		sdkmw.Logger(opts.Logger),
		// 4. Turns a panic anywhere below into 500 INTERNAL_ERROR (same
		//    error body) and logs the stack, instead of dropping the
		//    connection.
		sdkmw.Recovery(opts.Logger),
		// 5. CORS before routing: a browser preflight (OPTIONS) is answered
		//    here, and error responses carry the CORS headers too, so the
		//    browser lets the client read the error body.
		corsMiddleware(opts.AllowedOrigins),
		// 6. A HEAD request runs the GET handler (net/http sends no body),
		//    so clients can check a resource without a HEAD route of its
		//    own. After CORS, which answers preflights first.
		chimiddleware.GetHead,
		// 7. Last, so the deadline covers only the handler's own work.
		httpapi.Timeout(opts.RequestTimeout),
	)

	// Unknown routes and wrong methods get the same JSON error body as
	// everything else. They are set before mount, so chi copies them into
	// every sub-router (r.Route) created there.
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		httpapi.Error(w, req, httpapi.NotFoundError("route not found"))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, req *http.Request) {
		// HTTP requires a 405 to list the allowed methods. chi only sets
		// Allow in its own default handler, so it is computed here.
		w.Header().Set("Allow", strings.Join(allowedMethods(r, req.URL.Path), ", "))
		httpapi.Error(w, req, httpapi.MethodNotAllowedError())
	})

	mount(r)
	return r
}

// allowedMethods lists the methods routes has a handler for at path. HEAD
// is allowed wherever GET is, because GetHead serves it with the GET
// handler.
func allowedMethods(routes chi.Routes, path string) []string {
	var allowed []string
	for _, m := range []string{
		http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete,
	} {
		if !routes.Match(chi.NewRouteContext(), m, path) {
			continue
		}
		allowed = append(allowed, m)
		if m == http.MethodGet {
			allowed = append(allowed, http.MethodHead)
		}
	}
	return allowed
}

// corsMiddleware allows browser calls from origins only.
func corsMiddleware(origins []string) func(http.Handler) http.Handler {
	o := cors.Options{
		AllowedOrigins: origins,
		// HEAD too: GetHead serves it, and browsers send it without a preflight.
		AllowedMethods: []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", sdkmw.HeaderRequestID},
		ExposedHeaders: []string{sdkmw.HeaderRequestID},
		MaxAge:         300, // seconds a browser may cache a preflight answer
	}
	// go-chi/cors treats an empty AllowedOrigins as "allow every origin".
	// For GoShop an empty list means the opposite, so say it explicitly.
	if len(origins) == 0 {
		o.AllowOriginFunc = func(*http.Request, string) bool { return false }
	}
	return cors.Handler(o)
}
