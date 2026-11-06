package banner

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Lister is what the handler needs from the service.
type Lister interface {
	List(ctx context.Context) ([]Banner, error)
}

// Handler serves the banner endpoint.
type Handler struct {
	svc Lister
}

// NewHandler returns a Handler backed by svc.
func NewHandler(svc Lister) *Handler {
	return &Handler{svc: svc}
}

// Routes registers the banner routes on r (mounted under /v1, public).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/banners", h.List)
}

// List serves GET /v1/banners. It keeps the API's default Cache-Control:
// no-store, like every other public read today; the catalog has no cache
// headers yet (httpapi.SecurityHeaders).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	banners, err := h.svc.List(r.Context())
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	httpapi.JSON(w, r, http.StatusOK, toListResponse(banners))
}

// bannerJSON is the contract's Banner schema.
type bannerJSON struct {
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	Subtitle         *string `json:"subtitle"`           // no omitempty: the contract wants null
	CTALabel         *string `json:"cta_label"`          // no omitempty: the contract wants null
	LinkCategorySlug *string `json:"link_category_slug"` // no omitempty: the contract wants null
	BackgroundColor  string  `json:"background_color"`
}

type listResponse struct {
	Data []bannerJSON `json:"data"`
}

func toListResponse(banners []Banner) listResponse {
	data := make([]bannerJSON, 0, len(banners)) // [] rather than null
	for _, b := range banners {
		data = append(data, bannerJSON{
			ID: b.ID, Title: b.Title, Subtitle: nullable(b.Subtitle), CTALabel: nullable(b.CTALabel),
			LinkCategorySlug: nullable(b.LinkCategorySlug), BackgroundColor: b.BackgroundColor,
		})
	}
	return listResponse{Data: data}
}

// nullable is nil for an empty string, so the JSON has null.
func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
