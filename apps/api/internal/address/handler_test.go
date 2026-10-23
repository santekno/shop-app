package address_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/address"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

const (
	me      = "0190c8a0-0000-7000-8000-00000000000a"
	addrID  = "0190c8a0-0000-7000-8000-0000000000a1"
	otherID = "0190c8a0-0000-7000-8000-0000000000b1"
)

var errBoom = errors.New("boom")

// fakeBook is an address.Book that keeps the caller's addresses in a map
// and records what it was asked.
type fakeBook struct {
	owned   map[string]address.Address // the caller's addresses by id
	err     error                      // when set, every call fails with it
	calls   []string
	userIDs []string
	input   address.Input
	patch   address.Patch
}

func newFakeBook() *fakeBook {
	return &fakeBook{owned: map[string]address.Address{addrID: sampleAddress()}}
}

func sampleAddress() address.Address {
	wib := time.FixedZone("WIB", 7*3600)
	return address.Address{
		ID: addrID, Label: "Rumah", RecipientName: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1",
		City: "Bandung", Province: "Jawa Barat", PostalCode: "40111", IsDefault: true,
		CreatedAt: time.Date(2026, 10, 23, 9, 0, 0, 0, wib), UpdatedAt: time.Date(2026, 10, 23, 10, 0, 0, 0, wib),
	}
}

func (b *fakeBook) record(name, userID string) error {
	b.calls = append(b.calls, name)
	b.userIDs = append(b.userIDs, userID)
	return b.err
}

func (b *fakeBook) List(_ context.Context, userID string) ([]address.Address, error) {
	if err := b.record("List", userID); err != nil {
		return nil, err
	}
	var out []address.Address
	for _, a := range b.owned {
		out = append(out, a)
	}
	return out, nil
}

func (b *fakeBook) Get(_ context.Context, userID, id string) (address.Address, error) {
	if err := b.record("Get", userID); err != nil {
		return address.Address{}, err
	}
	a, ok := b.owned[id]
	if !ok {
		return address.Address{}, address.ErrNotFound
	}
	return a, nil
}

func (b *fakeBook) Create(_ context.Context, userID string, in address.Input) (address.Address, error) {
	if err := b.record("Create", userID); err != nil {
		return address.Address{}, err
	}
	b.input = in
	a := sampleAddress()
	a.ID = otherID
	return a, nil
}

func (b *fakeBook) Update(_ context.Context, userID, id string, p address.Patch) (address.Address, error) {
	if err := b.record("Update", userID); err != nil {
		return address.Address{}, err
	}
	b.patch = p
	a, ok := b.owned[id]
	if !ok {
		return address.Address{}, address.ErrNotFound
	}
	return a, nil
}

func (b *fakeBook) Delete(_ context.Context, userID, id string) error {
	if err := b.record("Delete", userID); err != nil {
		return err
	}
	if _, ok := b.owned[id]; !ok {
		return address.ErrNotFound
	}
	return nil
}

// serve routes method path with body as the user "me".
func serve(b *fakeBook, method, path, body string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	address.NewHandler(b, httpapi.NewValidator()).Routes(r)
	ctx := ctxx.WithUserID(context.Background(), me)
	req := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func assertError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) errorBody {
	t.Helper()
	testx.AssertEqual(t, rec.Code, status, "body %s", rec.Body.String())
	var b errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	testx.AssertEqual(t, b.Error.Code, code, "body %s", rec.Body.String())
	return b
}

func TestHandler_List(t *testing.T) {
	b := newFakeBook()
	rec := serve(b, http.MethodGet, "/me/addresses", "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.Join(b.userIDs, ","), me, "scoped to the caller from the token")
	var body struct {
		Data []map[string]any `json:"data"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	testx.AssertEqual(t, len(body.Data), 1)
	got := body.Data[0]
	testx.AssertEqual(t, got["id"], any(addrID))
	testx.AssertEqual(t, got["recipient_name"], any("Budi"))
	testx.AssertEqual(t, got["postal_code"], any("40111"))
	testx.AssertEqual(t, got["is_default"], any(true))
	testx.AssertEqual(t, got["created_at"], any("2026-10-23T02:00:00Z"))
	testx.AssertEqual(t, got["updated_at"], any("2026-10-23T03:00:00Z"))
	testx.AssertEqual(t, len(got), 11, "exactly the contract's fields: %v", got)

	empty := &fakeBook{owned: map[string]address.Address{}}
	rec = serve(empty, http.MethodGet, "/me/addresses", "")
	testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()), `{"data":[]}`, "an empty list, not null")

	b.err = errBoom
	assertError(t, serve(b, http.MethodGet, "/me/addresses", ""), http.StatusInternalServerError, "INTERNAL_ERROR")
	gone := &fakeBook{err: address.ErrNoUser}
	assertError(t, serve(gone, http.MethodGet, "/me/addresses", ""), http.StatusUnauthorized, "UNAUTHORIZED")
}

func TestHandler_Get(t *testing.T) {
	b := newFakeBook()
	rec := serve(b, http.MethodGet, "/me/addresses/"+addrID, "")
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertContains(t, rec.Body.String(), `"label":"Rumah"`)

	// Another user's address answers exactly like a missing one.
	rec = serve(b, http.MethodGet, "/me/addresses/"+otherID, "")
	body := assertError(t, rec, http.StatusNotFound, "NOT_FOUND")
	testx.AssertEqual(t, body.Error.Message, "address not found")
}

// An id that is not a UUID is 404 like an unknown one, and never reaches
// the service (or the database).
func TestHandler_NonUUIDIs404WithoutAQuery(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete} {
		for _, id := range []string{"1", "not-a-uuid", "0190c8a0-0000-7000-8000-00000000000g", "%27%20OR%201%3D1"} {
			b := newFakeBook()
			rec := serve(b, method, "/me/addresses/"+id, `{}`)
			body := assertError(t, rec, http.StatusNotFound, "NOT_FOUND")
			testx.AssertEqual(t, body.Error.Message, "address not found")
			testx.AssertEqual(t, len(b.calls), 0, "%s %s reached the service", method, id)
		}
	}
}

func validCreate() map[string]any {
	return map[string]any{
		"label": " Rumah ", "recipient_name": " Budi ", "phone": " 081234567890 ", "street": " Jl. Merdeka 1 ",
		"city": " Bandung ", "province": " Jawa Barat ", "postal_code": " 40111 ", "is_default": true,
	}
}

func jsonBody(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	testx.AssertNoError(t, err)
	return string(b)
}

func TestHandler_Create(t *testing.T) {
	b := newFakeBook()
	rec := serve(b, http.MethodPost, "/me/addresses", jsonBody(t, validCreate()))

	testx.AssertEqual(t, rec.Code, http.StatusCreated, "body %s", rec.Body.String())
	testx.AssertEqual(t, rec.Header().Get("Location"), "/v1/me/addresses/"+otherID)
	testx.AssertEqual(t, b.input, address.Input{
		Label: "Rumah", RecipientName: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1",
		City: "Bandung", Province: "Jawa Barat", PostalCode: "40111", IsDefault: true,
	})
	testx.AssertEqual(t, strings.Join(b.userIDs, ","), me)
}

func TestHandler_CreateValidation(t *testing.T) {
	const phoneMsg = "must be an Indonesian phone number such as 081234567890 or +6281234567890"
	tests := []struct {
		name   string
		change func(m map[string]any)
		want   map[string]any
	}{
		{name: "everything missing", change: func(m map[string]any) { clear(m) }, want: map[string]any{
			"label": "is required", "recipient_name": "is required", "phone": "is required", "street": "is required",
			"city": "is required", "province": "is required", "postal_code": "is required"}},
		{name: "blank after trimming", change: func(m map[string]any) { m["city"] = "   " }, want: map[string]any{"city": "is required"}},
		{name: "phone", change: func(m map[string]any) { m["phone"] = "12345" }, want: map[string]any{"phone": phoneMsg}},
		{name: "postal code", change: func(m map[string]any) { m["postal_code"] = "4011" },
			want: map[string]any{"postal_code": "must be a 5-digit Indonesian postal code"}},
		{name: "label too long", change: func(m map[string]any) { m["label"] = strings.Repeat("l", 51) },
			want: map[string]any{"label": "must be at most 50 characters"}},
		{name: "recipient too long", change: func(m map[string]any) { m["recipient_name"] = strings.Repeat("r", 101) },
			want: map[string]any{"recipient_name": "must be at most 100 characters"}},
		{name: "street too long", change: func(m map[string]any) { m["street"] = strings.Repeat("s", 501) },
			want: map[string]any{"street": "must be at most 500 characters"}},
		{name: "province too long", change: func(m map[string]any) { m["province"] = strings.Repeat("p", 101) },
			want: map[string]any{"province": "must be at most 100 characters"}},
		{name: "NUL in a text field", change: func(m map[string]any) { m["street"] = "Jl.\x00Merdeka" },
			want: map[string]any{"street": httpapi.InvalidTextMessage}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := validCreate()
			tt.change(m)
			b := newFakeBook()
			body := assertError(t, serve(b, http.MethodPost, "/me/addresses", jsonBody(t, m)), http.StatusBadRequest, "VALIDATION_FAILED")
			testx.AssertEqual(t, len(body.Error.Details), len(tt.want), "details %v", body.Error.Details)
			for k, v := range tt.want {
				testx.AssertEqual(t, body.Error.Details[k], v, "details[%s]", k)
			}
			testx.AssertEqual(t, len(b.calls), 0)
		})
	}
}

// The owner comes from the token: a body naming a user is refused.
func TestHandler_CreateRefusesUserID(t *testing.T) {
	m := validCreate()
	m["user_id"] = otherID
	b := newFakeBook()
	assertError(t, serve(b, http.MethodPost, "/me/addresses", jsonBody(t, m)), http.StatusBadRequest, "VALIDATION_FAILED")
	testx.AssertEqual(t, len(b.calls), 0)
}

func TestHandler_ServiceErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		check      func(t *testing.T, b errorBody)
	}{
		{name: "limit", err: address.ErrLimitReached, wantStatus: http.StatusConflict, wantCode: "ADDRESS_LIMIT_REACHED",
			check: func(t *testing.T, b errorBody) {
				testx.AssertEqual(t, b.Error.Details["max"], any(float64(20)))
			}},
		{name: "default required", err: address.ErrDefaultRequired, wantStatus: http.StatusConflict, wantCode: "DEFAULT_ADDRESS_REQUIRED",
			check: func(t *testing.T, b errorBody) {
				testx.AssertEqual(t, b.Error.Message, "make another address the default instead")
				_, ok := b.Error.Details["is_default"]
				testx.AssertTrue(t, ok)
			}},
		{name: "account gone", err: address.ErrNoUser, wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHORIZED"},
		{name: "invalid text", err: address.ErrInvalidText, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED",
			check: func(t *testing.T, b errorBody) {
				testx.AssertEqual(t, b.Error.Details["body"], any(httpapi.InvalidTextMessage))
			}},
		{name: "not found", err: address.ErrNotFound, wantStatus: http.StatusNotFound, wantCode: "NOT_FOUND"},
		{name: "other", err: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}
	requests := []struct{ method, path, body string }{
		{http.MethodPost, "/me/addresses", ""},
		{http.MethodPatch, "/me/addresses/" + addrID, `{"is_default":false}`},
		{http.MethodDelete, "/me/addresses/" + addrID, ""},
		{http.MethodGet, "/me/addresses/" + addrID, ""},
	}
	for _, tt := range tests {
		for _, req := range requests {
			t.Run(tt.name+" "+req.method, func(t *testing.T) {
				body := req.body
				if req.method == http.MethodPost {
					body = jsonBody(t, validCreate())
				}
				b := newFakeBook()
				b.err = tt.err
				eb := assertError(t, serve(b, req.method, req.path, body), tt.wantStatus, tt.wantCode)
				if tt.check != nil {
					tt.check(t, eb)
				}
			})
		}
	}
}

func TestHandler_Update(t *testing.T) {
	t.Run("empty body changes nothing", func(t *testing.T) {
		b := newFakeBook()
		rec := serve(b, http.MethodPatch, "/me/addresses/"+addrID, `{}`)
		testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
		testx.AssertEqual(t, b.patch, address.Patch{})
	})
	t.Run("null keeps a field", func(t *testing.T) {
		b := newFakeBook()
		rec := serve(b, http.MethodPatch, "/me/addresses/"+addrID, `{"label":null,"city":null}`)
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		testx.AssertTrue(t, b.patch.Label == nil && b.patch.City == nil)
	})
	t.Run("values are trimmed", func(t *testing.T) {
		b := newFakeBook()
		rec := serve(b, http.MethodPatch, "/me/addresses/"+addrID,
			`{"label":" Kantor ","phone":" +6281234567890 ","postal_code":" 40112 ","is_default":true}`)
		testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
		testx.AssertTrue(t, b.patch.Label != nil && *b.patch.Label == "Kantor")
		testx.AssertTrue(t, b.patch.Phone != nil && *b.patch.Phone == "+6281234567890")
		testx.AssertTrue(t, b.patch.PostalCode != nil && *b.patch.PostalCode == "40112")
		testx.AssertTrue(t, b.patch.IsDefault != nil && *b.patch.IsDefault)
		testx.AssertTrue(t, b.patch.Street == nil)
	})
	t.Run("another user's address", func(t *testing.T) {
		b := newFakeBook()
		assertError(t, serve(b, http.MethodPatch, "/me/addresses/"+otherID, `{}`), http.StatusNotFound, "NOT_FOUND")
	})
}

func TestHandler_UpdateValidation(t *testing.T) {
	tests := []struct {
		name string
		body string
		want map[string]any
	}{
		{name: "a field cannot be cleared", body: `{"label":""}`, want: map[string]any{"label": "must be between 1 and 50 characters"}},
		{name: "blank is empty", body: `{"street":"   "}`, want: map[string]any{"street": "must be between 1 and 500 characters"}},
		{name: "too long", body: `{"city":"` + strings.Repeat("c", 101) + `"}`, want: map[string]any{"city": "must be between 1 and 100 characters"}},
		{name: "phone", body: `{"phone":"abc"}`,
			want: map[string]any{"phone": "must be an Indonesian phone number such as 081234567890 or +6281234567890"}},
		{name: "postal code", body: `{"postal_code":"123456"}`, want: map[string]any{"postal_code": "must be a 5-digit Indonesian postal code"}},
		{name: "NUL", body: `{"recipient_name":"Bu\u0000di"}`, want: map[string]any{"recipient_name": httpapi.InvalidTextMessage}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := newFakeBook()
			body := assertError(t, serve(b, http.MethodPatch, "/me/addresses/"+addrID, tt.body), http.StatusBadRequest, "VALIDATION_FAILED")
			testx.AssertEqual(t, len(body.Error.Details), len(tt.want), "details %v", body.Error.Details)
			for k, v := range tt.want {
				testx.AssertEqual(t, body.Error.Details[k], v, "details[%s]", k)
			}
			testx.AssertEqual(t, len(b.calls), 0)
		})
	}
	t.Run("bad body", func(t *testing.T) {
		b := newFakeBook()
		assertError(t, serve(b, http.MethodPatch, "/me/addresses/"+addrID, `{"user_id":"x"}`), http.StatusBadRequest, "VALIDATION_FAILED")
		testx.AssertEqual(t, len(b.calls), 0)
	})
}

func TestHandler_Delete(t *testing.T) {
	b := newFakeBook()
	rec := serve(b, http.MethodDelete, "/me/addresses/"+addrID, "")
	testx.AssertEqual(t, rec.Code, http.StatusNoContent)
	testx.AssertEqual(t, rec.Body.Len(), 0)
	testx.AssertEqual(t, strings.Join(b.userIDs, ","), me)

	assertError(t, serve(b, http.MethodDelete, "/me/addresses/"+otherID, ""), http.StatusNotFound, "NOT_FOUND")
}

func TestHandler_CreateBadBody(t *testing.T) {
	b := newFakeBook()
	assertError(t, serve(b, http.MethodPost, "/me/addresses", `[`), http.StatusBadRequest, "VALIDATION_FAILED")
	testx.AssertEqual(t, len(b.calls), 0)
}
