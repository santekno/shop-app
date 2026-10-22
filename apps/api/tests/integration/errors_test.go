//go:build integration

package integration_test

import (
	"encoding/json"
	"net/http"
	"regexp"
	"testing"
)

var errorCodePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)

// assertKeys fails unless obj has exactly the keys want.
func assertKeys(t *testing.T, obj map[string]json.RawMessage, want []string, what string) {
	t.Helper()
	got := make(map[string]bool, len(obj))
	for k := range obj {
		got[k] = true
	}
	for _, k := range want {
		if !got[k] {
			t.Errorf("%s: missing key %q (has %v)", what, k, keys(obj))
		}
		delete(got, k)
	}
	for k := range got {
		t.Errorf("%s: unexpected key %q (the contract allows only %v)", what, k, want)
	}
}

// assertErrorBody fails unless body is exactly the contract's Error schema
// without details: {"error":{"code":"<wantCode>","message":"<non-empty>"}}.
func assertErrorBody(t *testing.T, body []byte, wantCode string) {
	t.Helper()
	outer := decodeObject(t, body)
	assertKeys(t, outer, []string{"error"}, "error body")
	inner := decodeObject(t, outer["error"])
	assertKeys(t, inner, []string{"code", "message"}, `error body "error"`)

	var code, message string
	if err := json.Unmarshal(inner["code"], &code); err != nil {
		t.Fatalf("error.code is not a string: %s", inner["code"])
	}
	if err := json.Unmarshal(inner["message"], &message); err != nil {
		t.Fatalf("error.message is not a string: %s", inner["message"])
	}
	if code != wantCode {
		t.Errorf("error.code = %q, want %q", code, wantCode)
	}
	if !errorCodePattern.MatchString(code) {
		t.Errorf("error.code %q is not SCREAMING_SNAKE_CASE", code)
	}
	if message == "" {
		t.Error("error.message is empty")
	}
}

// TestErrors_UnknownRoutesAndMethods checks that requests no handler serves
// get the API's one error body as JSON, over the real router: 404 NOT_FOUND
// for unknown paths (and for a product slug that names no product) and 405
// METHOD_NOT_ALLOWED with an Allow header for a wrong method.
func TestErrors_UnknownRoutesAndMethods(t *testing.T) {
	s := startServer(t, nil)

	tests := []struct {
		method     string
		path       string
		wantStatus int
		wantCode   string
		wantAllow  string // "" means the Allow header must be absent
	}{
		{http.MethodGet, "/", http.StatusNotFound, "NOT_FOUND", ""},
		{http.MethodGet, "/does-not-exist", http.StatusNotFound, "NOT_FOUND", ""},
		{http.MethodGet, "/v1", http.StatusNotFound, "NOT_FOUND", ""},
		{http.MethodGet, "/v1/does-not-exist", http.StatusNotFound, "NOT_FOUND", ""},
		{http.MethodGet, "/v1/products/kaos-polos-hitam", http.StatusNotFound, "NOT_FOUND", ""},
		{http.MethodGet, "/v1/categories/kaos", http.StatusNotFound, "NOT_FOUND", ""},
		{http.MethodPost, "/v1/does-not-exist", http.StatusNotFound, "NOT_FOUND", ""},
		{http.MethodPost, "/v1/categories", http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET, HEAD"},
		{http.MethodPut, "/v1/categories", http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET, HEAD"},
		{http.MethodDelete, "/v1/categories", http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET, HEAD"},
		{http.MethodPatch, "/healthz", http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET, HEAD"},
		{http.MethodPost, "/readyz", http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET, HEAD"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			resp := s.do(t, tt.method, tt.path, nil)
			if resp.Status != tt.wantStatus {
				t.Fatalf("status = %d, want %d: %s", resp.Status, tt.wantStatus, resp.Body)
			}
			assertJSONContentType(t, resp.Header, tt.method+" "+tt.path)
			assertErrorBody(t, resp.Body, tt.wantCode)

			allow, hasAllow := resp.Header["Allow"]
			if tt.wantAllow == "" && hasAllow {
				t.Errorf("Allow = %q on a %d, want no Allow header", allow, resp.Status)
			}
			if tt.wantAllow != "" && resp.Header.Get("Allow") != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", resp.Header.Get("Allow"), tt.wantAllow)
			}
			// Errors go through the same middleware as successes.
			if resp.Header.Get("X-Request-ID") == "" {
				t.Error("error response has no X-Request-ID")
			}
		})
	}
}

// TestErrors_ContractShape ties assertErrorBody to the contract: the Error
// schema and its nested "error" object are what the test checks for.
func TestErrors_ContractShape(t *testing.T) {
	s := contractSchema(t, "Error")
	if len(s.Required) != 1 || s.Required[0] != "error" || !s.NoAdditionalProperty {
		t.Fatalf("the Error schema changed (%+v): update assertErrorBody to match", s)
	}
}
