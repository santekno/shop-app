package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

// InvalidTextMessage is the message for a string ValidText refuses.
const InvalidTextMessage = "must be valid UTF-8 text without NUL characters"

// ValidText reports whether s can be stored in a PostgreSQL text column:
// valid UTF-8 with no NUL character. Postgres refuses anything else (SQLSTATE
// 22021), so input is checked at the boundary and answered with 400 instead
// of failing with 500 in the database.
func ValidText(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsRune(s, 0)
}

// MaxBodyBytes is the largest JSON body DecodeJSON accepts.
const MaxBodyBytes = 1 << 20 // 1 MiB

// DecodeJSON reads r's body, which must be one JSON object, into dst. Unknown
// fields are refused, so a typo in a field name is an error instead of a
// silently ignored value. Every problem with the body is a 400
// VALIDATION_FAILED with details {"body": "<what is wrong>"}; validate the
// decoded value afterwards with Validator.Struct.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return ValidationError("invalid request body", map[string]any{"body": bodyMessage(err)})
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return ValidationError("invalid request body", map[string]any{"body": "must contain a single JSON object"})
	}
	return nil
}

// bodyMessage describes a decoding error without echoing the body back.
func bodyMessage(err error) string {
	var typeErr *json.UnmarshalTypeError
	var maxErr *http.MaxBytesError
	switch {
	case errors.As(err, &typeErr) && typeErr.Field == "":
		// The body itself has the wrong type, such as an array or a string.
		return "must be a JSON object"
	case errors.As(err, &typeErr):
		// Field is the dotted path, e.g. "variants.price": encoding/json
		// does not say which element of a list it was.
		return fmt.Sprintf("field %s has the wrong JSON type", typeErr.Field)
	case errors.As(err, &maxErr):
		return fmt.Sprintf("must be at most %d bytes", MaxBodyBytes)
	case errors.Is(err, io.EOF):
		return "is empty"
	default:
		// Covers syntax errors and unknown fields; json's own message names
		// the offending field and never contains the body.
		return "must be valid JSON matching the schema: " + err.Error()
	}
}
