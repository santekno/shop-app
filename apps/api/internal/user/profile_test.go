package user_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestService_GetAndUpdate(t *testing.T) {
	repo := &fakeRepo{
		get: func(id string) (user.User, error) {
			if id == uid {
				return user.User{ID: id}, nil
			}
			return user.User{}, user.ErrNotFound
		},
		update: func(id string, p user.ProfileUpdate) (user.User, error) {
			if p.Name == nil {
				return user.User{}, user.ErrNotFound
			}
			return user.User{ID: id, Name: *p.Name}, nil
		},
	}
	svc := user.NewService(repo, &fakeRevoker{})
	ctx := context.Background()

	u, err := svc.Get(ctx, uid)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, u.ID, uid)
	_, err = svc.Get(ctx, "other")
	testx.AssertTrue(t, errors.Is(err, user.ErrNotFound), "err = %v", err)
	testx.AssertEqual(t, err.Error(), "get user other: user not found")

	name := "Budi"
	u, err = svc.Update(ctx, uid, user.ProfileUpdate{Name: &name})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, u.Name, "Budi")
	_, err = svc.Update(ctx, uid, user.ProfileUpdate{})
	testx.AssertTrue(t, errors.Is(err, user.ErrNotFound))
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "update user "+uid+": "), "err = %v", err)
}

func TestHandler_UpdateMe(t *testing.T) {
	str := func(s string) *string { return &s }
	tests := []struct {
		name      string
		body      string
		wantName  *string
		wantSet   bool
		wantPhone *string
	}{
		{name: "empty body changes nothing", body: `{}`},
		{name: "name, trimmed", body: `{"name":"  Budi Santoso "}`, wantName: str("Budi Santoso")},
		{name: "phone, trimmed", body: `{"phone":" 081234567890 "}`, wantSet: true, wantPhone: str("081234567890")},
		{name: "phone null removes it", body: `{"phone":null}`, wantSet: true},
		{name: "international phone", body: `{"phone":"+6281234567890"}`, wantSet: true, wantPhone: str("+6281234567890")},
		{name: "both", body: `{"name":"Budi","phone":null}`, wantName: str("Budi"), wantSet: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeProfiles{update: func(string, user.ProfileUpdate) (user.User, error) { return me(), nil }}
			h := user.NewHandler(svc, httpapi.NewValidator())
			rec := serve(h.UpdateMe, http.MethodPatch, tt.body)
			testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
			p := svc.updated
			if p == nil {
				t.Fatal("Update was not called")
			}
			testx.AssertEqual(t, p.Name == nil, tt.wantName == nil, "name %v", p.Name)
			if tt.wantName != nil && p.Name != nil {
				testx.AssertEqual(t, *p.Name, *tt.wantName)
			}
			testx.AssertEqual(t, p.SetPhone, tt.wantSet)
			testx.AssertEqual(t, p.Phone == nil, tt.wantPhone == nil, "phone %v", p.Phone)
			if tt.wantPhone != nil && p.Phone != nil {
				testx.AssertEqual(t, *p.Phone, *tt.wantPhone)
			}
		})
	}
}

func TestHandler_UpdateMeValidation(t *testing.T) {
	tests := []struct {
		name string
		body string
		want map[string]string
	}{
		{name: "empty name", body: `{"name":""}`, want: map[string]string{"name": "is required"}},
		{name: "blank name", body: `{"name":"   "}`, want: map[string]string{"name": "is required"}},
		{name: "long name", body: `{"name":"` + strings.Repeat("n", 101) + `"}`, want: map[string]string{"name": "must be at most 100 characters"}},
		{name: "name with NUL", body: `{"name":"Bu\u0000di"}`, want: map[string]string{"name": httpapi.InvalidTextMessage}},
		{name: "phone a number", body: `{"phone":81234567890}`, want: map[string]string{"phone": "must be a string or null"}},
		{name: "phone an object", body: `{"phone":{}}`, want: map[string]string{"phone": "must be a string or null"}},
		{name: "phone too short", body: `{"phone":"0812"}`,
			want: map[string]string{"phone": "must be an Indonesian phone number such as 081234567890 or +6281234567890"}},
		{name: "phone empty", body: `{"phone":""}`, want: map[string]string{"phone": "is required"}},
		{name: "both wrong", body: `{"name":"","phone":"x"}`, want: map[string]string{
			"name": "is required", "phone": "must be an Indonesian phone number such as 081234567890 or +6281234567890"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeProfiles{}
			h := user.NewHandler(svc, httpapi.NewValidator())
			b := decodeError(t, serve(h.UpdateMe, http.MethodPatch, tt.body), http.StatusBadRequest, "VALIDATION_FAILED")
			testx.AssertEqual(t, len(b.Error.Details), len(tt.want), "details %v", b.Error.Details)
			for k, v := range tt.want {
				testx.AssertEqual(t, b.Error.Details[k], any(v), "details[%s]", k)
			}
			testx.AssertTrue(t, svc.updated == nil, "the service is not called")
		})
	}
}

func TestHandler_UpdateMeRefusesOtherFields(t *testing.T) {
	for _, body := range []string{`{"email":"new@example.com"}`, `{"role":"admin"}`, `[]`, ``} {
		svc := &fakeProfiles{}
		h := user.NewHandler(svc, httpapi.NewValidator())
		decodeError(t, serve(h.UpdateMe, http.MethodPatch, body), http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertTrue(t, svc.updated == nil, "body %q reached the service", body)
	}
}

func TestHandler_UpdateMeServiceErrors(t *testing.T) {
	gone := &fakeProfiles{update: func(string, user.ProfileUpdate) (user.User, error) { return user.User{}, user.ErrNotFound }}
	decodeError(t, serve(user.NewHandler(gone, httpapi.NewValidator()).UpdateMe, http.MethodPatch, `{}`),
		http.StatusUnauthorized, "UNAUTHORIZED")
	broken := &fakeProfiles{update: func(string, user.ProfileUpdate) (user.User, error) { return user.User{}, errBoom }}
	decodeError(t, serve(user.NewHandler(broken, httpapi.NewValidator()).UpdateMe, http.MethodPatch, `{}`),
		http.StatusInternalServerError, "INTERNAL_ERROR")
}

func TestHandler_DeleteMe(t *testing.T) {
	var deleted string
	h := user.NewHandler(&fakeProfiles{delete: func(id string) error { deleted = id; return nil }}, httpapi.NewValidator())
	rec := serve(h.DeleteMe, http.MethodDelete, "")
	testx.AssertEqual(t, rec.Code, http.StatusNoContent)
	testx.AssertEqual(t, rec.Body.Len(), 0)
	testx.AssertEqual(t, deleted, uid)

	gone := user.NewHandler(&fakeProfiles{delete: func(string) error { return user.ErrNotFound }}, httpapi.NewValidator())
	decodeError(t, serve(gone.DeleteMe, http.MethodDelete, ""), http.StatusUnauthorized, "UNAUTHORIZED")
	broken := user.NewHandler(&fakeProfiles{delete: func(string) error { return errBoom }}, httpapi.NewValidator())
	decodeError(t, serve(broken.DeleteMe, http.MethodDelete, ""), http.StatusInternalServerError, "INTERNAL_ERROR")
}

func TestHandler_Routes(t *testing.T) {
	r := chi.NewRouter()
	user.NewHandler(&fakeProfiles{}, httpapi.NewValidator()).Routes(r)
	for _, m := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete} {
		testx.AssertTrue(t, r.Match(chi.NewRouteContext(), m, "/me"), "%s /me", m)
	}
	testx.AssertFalse(t, r.Match(chi.NewRouteContext(), http.MethodPost, "/me"))
}
