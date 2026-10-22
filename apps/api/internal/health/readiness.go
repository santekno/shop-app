// Package health serves the liveness (/healthz) and readiness (/readyz)
// probes and holds the readiness state that graceful shutdown flips.
package health

import (
	"context"
	"errors"
	"sync/atomic"
)

// ErrShuttingDown is the readiness failure while the server drains.
var ErrShuttingDown = errors.New("shutting down")

// Readiness records whether this instance should receive new traffic. The
// zero value is ready. It is safe for concurrent use: the shutdown code
// writes it while probe requests read it.
type Readiness struct {
	draining atomic.Bool
}

// StartDraining marks the instance as not ready, for good: once shutdown has
// begun, it does not come back.
func (r *Readiness) StartDraining() { r.draining.Store(true) }

// Draining reports whether StartDraining has been called.
func (r *Readiness) Draining() bool { return r.draining.Load() }

// Check is a healthx check: nil while ready, ErrShuttingDown while draining.
func (r *Readiness) Check(context.Context) error {
	if r.Draining() {
		return ErrShuttingDown
	}
	return nil
}
