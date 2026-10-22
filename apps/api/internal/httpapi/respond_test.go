package httpapi_test

import (
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

func TestJSON(t *testing.T) {
	type item struct {
		Name  string  `json:"name"`
		Price float64 `json:"price"`
	}
	tests := []struct {
		name     string
		status   int
		v        any
		wantBody string
	}{
		{name: "struct with 200", status: http.StatusOK, v: item{Name: "Kaos", Price: 50000}, wantBody: `{"name":"Kaos","price":50000}` + "\n"},
		{name: "201", status: http.StatusCreated, v: map[string]int{"id": 7}, wantBody: `{"id":7}` + "\n"},
		{name: "HTML characters are not escaped", status: http.StatusOK, v: item{Name: "Makanan & Minuman <Promo>"}, wantBody: `{"name":"Makanan & Minuman <Promo>","price":0}` + "\n"},
		{name: "empty slice", status: http.StatusOK, v: []int{}, wantBody: "[]\n"},
		{name: "nil", status: http.StatusOK, v: nil, wantBody: "null\n"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, logs := requestWithLogger(http.MethodGet, "/")
			rec := httptest.NewRecorder()

			httpapi.JSON(rec, r, tt.status, tt.v)

			testx.AssertEqual(t, rec.Code, tt.status)
			testx.AssertEqual(t, rec.Header().Get("Content-Type"), "application/json; charset=utf-8")
			testx.AssertEqual(t, rec.Body.String(), tt.wantBody)
			testx.AssertEqual(t, logs.Len(), 0, "nothing is logged on success")
		})
	}
}

func TestJSON_EncodeFailure(t *testing.T) {
	tests := []struct {
		name string
		v    any
	}{
		{name: "NaN", v: map[string]float64{"price": math.NaN()}},
		{name: "channel", v: map[string]any{"c": make(chan int)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, logs := requestWithLogger(http.MethodGet, "/v1/categories")
			rec := httptest.NewRecorder()

			httpapi.JSON(rec, r, http.StatusOK, tt.v)

			// A clean 500 in the error shape, never a 200 with half a body.
			testx.AssertEqual(t, rec.Code, http.StatusInternalServerError)
			body := decodeError(t, rec)
			testx.AssertEqual(t, body.Error.Code, httpapi.CodeInternal)
			testx.AssertEqual(t, body.Error.Message, "internal server error")

			lines := logLines(t, logs)
			if len(lines) != 1 {
				t.Fatalf("want 1 log line, got %d", len(lines))
			}
			msg, _ := lines[0]["error"].(string)
			testx.AssertContains(t, msg, "encode map[string]")
		})
	}
}
