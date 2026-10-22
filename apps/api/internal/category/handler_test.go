package category_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// fakeLister stands in for the service: the handler only needs List.
type fakeLister struct {
	categories []category.Category
	err        error
	gotCtx     context.Context
}

func (f *fakeLister) List(ctx context.Context) ([]category.Category, error) {
	f.gotCtx = ctx
	return f.categories, f.err
}

// serve sends GET /v1/categories through the handler's own routes.
func serve(t *testing.T, lister category.Lister) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Route("/v1", category.NewHandler(lister).Routes)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/categories", nil))
	return rec
}

func TestHandler_List_OK(t *testing.T) {
	parent := "0190a000-0000-7000-8000-000000000001"
	lister := &fakeLister{categories: []category.Category{
		{ID: parent, Slug: "makanan-minuman", Name: "Makanan & Minuman"},
		{ID: "0190a000-0000-7000-8000-000000000002", Slug: "kopi-teh", Name: "Kopi & Teh", ParentID: &parent},
	}}

	rec := serve(t, lister)

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, rec.Header().Get("Content-Type"), "application/json; charset=utf-8")
	want := `{"data":[` +
		`{"id":"0190a000-0000-7000-8000-000000000001","slug":"makanan-minuman","name":"Makanan & Minuman","parent_id":null},` +
		`{"id":"0190a000-0000-7000-8000-000000000002","slug":"kopi-teh","name":"Kopi & Teh","parent_id":"0190a000-0000-7000-8000-000000000001"}` +
		`]}` + "\n"
	testx.AssertEqual(t, rec.Body.String(), want)
	testx.AssertTrue(t, lister.gotCtx != nil, "the request context is passed to the service")
}

func TestHandler_List_Empty(t *testing.T) {
	tests := []struct {
		name string
		in   []category.Category
	}{
		{name: "nil slice", in: nil},
		{name: "empty slice", in: []category.Category{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(t, &fakeLister{categories: tt.in})
			testx.AssertEqual(t, rec.Code, http.StatusOK)
			testx.AssertEqual(t, rec.Body.String(), `{"data":[]}`+"\n")
		})
	}
}

func TestHandler_List_ServiceError(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		wantStatus  int
		wantCode    string
		wantMessage string
	}{
		{
			name:        "timeout",
			err:         fmt.Errorf("list categories: %w", context.DeadlineExceeded),
			wantStatus:  http.StatusServiceUnavailable,
			wantCode:    "TIMEOUT",
			wantMessage: "request timed out",
		},
		{
			name:        "store failure is hidden",
			err:         errors.New("dial tcp 10.0.0.5:5432: connection refused"),
			wantStatus:  http.StatusInternalServerError,
			wantCode:    "INTERNAL_ERROR",
			wantMessage: "internal server error",
		},
		{
			name:        "cancelled request",
			err:         fmt.Errorf("list categories: %w", context.Canceled),
			wantStatus:  http.StatusInternalServerError,
			wantCode:    "INTERNAL_ERROR",
			wantMessage: "internal server error",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(t, &fakeLister{err: tt.err})

			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			testx.AssertEqual(t, rec.Header().Get("Content-Type"), "application/json; charset=utf-8")
			var body struct {
				Error struct {
					Code    string         `json:"code"`
					Message string         `json:"message"`
					Details map[string]any `json:"details"`
				} `json:"error"`
				Data any `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode %q: %v", rec.Body.String(), err)
			}
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			testx.AssertEqual(t, body.Error.Message, tt.wantMessage)
			testx.AssertEqual(t, len(body.Error.Details), 0)
			testx.AssertNil(t, body.Data, "no data alongside an error")
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "10.0.0.5"), "internal detail leaked: %s", rec.Body.String())
		})
	}
}

func TestHandler_Routes(t *testing.T) {
	r := chi.NewRouter()
	r.Route("/v1", category.NewHandler(&fakeLister{}).Routes)

	tests := []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, "/v1/categories", http.StatusOK},
		{http.MethodPost, "/v1/categories", http.StatusMethodNotAllowed},
		{http.MethodGet, "/categories", http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), tt.method, tt.path, nil))
			testx.AssertEqual(t, rec.Code, tt.want)
		})
	}
}
