package app_test

// Bab 12 artikel-08: cancelling an order is for admins only.

import (
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// Cancelling an order is for admins only (Bab 12); a seller keeps every
// other order move. An id that is not a UUID is the order handler's 404,
// which shows the request reached it.
func TestApp_CancelIsAdminOnly(t *testing.T) {
	h := staffHandler(t)
	seller, admin := bearer(t, user.RoleSeller, "s1"), bearer(t, user.RoleAdmin, "s1")
	tests := []struct {
		name, path, auth string
		status           int
		code             string
	}{
		{name: "a seller cannot cancel", path: "/v1/admin/orders/zzz/cancel", auth: seller, status: http.StatusForbidden, code: "FORBIDDEN"},
		{name: "a buyer cannot cancel", path: "/v1/admin/orders/zzz/cancel", auth: bearer(t, user.RoleBuyer, "s1"), status: http.StatusForbidden, code: "FORBIDDEN"},
		{name: "anonymous cannot cancel", path: "/v1/admin/orders/zzz/cancel", status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "an admin reaches cancel", path: "/v1/admin/orders/zzz/cancel", auth: admin, status: http.StatusNotFound, code: "NOT_FOUND"},
		{name: "a seller still processes", path: "/v1/admin/orders/zzz/process", auth: seller, status: http.StatusNotFound, code: "NOT_FOUND"},
		{name: "a seller still ships", path: "/v1/admin/orders/zzz/ship", auth: seller, status: http.StatusNotFound, code: "NOT_FOUND"},
		{name: "a seller still completes", path: "/v1/admin/orders/zzz/complete", auth: seller, status: http.StatusNotFound, code: "NOT_FOUND"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, code := call(t, h, http.MethodPost, tt.path, tt.auth, `{"tracking_number":"JNE1234567"}`)
			testx.AssertEqual(t, rec.Code, tt.status, "body %s", rec.Body.String())
			testx.AssertEqual(t, code, tt.code)
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "route not found"), "the handler answered, not the router")
		})
	}
}
