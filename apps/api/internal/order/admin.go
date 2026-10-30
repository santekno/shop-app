package order

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Staff is what the seller and admin handlers need from the service.
type Staff interface {
	GetForStaff(ctx context.Context, id string) (Order, error)
	Queue(ctx context.Context, status Status, cursor string, limit int) (Page, error)
	StartProcessing(ctx context.Context, id string) error
	Ship(ctx context.Context, id, trackingNumber string) error
	Complete(ctx context.Context, buyerID, id string) error
	CancelBySeller(ctx context.Context, id string) error
}

// AdminRoutes registers the seller and admin order routes on r (mounted
// under /v1/admin, behind the seller-or-admin role). Cancelling is not one
// of them: see AdminOnlyRoutes.
func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/orders", h.Queue)
	r.Get("/orders/{id}", h.GetForStaff)
	r.Post("/orders/{id}/process", h.staffMove(func(ctx context.Context, id string) error {
		return h.staff.StartProcessing(ctx, id)
	}))
	r.Post("/orders/{id}/ship", h.Ship)
	r.Post("/orders/{id}/complete", h.staffMove(func(ctx context.Context, id string) error {
		return h.staff.Complete(ctx, "", id)
	}))
}

// AdminOnlyRoutes registers the order routes only an admin may use, on r
// (mounted under /v1/admin, behind the admin role): cancelling an order,
// because admins own cancellations and refunds (docs/prd.md). A seller
// gets 403 from the role check before this handler runs. The order's
// cancel_reason stays seller_cancelled, the store's side of the sale.
func (h *Handler) AdminOnlyRoutes(r chi.Router) {
	r.Post("/orders/{id}/cancel", h.staffMove(func(ctx context.Context, id string) error {
		return h.staff.CancelBySeller(ctx, id)
	}))
}

// queueQuery is the query string of GET /v1/admin/orders.
type queueQuery struct {
	Status string `query:"status" validate:"oneof=pending_payment paid processing shipped completed cancelled"`
	Cursor string `query:"cursor" validate:"omitempty,max=512"`
	Limit  int    `query:"limit" validate:"min=1,max=50"`
}

// Queue serves GET /v1/admin/orders: one status (paid by default, the
// orders to pack), newest first.
func (h *Handler) Queue(w http.ResponseWriter, r *http.Request) {
	q := queueQuery{Status: string(StatusPaid), Limit: 20}
	if err := h.validator.BindQuery(r, &q); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	page, err := h.staff.Queue(r.Context(), Status(q.Status), q.Cursor, q.Limit)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, toPageJSON(page))
}

// GetForStaff serves GET /v1/admin/orders/{id}.
func (h *Handler) GetForStaff(w http.ResponseWriter, r *http.Request) {
	id, ok := orderID(w, r)
	if !ok {
		return
	}
	o, err := h.staff.GetForStaff(r.Context(), id)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toOrderJSON(o)})
}

// trackingPattern is an airway bill: letters, digits and hyphens.
var trackingPattern = regexp.MustCompile(`^[A-Z0-9-]{6,40}$`)

// shipBody is the request body of POST /v1/admin/orders/{id}/ship.
type shipBody struct {
	TrackingNumber string `json:"tracking_number"`
}

// Ship serves POST /v1/admin/orders/{id}/ship: processing → shipped, with
// the courier's airway bill (trimmed, upper-cased).
func (h *Handler) Ship(w http.ResponseWriter, r *http.Request) {
	var body shipBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	tracking := normalizeTracking(body.TrackingNumber)
	if !trackingPattern.MatchString(tracking) {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", map[string]any{
			"tracking_number": "must be the courier's airway bill: 6 to 40 letters, digits or hyphens",
		}))
		return
	}
	h.staffMove(func(ctx context.Context, id string) error {
		return h.staff.Ship(ctx, id, tracking)
	})(w, r)
}

// staffMove is a seller or admin status change on {id}: 200 with the
// order afterwards, or 409 INVALID_TRANSITION.
func (h *Handler) staffMove(move func(ctx context.Context, id string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := orderID(w, r)
		if !ok {
			return
		}
		if err := move(r.Context(), id); err != nil {
			httpapi.Error(w, r, toHTTPError(err))
			return
		}
		o, err := h.staff.GetForStaff(r.Context(), id)
		if err != nil {
			httpapi.Error(w, r, toHTTPError(err))
			return
		}
		httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toOrderJSON(o)})
	}
}

// orderID reads {id}; one that is not a UUID is 404 like an unknown order,
// without a query.
func orderID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toHTTPError(ErrNotFound))
		return "", false
	}
	return id, true
}

// normalizeTracking is how airway bills are stored.
func normalizeTracking(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }
