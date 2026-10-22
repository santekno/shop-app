// Command api is the GoShop REST API.
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-chi/chi/v5"

	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/health"
	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

func main() {
	// SIGINT is Ctrl+C; SIGTERM is what Docker and Railway send to stop a
	// container. Either one cancels ctx, which starts the graceful shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// After the first signal, stop listening for more: a second Ctrl+C then
	// kills the process at once instead of waiting for the drain.
	context.AfterFunc(ctx, stop)

	// Fail fast: a missing or invalid variable stops the process here, with
	// a message naming it, before anything listens. There is no logger yet,
	// because its format depends on the config.
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	logger := logging.New(os.Stdout, cfg.IsDevelopment(), cfg.LogLevel).With("env", cfg.Env)
	readiness := &health.Readiness{}

	categoryRepo := category.NewMemoryRepository(category.SeedCategories())
	categoryService := category.NewService(categoryRepo)
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

	srv := httpserver.New(cfg.Addr(), router, cfg.RequestTimeout)
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", srv.Addr)
	if err != nil {
		logger.Error("api cannot listen", "addr", srv.Addr, "error", err)
		os.Exit(1)
	}
	logger.Info("api listening", "addr", ln.Addr().String())

	err = httpserver.Serve(ctx, srv, ln, httpserver.ShutdownOptions{
		OnDrain:    readiness.StartDraining,
		DrainDelay: cfg.DrainDelay,
		Timeout:    cfg.ShutdownTimeout,
		Logger:     logger,
	})
	if err != nil {
		logger.Error("api stopped", "error", err)
		os.Exit(1)
	}
}
