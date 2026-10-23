package user_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// An account deleted since its token was issued answers 401 with the
// header RFC 6750 asks for, like any other UNAUTHORIZED.
func TestHandler_MeGoneAsksForBearer(t *testing.T) {
	h := user.NewHandler(&fakeProfiles{get: func(string) (user.User, error) { return user.User{}, user.ErrNotFound }}, httpapi.NewValidator())
	rec := serve(h.Me, http.MethodGet, "")
	decodeError(t, rec, http.StatusUnauthorized, "UNAUTHORIZED")
	testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`)
}
