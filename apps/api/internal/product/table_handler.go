package product

import (
	"context"
	"net/http"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Table is what the product table's handler needs from the TableService.
type Table interface {
	List(ctx context.Context, params TableParams) (TablePage, error)
}

// WithTable makes h serve GET /v1/admin/products with table, and returns
// h. Without it AdminRoutes does not register that route.
func (h *Handler) WithTable(table Table) *Handler {
	h.table = table
	return h
}

// tableQuery is the query string of GET /v1/admin/products, with the
// contract's defaults set before binding.
type tableQuery struct {
	Q          string `query:"q" validate:"max=100"`
	Status     string `query:"status" validate:"omitempty,oneof=draft active archived"`
	CategoryID string `query:"category_id" validate:"omitempty,uuid"`
	LowStock   bool   `query:"low_stock"`
	Sort       string `query:"sort" validate:"oneof=name price_from stock updated_at created_at"`
	Order      string `query:"order" validate:"oneof=asc desc"`
	Page       int    `query:"page" validate:"min=1,max=10000"`
	PerPage    int    `query:"per_page" validate:"min=1,max=100"`
}

// ListTable serves GET /v1/admin/products: one numbered page of every
// product, any status, most recently saved first by default.
func (h *Handler) ListTable(w http.ResponseWriter, r *http.Request) {
	q := tableQuery{Sort: string(TableSortUpdatedAt), Order: "desc", Page: 1, PerPage: 20}
	if err := h.validator.BindQuery(r, &q); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if !httpapi.ValidText(q.Q) {
		httpapi.Error(w, r, httpapi.ValidationError("invalid query parameters", map[string]any{"q": httpapi.InvalidTextMessage}))
		return
	}
	page, err := h.table.List(r.Context(), TableParams{
		Query: q.Q, Status: q.Status, CategoryID: q.CategoryID, LowStock: q.LowStock,
		Sort: TableSort(q.Sort), Descending: q.Order == "desc", Page: q.Page, PerPage: q.PerPage,
	})
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, h.toTableJSON(page))
}

// The JSON shapes of the table (AdminProductTable in api/openapi.yaml).

type tableCategoryJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type tableRowJSON struct {
	ID           string            `json:"id"`
	Slug         string            `json:"slug"`
	Name         string            `json:"name"`
	Status       string            `json:"status"`
	Category     tableCategoryJSON `json:"category"`
	PriceFrom    *moneyJSON        `json:"price_from"` // null without a sellable variant
	Stock        int64             `json:"stock"`
	VariantCount int32             `json:"variant_count"`
	LowStock     bool              `json:"low_stock"`
	ThumbnailURL *string           `json:"thumbnail_url"` // null until a photo is ready
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
}

type offsetPageJSON struct {
	Page       int   `json:"page"`
	PerPage    int   `json:"per_page"`
	Total      int64 `json:"total"`
	TotalPages int64 `json:"total_pages"`
}

type tableResponse struct {
	Data []tableRowJSON `json:"data"`
	Page offsetPageJSON `json:"page"`
	// LowStockThreshold is the rule behind low_stock and the low_stock
	// filter, so a client reads it instead of keeping a copy.
	LowStockThreshold int `json:"low_stock_threshold"`
}

func (h *Handler) toTableJSON(page TablePage) tableResponse {
	data := make([]tableRowJSON, 0, len(page.Rows)) // [] rather than null
	for _, row := range page.Rows {
		out := tableRowJSON{
			ID: row.ID, Slug: row.Slug, Name: row.Name, Status: row.Status,
			Category: tableCategoryJSON{ID: row.CategoryID, Name: row.CategoryName},
			Stock:    row.Stock, VariantCount: row.VariantCount, LowStock: row.LowStock,
			CreatedAt: row.CreatedAt.UTC(), UpdatedAt: row.UpdatedAt.UTC(),
		}
		if row.PriceFrom != nil {
			price := rupiah(*row.PriceFrom)
			out.PriceFrom = &price
		}
		if row.Thumbnail != nil {
			url := h.imageURL(row.Thumbnail.Key)
			out.ThumbnailURL = &url
		}
		data = append(data, out)
	}
	return tableResponse{Data: data, Page: offsetPageJSON{
		Page: page.Page, PerPage: page.PerPage, Total: page.Total, TotalPages: page.TotalPages(),
	}, LowStockThreshold: LowStockThreshold}
}
