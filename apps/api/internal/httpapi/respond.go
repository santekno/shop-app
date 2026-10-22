package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

// JSON writes v as a JSON response with status. v is encoded into a buffer
// first, so a value that cannot be encoded turns into a clean 500 instead of
// a 200 with half a body. r is used to log that failure with the request's
// logger.
func JSON(w http.ResponseWriter, r *http.Request, status int, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	// Names like "Makanan & Minuman" stay readable; this is an API, not HTML.
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		Error(w, r, fmt.Errorf("encode %T response: %w", v, err))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes()) // the client may be gone; nothing left to do
}
