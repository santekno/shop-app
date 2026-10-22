package httpserver

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter returns the chi router of the API. mount registers the routes;
// keeping it a callback lets the wiring code decide which features exist
// while this package owns how every request is handled.
func NewRouter(mount func(r chi.Router)) http.Handler {
	r := chi.NewRouter()
	mount(r)
	return r
}
