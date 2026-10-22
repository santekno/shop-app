package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
)

// errorBody is the API's error shape, decoded strictly enough to notice a
// renamed or missing field.
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
	dec := json.NewDecoder(bytes.NewReader(rec.Body.Bytes()))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
	}
	return body
}

// requestWithLogger returns a request whose context carries a JSON logger
// writing to the returned buffer, as logging.Middleware sets it up.
func requestWithLogger(method, target string) (*http.Request, *bytes.Buffer) {
	var buf bytes.Buffer
	logger := logx.New(logx.WithOutput(&buf), logx.WithFormat("json"), logx.WithLevel("debug"))
	r := httptest.NewRequestWithContext(context.Background(), method, target, nil)
	return r.WithContext(logx.WithContextLogger(r.Context(), logger)), &buf
}

// logLines decodes each JSON log line in buf.
func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		lines = append(lines, m)
	}
	return lines
}
