package product

import (
	"fmt"
	"maps"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// AdminRoutes registers the admin product routes on r (mounted under
// /v1/admin). internal/app mounts them behind the auth middleware and the
// seller or admin role, so this package does not check who is calling.
func (h *Handler) AdminRoutes(r chi.Router) {
	r.Post("/products", h.CreateProduct)
	r.Get("/products/{id}", h.GetProduct)
	r.Put("/products/{id}", h.UpdateProduct)
	r.Delete("/products/{id}", h.ArchiveProduct)
}

// productBody is the request body of POST and PUT /v1/admin/products.
// Variants are validated one by one (see validate), so each failure is
// reported as variants[i].field.
type productBody struct {
	CategoryID  string        `json:"category_id" validate:"required,uuid"`
	Slug        string        `json:"slug" validate:"required,max=200"`
	Name        string        `json:"name" validate:"required,max=200"`
	Description string        `json:"description" validate:"max=5000"`
	Status      string        `json:"status" validate:"required,oneof=draft active archived"`
	Variants    []variantBody `json:"variants" validate:"required,min=1,max=50"`
}

type variantBody struct {
	ID          string `json:"id" validate:"omitempty,uuid"`
	SKU         string `json:"sku" validate:"required,max=64"`
	Name        string `json:"name" validate:"required,max=100"`
	Price       int64  `json:"price" validate:"min=1,max=1000000000"`
	Stock       int32  `json:"stock" validate:"min=0,max=1000000"`
	WeightGrams int32  `json:"weight_grams" validate:"min=1,max=100000"`
}

// GetProduct serves GET /v1/admin/products/{id}.
func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toHTTPError(ErrNotFound))
		return
	}
	p, err := h.admin.GetAdmin(r.Context(), id)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toAdminJSON(p)})
}

// CreateProduct serves POST /v1/admin/products: 201 with the new product
// and its URL in Location.
func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	in, err := h.decodeInput(w, r)
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	p, err := h.admin.Create(r.Context(), in)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.Header().Set("Location", "/v1/admin/products/"+p.ID)
	httpapi.JSON(w, r, http.StatusCreated, dataResponse{Data: toAdminJSON(p)})
}

// UpdateProduct serves PUT /v1/admin/products/{id}. The body is the whole
// product: a variant with an id is updated, one without is added, and a
// sellable variant left out is archived.
func (h *Handler) UpdateProduct(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toHTTPError(ErrNotFound))
		return
	}
	in, err := h.decodeInput(w, r)
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	p, err := h.admin.Update(r.Context(), id, in)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toAdminJSON(p)})
}

// ArchiveProduct serves DELETE /v1/admin/products/{id}: 204, and the product
// is archived, not deleted. Archiving an archived product is a 204 too.
func (h *Handler) ArchiveProduct(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toHTTPError(ErrNotFound))
		return
	}
	if err := h.admin.Archive(r.Context(), id); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// decodeInput decodes and validates the body, and returns it as an Input
// with SKUs trimmed and upper-cased, the form the database requires.
func (h *Handler) decodeInput(w http.ResponseWriter, r *http.Request) (Input, error) {
	var body productBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		return Input{}, err
	}
	for i := range body.Variants {
		body.Variants[i].SKU = strings.ToUpper(strings.TrimSpace(body.Variants[i].SKU))
	}
	if err := h.validate(body); err != nil {
		return Input{}, err
	}

	in := Input{
		CategoryID: body.CategoryID, Slug: body.Slug, Name: body.Name,
		Description: body.Description, Status: body.Status,
	}
	for _, v := range body.Variants {
		in.Variants = append(in.Variants, VariantInput(v))
	}
	return in, nil
}

// validate checks the body and every variant, and reports all failures in
// one VALIDATION_FAILED.
func (h *Handler) validate(body productBody) error {
	details, err := h.validator.StructFields(body, "")
	if err != nil {
		return err
	}
	if body.Slug != "" && !slugPattern.MatchString(body.Slug) {
		details["slug"] = "must be lower-case letters and digits in words joined by single hyphens"
	}
	for field, value := range map[string]string{"slug": body.Slug, "name": body.Name, "description": body.Description} {
		if !httpapi.ValidText(value) {
			details[field] = httpapi.InvalidTextMessage
		}
	}
	skus, ids := map[string]bool{}, map[string]bool{}
	for i, v := range body.Variants {
		prefix := fmt.Sprintf("variants[%d].", i)
		fields, err := h.validator.StructFields(v, prefix)
		if err != nil {
			return err
		}
		maps.Copy(details, fields)
		for field, value := range map[string]string{"sku": v.SKU, "name": v.Name} {
			if !httpapi.ValidText(value) {
				details[prefix+field] = httpapi.InvalidTextMessage
			}
		}
		if v.SKU != "" && skus[v.SKU] {
			details[prefix+"sku"] = "is used by another variant in this request"
		}
		if v.ID != "" && ids[v.ID] {
			details[prefix+"id"] = "is listed twice in this request"
		}
		skus[v.SKU], ids[v.ID] = true, true
	}
	if len(details) > 0 {
		return httpapi.ValidationError("invalid request", details)
	}
	return nil
}

// The admin JSON shapes (AdminProduct in api/openapi.yaml).

type adminVariantJSON struct {
	ID          string    `json:"id"`
	SKU         string    `json:"sku"`
	Name        string    `json:"name"`
	Price       moneyJSON `json:"price"`
	Stock       int32     `json:"stock"`
	WeightGrams int32     `json:"weight_grams"`
}

type adminProductJSON struct {
	ID          string             `json:"id"`
	CategoryID  string             `json:"category_id"`
	Slug        string             `json:"slug"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Status      string             `json:"status"`
	PriceFrom   *moneyJSON         `json:"price_from"` // null without a sellable variant
	Variants    []adminVariantJSON `json:"variants"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
}

func toAdminJSON(p AdminProduct) adminProductJSON {
	out := adminProductJSON{
		ID: p.ID, CategoryID: p.CategoryID, Slug: p.Slug, Name: p.Name,
		Description: p.Description, Status: p.Status,
		Variants:  make([]adminVariantJSON, 0, len(p.Variants)),
		CreatedAt: p.CreatedAt.UTC(), UpdatedAt: p.UpdatedAt.UTC(),
	}
	if p.PriceFrom != nil {
		price := rupiah(*p.PriceFrom)
		out.PriceFrom = &price
	}
	for _, v := range p.Variants {
		out.Variants = append(out.Variants, adminVariantJSON{
			ID: v.ID, SKU: v.SKU, Name: v.Name, Price: rupiah(v.Price), Stock: v.Stock, WeightGrams: v.WeightGrams,
		})
	}
	return out
}
