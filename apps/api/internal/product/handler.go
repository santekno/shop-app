package product

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/errx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeUnknownCategory = "UNKNOWN_CATEGORY"
	CodeSlugTaken       = "SLUG_TAKEN"
	CodeSKUTaken        = "SKU_TAKEN"
	CodeVersionConflict = "VERSION_CONFLICT"
)

// slugPattern is the contract's slug pattern for products and categories.
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// maxProductSlug is the contract's maxLength for a product slug.
const maxProductSlug = 200

// Catalog is what the storefront handlers need from the service.
type Catalog interface {
	List(ctx context.Context, params ListParams) (Page, error)
	Get(ctx context.Context, slug string) (Product, error)
}

// Admin is what the admin handlers need from the service.
type Admin interface {
	GetAdmin(ctx context.Context, id string) (AdminProduct, error)
	Create(ctx context.Context, in Input) (AdminProduct, error)
	Update(ctx context.Context, id string, in Input) (AdminProduct, error)
	Archive(ctx context.Context, id string) error
}

// Handler serves the product endpoints.
type Handler struct {
	catalog   Catalog
	admin     Admin
	validator *httpapi.Validator
	images    Images
	publicURL func(key string) string
}

// NewHandler returns a Handler. svc is usually one *Service that is both
// Catalog and Admin.
func NewHandler(catalog Catalog, admin Admin, validator *httpapi.Validator) *Handler {
	return &Handler{catalog: catalog, admin: admin, validator: validator}
}

// Routes registers the storefront routes on r (mounted under /v1).
func (h *Handler) Routes(r chi.Router) {
	r.Get("/products", h.List)
	r.Get("/products/{slug}", h.Get)
}

// listQuery is the query string of GET /v1/products, with the contract's
// defaults set before binding.
type listQuery struct {
	Category string `query:"category" validate:"omitempty,max=100"`
	Q        string `query:"q" validate:"omitempty,max=100"`
	Sort     string `query:"sort" validate:"oneof=newest price_asc price_desc"`
	Cursor   string `query:"cursor" validate:"omitempty,max=512"`
	Limit    int    `query:"limit" validate:"min=1,max=100"`
}

// List serves GET /v1/products.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := listQuery{Sort: string(SortNewest), Limit: 20}
	if err := h.validator.BindQuery(r, &q); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if q.Category != "" && !slugPattern.MatchString(q.Category) {
		httpapi.Error(w, r, httpapi.ValidationError("invalid query parameters", map[string]any{
			"category": "must be a category slug such as kaos",
		}))
		return
	}
	page, err := h.catalog.List(r.Context(), ListParams{
		Category: q.Category, Query: q.Q, Sort: Sort(q.Sort), Cursor: q.Cursor, Limit: q.Limit,
	})
	if errors.Is(err, ErrUnknownCategory) {
		// A typo is not mistaken for an empty category.
		httpapi.Error(w, r, errx.New(CodeUnknownCategory, "category not found").
			WithHTTPStatus(http.StatusBadRequest).
			WithDetails(map[string]any{"category": q.Category}))
		return
	}
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	resp := toListResponse(page)
	for i, p := range page.Products {
		resp.Data[i].Images = h.toImagesJSON(p.Images)
	}
	httpapi.JSON(w, r, http.StatusOK, resp)
}

// Get serves GET /v1/products/{slug}. A malformed slug is answered exactly
// like an unknown one, as the contract says, without asking the database.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if len(slug) > maxProductSlug || !slugPattern.MatchString(slug) {
		httpapi.Error(w, r, toHTTPError(ErrNotFound))
		return
	}
	p, err := h.catalog.Get(r.Context(), slug)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	out := toProductJSON(p)
	out.Images = h.toImagesJSON(p.Images)
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: out})
}

// toHTTPError maps the service's errors to the API's error responses.
// Anything it does not know stays as it is and becomes a 500.
func toHTTPError(err error) error {
	var versionErr *VersionConflictError
	switch {
	case errors.Is(err, ErrNotFound):
		return httpapi.NotFoundError("product not found")
	case errors.Is(err, ErrInvalidCursor):
		return httpapi.ValidationError("invalid query parameters", map[string]any{
			"cursor": "is not a cursor from page.next_cursor for these filters; start again without it",
		})
	case errors.Is(err, ErrSlugTaken):
		return conflict(CodeSlugTaken, "another product already uses this slug", "slug")
	case errors.Is(err, ErrSKUTaken):
		return conflict(CodeSKUTaken, "a variant with one of these SKUs already exists", "variants")
	case errors.As(err, &versionErr):
		return errx.New(CodeVersionConflict, "a variant changed since you loaded it (a sale or another save); reload the product and save again").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"variant_id": versionErr.VariantID})
	case errors.Is(err, ErrUnknownCategory):
		return errx.New(CodeUnknownCategory, "category not found").
			WithHTTPStatus(http.StatusBadRequest).
			WithDetails(map[string]any{"category_id": "names no category"})
	case errors.Is(err, ErrUnknownVariant):
		return httpapi.ValidationError("invalid request", map[string]any{
			"variants": "an id must name a sellable variant of this product; leave it out for a new variant",
		})
	case errors.Is(err, ErrInvalidText):
		return httpapi.ValidationError("invalid request", map[string]any{"body": httpapi.InvalidTextMessage})
	default:
		return err
	}
}

func conflict(code, message, field string) *errx.AppError {
	return errx.New(code, message).
		WithHTTPStatus(http.StatusConflict).
		WithDetails(map[string]any{field: message})
}

// The JSON shapes of the contract (api/openapi.yaml). They live in the
// handler, so a model change cannot change the API by accident.

type moneyJSON struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

func rupiah(amount int64) moneyJSON { return moneyJSON{Amount: amount, Currency: "IDR"} }

type categoryJSON struct {
	ID       string  `json:"id"`
	Slug     string  `json:"slug"`
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"` // no omitempty: the contract wants null
}

type variantJSON struct {
	ID    string    `json:"id"`
	SKU   string    `json:"sku"`
	Name  string    `json:"name"`
	Price moneyJSON `json:"price"`
	Stock int32     `json:"stock"`
}

type productJSON struct {
	ID          string        `json:"id"`
	Slug        string        `json:"slug"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Category    categoryJSON  `json:"category"`
	PriceFrom   moneyJSON     `json:"price_from"`
	InStock     bool          `json:"in_stock"`
	Variants    []variantJSON `json:"variants"`
	// Images is filled by the handler, which knows the public URLs.
	Images    []imageJSON `json:"images"`
	CreatedAt time.Time   `json:"created_at"`
}

type pageJSON struct {
	NextCursor *string `json:"next_cursor"` // null on the last page
}

type listResponse struct {
	Data []productJSON `json:"data"`
	Page pageJSON      `json:"page"`
}

type dataResponse struct {
	Data any `json:"data"`
}

func toProductJSON(p Product) productJSON {
	variants := make([]variantJSON, 0, len(p.Variants))
	for _, v := range p.Variants {
		variants = append(variants, variantJSON{ID: v.ID, SKU: v.SKU, Name: v.Name, Price: rupiah(v.Price), Stock: v.Stock})
	}
	return productJSON{
		ID:          p.ID,
		Slug:        p.Slug,
		Name:        p.Name,
		Description: p.Description,
		Category: categoryJSON{
			ID: p.Category.ID, Slug: p.Category.Slug, Name: p.Category.Name, ParentID: p.Category.ParentID,
		},
		PriceFrom: rupiah(p.PriceFrom),
		InStock:   p.InStock(),
		Variants:  variants,
		Images:    []imageJSON{},
		CreatedAt: p.CreatedAt.UTC(),
	}
}

func toListResponse(page Page) listResponse {
	data := make([]productJSON, 0, len(page.Products)) // [] rather than null
	for _, p := range page.Products {
		data = append(data, toProductJSON(p))
	}
	resp := listResponse{Data: data}
	if page.NextCursor != "" {
		resp.Page.NextCursor = &page.NextCursor
	}
	return resp
}
