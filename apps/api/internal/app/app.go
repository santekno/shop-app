// Package app wires the API together by hand, with no dependency-injection
// framework: config → logger → repositories → services → handlers → router →
// server. Reading New from top to bottom shows exactly what the API is made
// of and in which order it starts.
package app

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/health"
	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

// App is the wired API, ready to serve.
type App struct {
	cfg       config.Config
	logger    logx.Logger
	readiness *health.Readiness
	handler   http.Handler
}

// New builds the API from cfg. Every dependency is created here and passed
// to the code that needs it; nothing reaches for a global.
func New(cfg config.Config, logger logx.Logger) *App {
	readiness := &health.Readiness{}

	// Repositories: in memory in Bab 2. Bab 3 opens the database here and
	// passes it to the PostgreSQL repositories instead.
	categoryRepo := category.NewMemoryRepository(category.SeedCategories())

	// Services: the business rules, given their repositories.
	categoryService := category.NewService(categoryRepo)

	// Handlers: HTTP in and out, given their services.
	categoryHandler := category.NewHandler(categoryService)
	healthHandler := health.NewHandler(logger, readiness, !cfg.IsDevelopment())

	router := httpserver.NewRouter(httpserver.Options{
		Logger:         logger,
		AllowedOrigins: cfg.CORSAllowedOrigins,
		RequestTimeout: cfg.RequestTimeout,
		Probes:         func(r chi.Router) { health.Routes(r, healthHandler) },
	}, func(r chi.Router) {
		r.Route("/v1", categoryHandler.Routes)
	})

	return &App{cfg: cfg, logger: logger, readiness: readiness, handler: router}
}

// Handler is the API's router with all middleware, for httptest.
func (a *App) Handler() http.Handler { return a.handler }

// Ready reports whether /readyz currently passes the server check.
func (a *App) Ready() bool { return !a.readiness.Draining() }

// Serve serves the API on ln until ctx is cancelled, then shuts down
// gracefully (see httpserver.Serve).
func (a *App) Serve(ctx context.Context, ln net.Listener) error {
	srv := httpserver.New(ln.Addr().String(), a.handler, a.cfg.RequestTimeout)
	a.logger.Info("api listening", "addr", ln.Addr().String())
	return httpserver.Serve(ctx, srv, ln, httpserver.ShutdownOptions{
		OnDrain:    a.readiness.StartDraining,
		DrainDelay: a.cfg.DrainDelay,
		Timeout:    a.cfg.ShutdownTimeout,
		Logger:     a.logger,
	})
}

// Run is the whole program. With no arguments it loads the config from the
// environment, logs to stdout, listens on the configured port and serves
// until ctx is cancelled. With "healthcheck" it probes a running API on the
// same port instead (see Probe), and with "migrate" it applies the database
// migrations and exits (see runMigrations). main only adds signal handling
// and the exit code.
func Run(ctx context.Context, args []string, stdout io.Writer) error {
	// Fail fast: an invalid variable stops the program here, before
	// anything listens. There is no logger yet; its format depends on cfg.
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := logging.New(stdout, cfg.IsDevelopment(), cfg.LogLevel).With("env", cfg.Env)
	switch {
	case len(args) == 0:
	case len(args) == 1 && args[0] == "healthcheck":
		return Probe(ctx, cfg.Port)
	case len(args) == 1 && args[0] == "migrate":
		return runMigrations(ctx, cfg, logger)
	default:
		return fmt.Errorf("unknown arguments %q (usage: api [healthcheck|migrate])", args)
	}

	a := New(cfg, logger)

	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", cfg.Addr())
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Addr(), err)
	}
	return a.Serve(ctx, ln)
}

// runMigrations is `api migrate`: the one way a deployed database gets its
// schema. Docker Compose runs it as the one-shot migrate service before the
// api starts, and Railway as the api's pre-deploy command. The server itself
// never migrates, so a rollout cannot change the schema under instances that
// are still running the old code, and two instances never race to migrate.
func runMigrations(ctx context.Context, cfg config.Config, logger logx.Logger) error {
	db, err := database.Open(ctx, cfg.Database, logger)
	if err != nil {
		return err
	}
	version, err := database.Migrate(db)
	if err != nil {
		return err
	}
	logger.Info("database migrated", "version", version)
	return nil
}
