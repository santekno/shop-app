package banner_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/banner"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

type fakeLister struct {
	banners []banner.Banner
	err     error
	calls   int
}

func (f *fakeLister) List(context.Context) ([]banner.Banner, error) {
	f.calls++
	return f.banners, f.err
}

func serve(svc *fakeLister, method string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Route("/v1", banner.NewHandler(svc).Routes)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), method, "/v1/banners", nil))
	return rec
}

func TestHandler_List(t *testing.T) {
	svc := &fakeLister{banners: []banner.Banner{
		{ID: "b1", Title: "Diskon", Subtitle: "Sampai Minggu", CTALabel: "Belanja", LinkCategorySlug: "kaos", BackgroundColor: "#112233"},
		{ID: "b2", Title: "Baru", BackgroundColor: "#445566"},
	}}

	rec := serve(svc, http.MethodGet)

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, svc.calls, 1)
	testx.AssertContains(t, rec.Header().Get("Content-Type"), "application/json")
	var resp struct {
		Data []map[string]any `json:"data"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	testx.AssertEqual(t, len(resp.Data), 2)
	// The order of the service is the order of the carousel.
	testx.AssertEqual(t, resp.Data[0]["id"], any("b1"))
	testx.AssertEqual(t, resp.Data[1]["id"], any("b2"))

	full := resp.Data[0]
	testx.AssertEqual(t, full["title"], any("Diskon"))
	testx.AssertEqual(t, full["subtitle"], any("Sampai Minggu"))
	testx.AssertEqual(t, full["cta_label"], any("Belanja"))
	testx.AssertEqual(t, full["link_category_slug"], any("kaos"))
	testx.AssertEqual(t, full["background_color"], any("#112233"))
	testx.AssertEqual(t, len(full), 6, "exactly the contract's fields: %v", full)
}

// The contract wants null, not a missing key and not "".
func TestHandler_List_NullableFieldsAreNull(t *testing.T) {
	svc := &fakeLister{banners: []banner.Banner{{ID: "b1", Title: "Polos", BackgroundColor: "#445566"}}}

	rec := serve(svc, http.MethodGet)

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()),
		`{"data":[{"id":"b1","title":"Polos","subtitle":null,"cta_label":null,"link_category_slug":null,"background_color":"#445566"}]}`)
}

func TestHandler_List_Empty(t *testing.T) {
	tests := []struct {
		name    string
		banners []banner.Banner
	}{
		{name: "nil slice", banners: nil},
		{name: "empty slice", banners: []banner.Banner{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(&fakeLister{banners: tt.banners}, http.MethodGet)

			testx.AssertEqual(t, rec.Code, http.StatusOK)
			testx.AssertEqual(t, strings.TrimSpace(rec.Body.String()), `{"data":[]}`, "[] rather than null")
		})
	}
}

func TestHandler_List_ServiceError(t *testing.T) {
	svc := &fakeLister{err: errors.New("connection refused")}

	rec := serve(svc, http.MethodGet)

	testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	testx.AssertEqual(t, body.Error.Code, httpapi.CodeInternal)
	testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "internal error leaked")
}

func TestHandler_OnlyGET(t *testing.T) {
	svc := &fakeLister{}

	rec := serve(svc, http.MethodPost)

	testx.AssertEqual(t, rec.Code, http.StatusMethodNotAllowed)
	testx.AssertEqual(t, svc.calls, 0)
}
