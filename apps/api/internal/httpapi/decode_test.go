package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// variantRequest is a small request body with the JSON types DecodeJSON has
// to tell apart.
type variantRequest struct {
	SKU   string `json:"sku"`
	Price int64  `json:"price"`
	Tags  []string
}

// decode runs DecodeJSON on a POST with body.
func decode(t *testing.T, body string) (variantRequest, error) {
	t.Helper()
	var dst variantRequest
	r := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/admin/products", strings.NewReader(body))
	err := httpapi.DecodeJSON(httptest.NewRecorder(), r, &dst)
	return dst, err
}

func TestDecodeJSON_OK(t *testing.T) {
	got, err := decode(t, `{"sku":"KPH-S","price":89000,"Tags":["a","b"]}`+"\n \t")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.SKU, "KPH-S")
	testx.AssertEqual(t, got.Price, int64(89000))
	testx.AssertEqual(t, len(got.Tags), 2, "trailing whitespace is not trailing data")
}

func TestDecodeJSON_AtTheSizeLimit(t *testing.T) {
	// Exactly MaxBodyBytes is still accepted: the limit is inclusive.
	prefix, suffix := `{"sku":"`, `"}`
	body := prefix + strings.Repeat("A", httpapi.MaxBodyBytes-len(prefix)-len(suffix)) + suffix
	testx.AssertEqual(t, len(body), httpapi.MaxBodyBytes)

	got, err := decode(t, body)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got.SKU), httpapi.MaxBodyBytes-len(prefix)-len(suffix))
}

func TestDecodeJSON_Invalid(t *testing.T) {
	tooLarge := `{"sku":"` + strings.Repeat("A", httpapi.MaxBodyBytes) + `"}`
	tests := []struct {
		name     string
		body     string
		wantBody string // details.body, exactly or as a prefix (wantPrefix)
		prefix   bool
		notIn    []string // must not appear in the message
	}{
		{name: "empty", body: "", wantBody: "is empty"},
		{name: "only whitespace", body: "  \n", wantBody: "is empty"},
		{
			name: "syntax error", body: `{"sku": "KPH-S",}`, prefix: true,
			wantBody: "must be valid JSON matching the schema: ",
		},
		{
			name: "unknown field is refused and named", body: `{"sku":"KPH-S","prcie":1}`, prefix: true,
			wantBody: `must be valid JSON matching the schema: json: unknown field "prcie"`,
		},
		{
			name: "wrong type names the json field, not the Go type", body: `{"price":"89000"}`,
			wantBody: "field price has the wrong JSON type",
			notIn:    []string{"int64", "variantRequest", "89000"},
		},
		{
			name: "wrong type inside a slice", body: `{"Tags":[1]}`,
			wantBody: "field Tags has the wrong JSON type",
		},
		{name: "an array is not an object", body: `[{"sku":"KPH-S"}]`, wantBody: "must be a JSON object"},
		{name: "a string is not an object", body: `"KPH-S"`, wantBody: "must be a JSON object"},
		{name: "too large", body: tooLarge, wantBody: "must be at most 1048576 bytes", notIn: []string{"AAAA"}},
		{name: "two objects", body: `{"sku":"A"}{"sku":"B"}`, wantBody: "must contain a single JSON object"},
		{name: "trailing garbage", body: `{"sku":"A"} x`, wantBody: "must contain a single JSON object"},
		{name: "trailing value", body: `{"sku":"A"} 1`, wantBody: "must contain a single JSON object"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := decode(t, tt.body)

			got := details(t, err, "invalid request body")
			testx.AssertEqual(t, len(got), 1, "only body is reported: %v", got)
			msg, _ := got["body"].(string)
			if tt.prefix {
				testx.AssertTrue(t, strings.HasPrefix(msg, tt.wantBody), "details.body = %q, want prefix %q", msg, tt.wantBody)
			} else {
				testx.AssertEqual(t, msg, tt.wantBody)
			}
			for _, s := range tt.notIn {
				testx.AssertFalse(t, strings.Contains(msg, s), "details.body %q contains %q", msg, s)
			}
		})
	}
}

// The error renders as a 400 VALIDATION_FAILED through httpapi.Error, the
// way every handler answers.
func TestDecodeJSON_Response(t *testing.T) {
	_, err := decode(t, `{"sku":`)
	rec := httptest.NewRecorder()
	httpapi.Error(rec, httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", nil), err)

	testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
	body := decodeError(t, rec)
	testx.AssertEqual(t, body.Error.Code, httpapi.CodeValidationFailed)
	testx.AssertEqual(t, body.Error.Message, "invalid request body")
	testx.AssertContains(t, body.Error.Details["body"].(string), "must be valid JSON")
}
