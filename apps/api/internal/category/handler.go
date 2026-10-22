package category

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Lister is what the handler needs from the service. Declaring it here, where
// it is used, lets a test hand the handler a fake instead of a real service.
type Lister interface {
	List(ctx context.Context) ([]Category, error)
}

// Handler serves the category endpoints.
type Handler struct {
	svc Lister
}

// NewHandler returns a Handler backed by svc.
func NewHandler(svc Lister) *Handler {
	return &Handler{svc: svc}
}

// Routes registers the category routes on r (mounted under /v1).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/categories", h.List)
}

// List serves GET /v1/categories.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	categories, err := h.svc.List(r.Context())
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(toListResponse(categories))
}

// categoryJSON is the contract's Category schema. The HTTP shape lives in the
// handler, so the model can change (a level column in Bab 3) without
// changing the API by accident.
type categoryJSON struct {
	ID       string  `json:"id"`
	Slug     string  `json:"slug"`
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"` // no omitempty: the contract wants null
}

type listResponse struct {
	Data []categoryJSON `json:"data"`
}

func toListResponse(categories []Category) listResponse {
	// make, not var: an empty list must encode as [] rather than null.
	data := make([]categoryJSON, 0, len(categories))
	for _, c := range categories {
		data = append(data, categoryJSON{ID: c.ID, Slug: c.Slug, Name: c.Name, ParentID: c.ParentID})
	}
	return listResponse{Data: data}
}
