//go:build integration

package integration_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// openAPIPath is api/openapi.yaml, seen from this package's directory
// (go test runs a package's tests in its own directory).
var openAPIPath = filepath.Join("..", "..", "..", "..", "api", "openapi.yaml")

// schema is the part of one components.schemas entry these tests check: the
// required keys, the declared properties, and whether other keys are refused.
type schema struct {
	Required             []string
	Properties           []string
	NoAdditionalProperty bool
}

// allows reports whether key is a declared property.
func (s schema) allows(key string) bool { return slices.Contains(s.Properties, key) }

// contractSchema reads components.schemas.<name> from api/openapi.yaml with a
// small line-based reader. The repo has no YAML library and the contract's
// layout is fixed (two-space indent, flow-style required lists), so this is
// enough to keep the tests' expected field names tied to the contract rather
// than copied into the test: rename a field in the contract and the test
// fails until the API matches.
func contractSchema(t *testing.T, name string) schema {
	t.Helper()
	raw, err := os.ReadFile(openAPIPath) //nolint:gosec // a fixed path inside the repo, not user input
	if err != nil {
		t.Fatalf("read the contract: %v", err)
	}
	lines := strings.Split(string(raw), "\n")

	start := slices.Index(lines, "    "+name+":")
	if start < 0 {
		t.Fatalf("schema %q not found in %s", name, openAPIPath)
	}
	var s schema
	inProps := false
	for _, line := range lines[start+1:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indent := len(line) - len(strings.TrimLeft(line, " "))
		if indent <= 4 {
			break // the next schema
		}
		text := strings.TrimSpace(line)
		switch {
		case indent == 6:
			inProps = text == "properties:"
			if list, ok := strings.CutPrefix(text, "required: ["); ok {
				for f := range strings.SplitSeq(strings.TrimSuffix(list, "]"), ",") {
					s.Required = append(s.Required, strings.TrimSpace(f))
				}
			}
			if text == "additionalProperties: false" {
				s.NoAdditionalProperty = true
			}
		case indent == 8 && inProps && strings.HasSuffix(text, ":"):
			s.Properties = append(s.Properties, strings.TrimSuffix(text, ":"))
		}
	}
	if len(s.Properties) == 0 {
		t.Fatalf("schema %q: no properties read from %s; has the layout changed?", name, openAPIPath)
	}
	return s
}

// assertMatchesSchema fails unless obj has every required key of s and, when
// s refuses additional properties, no key s does not declare.
func assertMatchesSchema(t *testing.T, obj map[string]json.RawMessage, s schema, what string) {
	t.Helper()
	for _, k := range s.Required {
		if _, ok := obj[k]; !ok {
			t.Errorf("%s: missing required key %q (has %v)", what, k, keys(obj))
		}
	}
	if s.NoAdditionalProperty {
		for k := range obj {
			if !s.allows(k) {
				t.Errorf("%s: key %q is not in the contract (allowed: %v)", what, k, s.Properties)
			}
		}
	}
}

// keys lists the keys of obj, for error messages.
func keys(obj map[string]json.RawMessage) []string {
	out := make([]string, 0, len(obj))
	for k := range obj {
		out = append(out, k)
	}
	return out
}

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
)

// assertJSONContentType fails unless the response is declared as JSON.
func assertJSONContentType(t *testing.T, h map[string][]string, what string) {
	t.Helper()
	ct := ""
	if v := h["Content-Type"]; len(v) > 0 {
		ct = v[0]
	}
	if ct != "application/json" && !strings.HasPrefix(ct, "application/json;") {
		t.Errorf("%s: Content-Type = %q, want application/json", what, ct)
	}
}
