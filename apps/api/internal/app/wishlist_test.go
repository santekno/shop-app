package app_test

// Bab 14: the wishlist is for logged-in buyers only, and the banners and
// the featured filter are public.

import (
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestApp_WishlistIsForBuyers(t *testing.T) {
	rev := &memRevocations{revoked: map[string]bool{"ended": true}}
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithSessionRevocations(rev)).Handler()
	routes := []struct{ method, path string }{
		{http.MethodGet, "/v1/me/wishlist"},
		{http.MethodPut, "/v1/me/wishlist/kaos-polos-hitam"},
		{http.MethodDelete, "/v1/me/wishlist/kaos-polos-hitam"},
	}
	tests := []struct {
		name, authorization string
		wantStatus          int
		wantCode            string
	}{
		{name: "anonymous", wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHORIZED"},
		{name: "revoked buyer session", authorization: bearer(t, user.RoleBuyer, "ended"), wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHORIZED"},
		{name: "seller", authorization: bearer(t, user.RoleSeller, "s1"), wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
		{name: "admin", authorization: bearer(t, user.RoleAdmin, "s1"), wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
	}
	for _, route := range routes {
		for _, tt := range tests {
			t.Run(route.method+" "+tt.name, func(t *testing.T) {
				rec, code := call(t, h, route.method, route.path, tt.authorization, "")
				testx.AssertEqual(t, rec.Code, tt.wantStatus, "body %s", rec.Body.String())
				testx.AssertEqual(t, code, tt.wantCode)
			})
		}
	}

	// A buyer reaches the handlers. The fake database has no rows: an empty
	// wishlist, a user that is gone (401), and a delete that changes nothing.
	t.Run("a buyer lists", func(t *testing.T) {
		rec, _ := call(t, h, http.MethodGet, "/v1/me/wishlist", bearer(t, user.RoleBuyer, "s1"), "")
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()), `{"data":[],"page":{"next_cursor":null}}`)
	})
	t.Run("a buyer removes", func(t *testing.T) {
		rec, _ := call(t, h, http.MethodDelete, "/v1/me/wishlist/kaos-polos-hitam", bearer(t, user.RoleBuyer, "s1"), "")
		testx.AssertEqual(t, rec.Code, http.StatusNoContent)
	})
	t.Run("a buyer adds a malformed slug and the handler answers", func(t *testing.T) {
		rec, code := call(t, h, http.MethodPut, "/v1/me/wishlist/Kaos_Polos", bearer(t, user.RoleBuyer, "s1"), "")
		testx.AssertEqual(t, rec.Code, http.StatusNotFound)
		testx.AssertEqual(t, code, "NOT_FOUND")
		testx.AssertContains(t, rec.Body.String(), "product not found", "the handler answered, not the router")
	})
}

func TestApp_BannersAndFeaturedArePublic(t *testing.T) {
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t)).Handler()

	rec, _ := call(t, h, http.MethodGet, "/v1/banners", "", "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()), `{"data":[]}`)

	rec, _ = call(t, h, http.MethodGet, "/v1/products?featured=true", "", "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()), `{"data":[],"page":{"next_cursor":null}}`)

	rec, code := call(t, h, http.MethodGet, "/v1/products?featured=1", "", "")
	testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
	testx.AssertEqual(t, code, "VALIDATION_FAILED")
}
