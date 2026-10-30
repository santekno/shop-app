package app_test

// Bab 12 artikel-05: the stock adjustment route as app.New wires it.

import (
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestApp_StockAdjustments(t *testing.T) {
	h := staffHandler(t)
	const product = "0190c8a0-0000-7000-8000-0000000000c1"
	const variant = "0190c8a0-0000-7000-8000-0000000000c2"
	path := "/v1/admin/products/" + product + "/variants/" + variant + "/stock-adjustments"
	tests := []struct {
		name, path, auth, body string
		status                 int
		code, message          string
	}{
		{name: "anonymous", path: path, body: `{"delta":1}`, status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "buyer", path: path, auth: bearer(t, user.RoleBuyer, "s1"), body: `{"delta":1}`, status: http.StatusForbidden, code: "FORBIDDEN"},
		// The stock handler's own answers: the route exists for staff.
		{name: "seller, bad body", path: path, auth: bearer(t, user.RoleSeller, "s1"), body: `{"delta":0}`,
			status: http.StatusBadRequest, code: "VALIDATION_FAILED", message: `"delta":"must not be 0"`},
		{name: "admin, bad variant id", path: strings.Replace(path, variant, "KPH-S", 1), auth: bearer(t, user.RoleAdmin, "s1"), body: `{"delta":1}`,
			status: http.StatusNotFound, code: "NOT_FOUND", message: "variant not found"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, code := call(t, h, http.MethodPost, tt.path, tt.auth, tt.body)
			testx.AssertEqual(t, rec.Code, tt.status, "body %s", rec.Body.String())
			testx.AssertEqual(t, code, tt.code)
			if tt.message != "" {
				testx.AssertContains(t, rec.Body.String(), tt.message)
			}
		})
	}
}
