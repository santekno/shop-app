package wishlist_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/wishlist"
)

const callerID = "0190c8a0-0000-7000-8000-0000000000e1"

// fakeList is wishlist.List: it records the calls and answers from fields.
type fakeList struct {
	adds, removes []string // "user slug"
	addErr        error
	removeErr     error

	listCalls []string // "user cursor limit"
	page      wishlist.Page
	listErr   error
}

func (f *fakeList) Add(_ context.Context, userID, slug string) error {
	f.adds = append(f.adds, userID+" "+slug)
	return f.addErr
}

func (f *fakeList) Remove(_ context.Context, userID, slug string) error {
	f.removes = append(f.removes, userID+" "+slug)
	return f.removeErr
}

func (f *fakeList) List(_ context.Context, userID, cursor string, limit int) (wishlist.Page, error) {
	f.listCalls = append(f.listCalls, userID+" "+cursor+" "+itoa(limit))
	return f.page, f.listErr
}

func itoa(n int) string { b, _ := json.Marshal(n); return string(b) }

// productJSON is a stand-in for product.Handler.ProductJSON.
func productJSON(p product.Product) any {
	return map[string]any{"id": p.ID, "slug": p.Slug}
}

// serve sends one request as the caller (userID empty: no user in the
// context, as when the auth middleware is missing).
func serve(svc *fakeList, userID, method, target string) *httptest.ResponseRecorder {
	h := wishlist.NewHandler(svc, httpapi.NewValidator(), productJSON)
	r := chi.NewRouter()
	r.Route("/v1", h.Routes)
	ctx := context.Background()
	if userID != "" {
		ctx = ctxx.WithUserID(ctx, userID)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequestWithContext(ctx, method, target, nil))
	return rec
}

type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) errorBody {
	t.Helper()
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
	}
	return body
}

func TestHandler_Add(t *testing.T) {
	svc := &fakeList{}

	rec := serve(svc, callerID, http.MethodPut, "/v1/me/wishlist/kaos-polos-hitam")

	testx.AssertEqual(t, rec.Code, http.StatusNoContent)
	testx.AssertEqual(t, rec.Body.Len(), 0)
	testx.AssertEqual(t, strings.Join(svc.adds, ","), callerID+" kaos-polos-hitam", "the user comes from the context, the slug from the URL")
}

func TestHandler_Add_Errors(t *testing.T) {
	tests := []struct {
		name        string
		slug        string
		addErr      error
		wantStatus  int
		wantCode    string
		wantDetails map[string]any
		wantCalled  bool
	}{
		{name: "unknown product", slug: "tidak-ada", addErr: wishlist.ErrProductNotFound, wantStatus: 404, wantCode: httpapi.CodeNotFound, wantCalled: true},
		{name: "wrapped unknown product", slug: "tidak-ada", addErr: errors.Join(errors.New("x"), wishlist.ErrProductNotFound), wantStatus: 404, wantCode: httpapi.CodeNotFound, wantCalled: true},
		{
			name: "the wishlist is full", slug: "kaos", addErr: wishlist.ErrLimitReached,
			wantStatus: 409, wantCode: "WISHLIST_LIMIT_REACHED", wantDetails: map[string]any{"max": json.Number("200")}, wantCalled: true,
		},
		{name: "the account is gone", slug: "kaos", addErr: wishlist.ErrNoUser, wantStatus: 401, wantCode: httpapi.CodeUnauthorized, wantCalled: true},
		{name: "storage failure", slug: "kaos", addErr: errors.New("connection refused"), wantStatus: 500, wantCode: httpapi.CodeInternal, wantCalled: true},
		{name: "upper case slug", slug: "Kaos", wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "double hyphen", slug: "kaos--polos", wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "trailing hyphen", slug: "kaos-", wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "underscore", slug: "kaos_polos", wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "longer than 200", slug: strings.Repeat("a", 201), wantStatus: 404, wantCode: httpapi.CodeNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeList{addErr: tt.addErr}

			rec := serve(svc, callerID, http.MethodPut, "/v1/me/wishlist/"+tt.slug)

			testx.AssertEqual(t, rec.Code, tt.wantStatus, "body %s", rec.Body.String())
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			testx.AssertEqual(t, len(svc.adds) == 1, tt.wantCalled, "service called %d times", len(svc.adds))
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "internal error leaked")
			if tt.wantDetails != nil {
				dec := json.NewDecoder(strings.NewReader(rec.Body.String()))
				dec.UseNumber()
				var raw struct {
					Error struct {
						Details map[string]any `json:"details"`
					} `json:"error"`
				}
				testx.AssertNoError(t, dec.Decode(&raw))
				for k, v := range tt.wantDetails {
					testx.AssertEqual(t, raw.Error.Details[k], v, "details.%s", k)
				}
			}
		})
	}

	t.Run("200 characters is still a slug", func(t *testing.T) {
		svc := &fakeList{}
		rec := serve(svc, callerID, http.MethodPut, "/v1/me/wishlist/"+strings.Repeat("a", 200))
		testx.AssertEqual(t, rec.Code, http.StatusNoContent)
		testx.AssertEqual(t, len(svc.adds), 1)
	})
}

func TestHandler_Add_LimitMessage(t *testing.T) {
	rec := serve(&fakeList{addErr: wishlist.ErrLimitReached}, callerID, http.MethodPut, "/v1/me/wishlist/kaos")

	body := decodeError(t, rec)
	testx.AssertEqual(t, body.Error.Message, "your wishlist is full; remove a product first")
	testx.AssertEqual(t, body.Error.Details["max"], any(float64(wishlist.MaxItems)))
}

func TestHandler_Remove(t *testing.T) {
	tests := []struct {
		name       string
		slug       string
		removeErr  error
		wantStatus int
		wantCalled bool
	}{
		{name: "a saved product", slug: "kaos-polos-hitam", wantStatus: 204, wantCalled: true},
		{name: "a product that is not saved or unknown", slug: "tidak-ada", wantStatus: 204, wantCalled: true},
		{name: "a malformed slug is 204 without a query", slug: "Kaos_Polos", wantStatus: 204},
		{name: "a slug longer than 200 is 204 without a query", slug: strings.Repeat("a", 201), wantStatus: 204},
		{name: "storage failure", slug: "kaos", removeErr: errors.New("connection refused"), wantStatus: 500, wantCalled: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeList{removeErr: tt.removeErr}

			rec := serve(svc, callerID, http.MethodDelete, "/v1/me/wishlist/"+tt.slug)

			testx.AssertEqual(t, rec.Code, tt.wantStatus, "body %s", rec.Body.String())
			testx.AssertEqual(t, len(svc.removes) == 1, tt.wantCalled, "service called %d times", len(svc.removes))
			if tt.wantCalled {
				testx.AssertEqual(t, svc.removes[0], callerID+" "+tt.slug)
			}
			if tt.wantStatus == http.StatusNoContent {
				testx.AssertEqual(t, rec.Body.Len(), 0)
			} else {
				testx.AssertEqual(t, decodeError(t, rec).Error.Code, httpapi.CodeInternal)
				testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "internal error leaked")
			}
		})
	}
}

func TestHandler_List(t *testing.T) {
	svc := &fakeList{page: wishlist.Page{
		Products:   []product.Product{{ID: "p1", Slug: "satu"}, {ID: "p2", Slug: "dua"}},
		NextCursor: "next-abc",
	}}

	rec := serve(svc, callerID, http.MethodGet, "/v1/me/wishlist")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.Join(svc.listCalls, ","), callerID+"  20", "no cursor, default limit 20, the user from the context")
	var resp struct {
		Data []map[string]any `json:"data"`
		Page struct {
			NextCursor *string `json:"next_cursor"`
		} `json:"page"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	testx.AssertEqual(t, len(resp.Data), 2)
	testx.AssertEqual(t, resp.Data[0]["slug"], any("satu"), "the order of the page is kept")
	testx.AssertEqual(t, resp.Data[1]["slug"], any("dua"))
	testx.AssertTrue(t, resp.Page.NextCursor != nil && *resp.Page.NextCursor == "next-abc", "next_cursor = %v", resp.Page.NextCursor)
}

func TestHandler_List_Query(t *testing.T) {
	svc := &fakeList{}

	rec := serve(svc, callerID, http.MethodGet, "/v1/me/wishlist?cursor=abc&limit=100")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.Join(svc.listCalls, ","), callerID+" abc 100")
}

func TestHandler_List_Empty(t *testing.T) {
	tests := []struct {
		name string
		page wishlist.Page
	}{
		{name: "nil products", page: wishlist.Page{}},
		{name: "empty products", page: wishlist.Page{Products: []product.Product{}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(&fakeList{page: tt.page}, callerID, http.MethodGet, "/v1/me/wishlist")

			testx.AssertEqual(t, rec.Code, http.StatusOK)
			testx.AssertEqual(t, rec.Body.String(), `{"data":[],"page":{"next_cursor":null}}`+"\n", "[] and null, not null and missing")
		})
	}
}

func TestHandler_List_Invalid(t *testing.T) {
	tests := []struct {
		name        string
		query       string
		listErr     error
		wantStatus  int
		wantCode    string
		wantDetails map[string]any
		wantCalled  bool
	}{
		{name: "limit 0", query: "limit=0", wantStatus: 400, wantCode: httpapi.CodeValidationFailed, wantDetails: map[string]any{"limit": "must be between 1 and 100"}},
		{name: "limit 101", query: "limit=101", wantStatus: 400, wantCode: httpapi.CodeValidationFailed, wantDetails: map[string]any{"limit": "must be between 1 and 100"}},
		{name: "limit is not a number", query: "limit=abc", wantStatus: 400, wantCode: httpapi.CodeValidationFailed},
		{
			name: "cursor over 512 characters", query: "cursor=" + strings.Repeat("a", 513), wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"cursor": "must be at most 512 characters"},
		},
		{
			name: "a cursor the service refuses", query: "cursor=abc", listErr: errors.Join(errors.New("x"), wishlist.ErrInvalidCursor),
			wantStatus: 400, wantCode: httpapi.CodeValidationFailed, wantCalled: true,
			wantDetails: map[string]any{"cursor": "is not a cursor from page.next_cursor for the wishlist; start again without it"},
		},
		{name: "storage failure", listErr: errors.New("connection refused"), wantStatus: 500, wantCode: httpapi.CodeInternal, wantCalled: true},
		{name: "the account is gone", listErr: wishlist.ErrNoUser, wantStatus: 401, wantCode: httpapi.CodeUnauthorized, wantCalled: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := &fakeList{listErr: tt.listErr}

			rec := serve(svc, callerID, http.MethodGet, "/v1/me/wishlist?"+tt.query)

			testx.AssertEqual(t, rec.Code, tt.wantStatus, "body %s", rec.Body.String())
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, tt.wantCode)
			for k, v := range tt.wantDetails {
				testx.AssertEqual(t, body.Error.Details[k], v, "details.%s", k)
			}
			testx.AssertEqual(t, len(svc.listCalls) == 1, tt.wantCalled, "service called %d times", len(svc.listCalls))
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "connection refused"), "internal error leaked")
		})
	}
}

func TestHandler_OnlyTheDocumentedMethods(t *testing.T) {
	for _, tt := range []struct{ method, path string }{
		{http.MethodPost, "/v1/me/wishlist"},
		{http.MethodPut, "/v1/me/wishlist"},
		{http.MethodGet, "/v1/me/wishlist/kaos"},
		{http.MethodPost, "/v1/me/wishlist/kaos"},
	} {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			svc := &fakeList{}
			rec := serve(svc, callerID, tt.method, tt.path)
			testx.AssertTrue(t, rec.Code == http.StatusMethodNotAllowed || rec.Code == http.StatusNotFound, "status %d", rec.Code)
			testx.AssertEqual(t, len(svc.adds)+len(svc.removes)+len(svc.listCalls), 0)
		})
	}
}
