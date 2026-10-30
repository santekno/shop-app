package app_test

// Bab 12 artikel-02: GET /v1/admin/products as app.New wires it.

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// staffHandler is the API with no revoked session.
func staffHandler(t *testing.T) http.Handler {
	t.Helper()
	return app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}})).Handler()
}

// GET /v1/admin/products is the table (New gives the handler its
// TableService), staff only.
func TestApp_AdminProductTable(t *testing.T) {
	h := staffHandler(t)
	tests := []struct {
		name, auth string
		status     int
		code       string
	}{
		{name: "anonymous", status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "buyer", auth: bearer(t, user.RoleBuyer, "s1"), status: http.StatusForbidden, code: "FORBIDDEN"},
		// The table handler's own validation answers: the route exists.
		{name: "seller", auth: bearer(t, user.RoleSeller, "s1"), status: http.StatusBadRequest, code: "VALIDATION_FAILED"},
		{name: "admin", auth: bearer(t, user.RoleAdmin, "s1"), status: http.StatusBadRequest, code: "VALIDATION_FAILED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, code := call(t, h, http.MethodGet, "/v1/admin/products?per_page=0", tt.auth, "")
			testx.AssertEqual(t, rec.Code, tt.status, "body %s", rec.Body.String())
			testx.AssertEqual(t, code, tt.code)
			if tt.status == http.StatusBadRequest {
				testx.AssertContains(t, rec.Body.String(), `"per_page":"must be between 1 and 100"`)
			}
		})
	}
}
