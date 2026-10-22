// Command api is the GoShop REST API.
package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

func main() {
	// Fail fast: a missing or invalid variable stops the process here, with
	// a message naming it, before anything listens. There is no logger yet,
	// because its format depends on the config.
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	logger := logging.New(os.Stdout, cfg.IsDevelopment(), cfg.LogLevel).With("env", cfg.Env)

	categoryRepo := category.NewMemoryRepository(category.SeedCategories())
	categoryService := category.NewService(categoryRepo)
	categoryHandler := category.NewHandler(categoryService)

	router := httpserver.NewRouter(httpserver.Options{
		Logger:         logger,
		AllowedOrigins: cfg.CORSAllowedOrigins,
		RequestTimeout: cfg.RequestTimeout,
	}, func(r chi.Router) {
		r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}` + "\n"))
		})
		r.Route("/v1", categoryHandler.Routes)
	})

	srv := httpserver.New(cfg.Addr(), router, cfg.RequestTimeout)
	logger.Info("api listening", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("api stopped", "error", err)
		os.Exit(1)
	}
}
