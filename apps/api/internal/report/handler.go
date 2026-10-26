package report

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Reporter is what the handler needs; *Service is one.
type Reporter interface {
	Sales(ctx context.Context, q Query) (Sales, error)
}

// Handler serves the reports.
type Handler struct {
	reports   Reporter
	validator *httpapi.Validator
	now       func() time.Time
}

// NewHandler returns a Handler; now is the clock that decides "today".
func NewHandler(reports Reporter, validator *httpapi.Validator, now func() time.Time) *Handler {
	if now == nil {
		now = time.Now
	}
	return &Handler{reports: reports, validator: validator, now: now}
}

// AdminRoutes registers the report routes (under /v1/admin, staff only).
func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/reports/sales", h.Sales)
}

// salesQuery is the query string of GET /v1/admin/reports/sales.
type salesQuery struct {
	From  string `query:"from" validate:"omitempty,datetime=2006-01-02"`
	To    string `query:"to" validate:"omitempty,datetime=2006-01-02"`
	Group string `query:"group" validate:"oneof=day week month"`
}

// Sales serves GET /v1/admin/reports/sales: the last 30 days by default.
func (h *Handler) Sales(w http.ResponseWriter, r *http.Request) {
	q := salesQuery{Group: string(GroupDay)}
	if err := h.validator.BindQuery(r, &q); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	to := Today(h.now())
	if q.To != "" {
		to, _ = time.Parse(time.DateOnly, q.To) // validated above
	}
	from := to.AddDate(0, 0, -29)
	if q.From != "" {
		from, _ = time.Parse(time.DateOnly, q.From)
	}
	sales, err := h.reports.Sales(r.Context(), Query{From: from, To: to, Group: Group(q.Group)})
	if errors.Is(err, ErrRange) {
		httpapi.Error(w, r, httpapi.ValidationError("invalid query parameters", map[string]any{
			"to": "must be on or after from, at most 366 days in all, both included",
		}))
		return
	}
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toSalesJSON(sales)})
}

type dataResponse struct {
	Data any `json:"data"`
}

// The JSON shapes: SalesReport in api/openapi.yaml.
type totalsJSON struct {
	Revenue           cart.MoneyJSON `json:"revenue"`
	OrderCount        int64          `json:"order_count"`
	AverageOrderValue cart.MoneyJSON `json:"average_order_value"`
}

type periodJSON struct {
	Period            string         `json:"period"`
	Revenue           cart.MoneyJSON `json:"revenue"`
	OrderCount        int64          `json:"order_count"`
	AverageOrderValue cart.MoneyJSON `json:"average_order_value"`
	CumulativeRevenue cart.MoneyJSON `json:"cumulative_revenue"`
}

type productJSON struct {
	Rank      int32          `json:"rank"`
	ProductID string         `json:"product_id"`
	Name      string         `json:"name"`
	Units     int64          `json:"units"`
	Revenue   cart.MoneyJSON `json:"revenue"`
}

type salesJSON struct {
	From        string        `json:"from"`
	To          string        `json:"to"`
	Group       string        `json:"group"`
	TimeZone    string        `json:"time_zone"`
	Totals      totalsJSON    `json:"totals"`
	Series      []periodJSON  `json:"series"`
	TopProducts []productJSON `json:"top_products"`
}

func toSalesJSON(s Sales) salesJSON {
	out := salesJSON{
		From: s.Query.From.Format(time.DateOnly), To: s.Query.To.Format(time.DateOnly),
		Group: string(s.Query.Group), TimeZone: "Asia/Jakarta",
		Totals: totalsJSON{
			Revenue: cart.Rupiah(s.Revenue), OrderCount: s.Orders, AverageOrderValue: cart.Rupiah(s.AverageOrderValue),
		},
		Series: make([]periodJSON, 0, len(s.Series)), TopProducts: make([]productJSON, 0, len(s.Top)),
	}
	for _, p := range s.Series {
		out.Series = append(out.Series, periodJSON{
			Period: p.Start.Format(time.DateOnly), Revenue: cart.Rupiah(p.Revenue), OrderCount: p.Orders,
			AverageOrderValue: cart.Rupiah(p.AverageOrderValue), CumulativeRevenue: cart.Rupiah(p.CumulativeRevenue),
		})
	}
	for _, p := range s.Top {
		out.TopProducts = append(out.TopProducts, productJSON{
			Rank: p.Rank, ProductID: p.ID, Name: p.Name, Units: p.Units, Revenue: cart.Rupiah(p.Revenue),
		})
	}
	return out
}
