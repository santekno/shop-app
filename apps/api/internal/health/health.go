package health

import (
	"context"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/healthx"
	"github.com/santekno/sdk/logx"
)

// Names of the readiness checks, as they appear under "checks" in /readyz.
const (
	// ServerCheckName fails while the server drains.
	ServerCheckName = "server"
	// PostgresCheckName fails while the database cannot be reached.
	PostgresCheckName = "postgres"
)

// PostgresCheck is the readiness check for the database: a ping through the
// pool, bounded by healthx's per-check timeout. Pass it to NewHandler, which
// logs a failure.
func PostgresCheck(db healthx.Pinger) healthx.NamedCheck {
	return healthx.NamedCheck{Name: PostgresCheckName, Check: healthx.PingPinger(db)}
}

// NewHandler returns the probes, built on sdk healthx:
//
//   - /healthz (liveness) has no checks: it answers 200 while the process
//     runs, so a database outage never gets the container restarted;
//   - /readyz (readiness) runs the "server" check, which fails during
//     graceful shutdown, plus every dependency check passed in (PostgreSQL
//     from Bab 3, Redis from Bab 4).
//
// hideErrors drops each failing check's error text from the response, which
// should be set outside development because the text can contain internal
// addresses. healthx itself does not log what it hides, so every check is
// wrapped with Logged.
func NewHandler(logger logx.Logger, readiness *Readiness, hideErrors bool, deps ...healthx.NamedCheck) *healthx.Handler {
	checks := []healthx.NamedCheck{Logged(logger, ServerCheckName, readiness.Check)}
	for _, dep := range deps {
		checks = append(checks, Logged(logger, dep.Name, dep.Check))
	}
	return &healthx.Handler{
		Readiness:  checks,
		HideErrors: hideErrors,
	}
}

// Routes registers /healthz and /readyz on r.
func Routes(r chi.Router, h *healthx.Handler) {
	r.Get("/healthz", h.LivenessHandler)
	r.Get("/readyz", h.ReadinessHandler)
}

// Logged wraps check so a failure is logged, with the check's name and the
// probe's request ID, before healthx sees it, and possibly hides it.
func Logged(logger logx.Logger, name string, check healthx.Check) healthx.NamedCheck {
	return healthx.NamedCheck{
		Name: name,
		Check: func(ctx context.Context) error {
			err := check(ctx)
			if err != nil {
				logger.WithContext(ctx).Warn("health check failed", "check", name, "error", err.Error())
			}
			return err
		},
	}
}
