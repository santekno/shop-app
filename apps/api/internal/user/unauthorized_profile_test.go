package user_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestHandler_ProfileGoneAsksForBearer(t *testing.T) {
	svc := &fakeProfiles{
		update: func(string, user.ProfileUpdate) (user.User, error) { return user.User{}, user.ErrNotFound },
		delete: func(string) error { return user.ErrNotFound },
	}
	h := user.NewHandler(svc, httpapi.NewValidator())
	patch := serve(h.UpdateMe, http.MethodPatch, `{}`)
	decodeError(t, patch, http.StatusUnauthorized, "UNAUTHORIZED")
	testx.AssertEqual(t, patch.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`, "PATCH")
	del := serve(h.DeleteMe, http.MethodDelete, "")
	decodeError(t, del, http.StatusUnauthorized, "UNAUTHORIZED")
	testx.AssertEqual(t, del.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`, "DELETE")
}
