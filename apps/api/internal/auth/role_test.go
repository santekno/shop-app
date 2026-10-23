package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestRequireRole(t *testing.T) {
	staffOnly := RequireRole(user.RoleSeller, user.RoleAdmin)
	tests := []struct {
		name       string
		claims     *AccessClaims // nil: not behind Authenticate
		mw         func(http.Handler) http.Handler
		wantStatus int
		wantCode   string
	}{
		{name: "seller", claims: &AccessClaims{UserID: id1, Role: user.RoleSeller}, mw: staffOnly, wantStatus: http.StatusNoContent},
		{name: "admin", claims: &AccessClaims{UserID: id1, Role: user.RoleAdmin}, mw: staffOnly, wantStatus: http.StatusNoContent},
		{name: "buyer", claims: &AccessClaims{UserID: id1, Role: user.RoleBuyer}, mw: staffOnly, wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
		{name: "unknown role", claims: &AccessClaims{UserID: id1, Role: "root"}, mw: staffOnly, wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
		{name: "admin only, seller", claims: &AccessClaims{UserID: id1, Role: user.RoleSeller}, mw: RequireRole(user.RoleAdmin), wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
		{name: "no roles allows nobody", claims: &AccessClaims{UserID: id1, Role: user.RoleAdmin}, mw: RequireRole(), wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
		// Mounted without Authenticate: fail closed with 401, not open.
		{name: "no claims", claims: nil, mw: staffOnly, wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHORIZED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reached := false
			h := tt.mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				reached = true
				w.WriteHeader(http.StatusNoContent)
			}))
			ctx := context.Background()
			if tt.claims != nil {
				ctx = withClaims(ctx, *tt.claims)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/admin/products", nil))

			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			testx.AssertEqual(t, reached, tt.wantStatus == http.StatusNoContent)
			if tt.wantCode == "" {
				return
			}
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			switch tt.wantCode {
			case "FORBIDDEN":
				testx.AssertEqual(t, body.Error.Message, "your role is not allowed to do this")
				testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), "", "403 asks for no new credentials")
			case "UNAUTHORIZED":
				testx.AssertEqual(t, body.Error.Message, "missing access token")
				testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`)
			}
		})
	}
}
