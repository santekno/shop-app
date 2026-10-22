package httpserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/santekno/sdk/logx"
)

// ShutdownOptions controls how Serve stops.
type ShutdownOptions struct {
	// OnDrain runs as soon as shutdown begins, before anything stops; the
	// API flips readiness to "not ready" here.
	OnDrain func()
	// DrainDelay is how long to keep serving after OnDrain, so a load
	// balancer polling /readyz notices and stops sending new requests
	// before the listener closes. Zero skips the wait.
	DrainDelay time.Duration
	// Timeout bounds the wait for in-flight requests to finish. Connections
	// still open after it are closed.
	Timeout time.Duration
	// Logger records the shutdown steps.
	Logger logx.Logger
}

// Serve runs srv on ln until ctx is cancelled (on SIGINT or SIGTERM, in
// main), then shuts down gracefully: OnDrain, DrainDelay, then
// srv.Shutdown, which stops accepting connections and waits for in-flight
// requests up to Timeout.
//
// It returns nil after a clean shutdown, and an error when the server could
// not serve or did not finish in time. Taking a listener rather than an
// address lets a test serve on port 0 and learn the real address.
func Serve(ctx context.Context, srv *http.Server, ln net.Listener, opts ShutdownOptions) error {
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	select {
	case err := <-serveErr:
		// Serve only returns on its own when it fails, e.g. the listener
		// was closed underneath it.
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}

	opts.Logger.Info("shutdown started", "drain_delay", opts.DrainDelay.String(), "timeout", opts.Timeout.String())
	if opts.OnDrain != nil {
		opts.OnDrain()
	}
	time.Sleep(opts.DrainDelay)

	// ctx is already cancelled, so the shutdown deadline needs a context
	// that keeps ctx's values but not its cancellation.
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), opts.Timeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		// Requests still running after Timeout: cut them off.
		_ = srv.Close()
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	opts.Logger.Info("shutdown complete")
	return nil
}
