// Package httpserver builds the GoShop HTTP server: the http.Server with its
// timeouts, and the chi router with the middleware every request goes through.
package httpserver

import (
	"net/http"
	"time"
)

// Server timeouts. A zero timeout in net/http means "wait forever", which lets
// a slow or malicious client hold a connection open indefinitely, so every
// one of them is set.
const (
	// ReadHeaderTimeout bounds how long a client may take to send the request
	// headers (the Slowloris defence).
	ReadHeaderTimeout = 5 * time.Second
	// ReadTimeout bounds reading the whole request, headers and body.
	ReadTimeout = 15 * time.Second
	// IdleTimeout closes keep-alive connections that sit unused.
	IdleTimeout = 120 * time.Second
	// writeTimeoutMargin is added to the request timeout, so a handler that
	// hits its own deadline still has time to write the error response
	// before net/http cuts the connection.
	writeTimeoutMargin = 10 * time.Second
	// MaxHeaderBytes caps the size of the request headers.
	MaxHeaderBytes = 1 << 20 // 1 MiB
)

// New returns an http.Server that serves h on addr (for example ":8080").
// requestTimeout is the longest a handler may run; the server's write timeout
// is derived from it so the two cannot drift apart.
func New(addr string, h http.Handler, requestTimeout time.Duration) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: ReadHeaderTimeout,
		ReadTimeout:       ReadTimeout,
		WriteTimeout:      requestTimeout + writeTimeoutMargin,
		IdleTimeout:       IdleTimeout,
		MaxHeaderBytes:    MaxHeaderBytes,
	}
}
