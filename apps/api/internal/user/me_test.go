package user_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestHandler_Me(t *testing.T) {
	var asked string
	h := user.NewHandler(&fakeProfiles{get: func(id string) (user.User, error) { asked = id; return me(), nil }}, httpapi.NewValidator())
	rec := serve(h.Me, http.MethodGet, "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, asked, uid, "the caller comes from the token")
	var body struct {
		Data map[string]any `json:"data"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	testx.AssertEqual(t, body.Data["email"], any("budi@example.com"))
	_, hasPhone := body.Data["phone"]
	testx.AssertTrue(t, hasPhone)
}

func TestHandler_MeErrors(t *testing.T) {
	gone := user.NewHandler(&fakeProfiles{get: func(string) (user.User, error) {
		return user.User{}, errors.Join(errors.New("get user"), user.ErrNotFound)
	}}, httpapi.NewValidator())
	b := decodeError(t, serve(gone.Me, http.MethodGet, ""), http.StatusUnauthorized, "UNAUTHORIZED")
	testx.AssertEqual(t, b.Error.Message, "this account no longer exists")

	broken := user.NewHandler(&fakeProfiles{get: func(string) (user.User, error) { return user.User{}, errBoom }}, httpapi.NewValidator())
	decodeError(t, serve(broken.Me, http.MethodGet, ""), http.StatusInternalServerError, "INTERNAL_ERROR")
}
