package user_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

const uid = "0190c8a0-0000-7000-8000-000000000001"

var errBoom = errors.New("boom")

// fakeRepo is a user.Repository with each method a field.
type fakeRepo struct {
	get       func(id string) (user.User, error)
	update    func(id string, p user.ProfileUpdate) (user.User, error)
	anonymise func(id string) ([]string, error)
}

func (r *fakeRepo) Get(_ context.Context, id string) (user.User, error) { return r.get(id) }
func (r *fakeRepo) Update(_ context.Context, id string, p user.ProfileUpdate) (user.User, error) {
	return r.update(id, p)
}
func (r *fakeRepo) Anonymise(_ context.Context, id string) ([]string, error) { return r.anonymise(id) }

// fakeProfiles is a user.Profiles with each method a field.
type fakeProfiles struct {
	get     func(id string) (user.User, error)
	update  func(id string, p user.ProfileUpdate) (user.User, error)
	delete  func(id string) error
	updated *user.ProfileUpdate
}

func (f *fakeProfiles) Get(_ context.Context, id string) (user.User, error) { return f.get(id) }
func (f *fakeProfiles) Update(_ context.Context, id string, p user.ProfileUpdate) (user.User, error) {
	f.updated = &p
	return f.update(id, p)
}
func (f *fakeProfiles) Delete(_ context.Context, id string) error { return f.delete(id) }

// serve calls fn as the user uid with body.
func serve(fn http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	ctx := ctxx.WithUserID(context.Background(), uid)
	r := httptest.NewRequestWithContext(ctx, method, "/v1/me", strings.NewReader(body))
	rec := httptest.NewRecorder()
	fn(rec, r)
	return rec
}

type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) errorBody {
	t.Helper()
	testx.AssertEqual(t, rec.Code, status, "body %s", rec.Body.String())
	var b errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	testx.AssertEqual(t, b.Error.Code, code)
	return b
}

func me() user.User {
	return user.User{ID: uid, Email: "budi@example.com", Name: "Budi", Role: user.RoleBuyer}
}

// fakeRevoker records Revoke calls.
type fakeRevoker struct {
	calls [][]string
	err   error
}

func (f *fakeRevoker) Revoke(_ context.Context, ids ...string) error {
	f.calls = append(f.calls, ids)
	return f.err
}
