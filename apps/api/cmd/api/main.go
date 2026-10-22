// Command api is the GoShop REST API.
package main

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/httpserver"
)

func main() {
	categoryRepo := category.NewMemoryRepository(category.SeedCategories())
	categoryService := category.NewService(categoryRepo)
	categoryHandler := category.NewHandler(categoryService)

	router := httpserver.NewRouter(func(r chi.Router) {
		r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"ok"}` + "\n"))
		})
		r.Route("/v1", categoryHandler.Routes)
	})

	srv := httpserver.New(":8080", router, 15*time.Second)
	log.Printf("GoShop API listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
