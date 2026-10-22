package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/validx"
)

// CodeValidationFailed is the 400 code for invalid input; details maps each
// invalid field to what is wrong with it.
const CodeValidationFailed = "VALIDATION_FAILED"

// ValidationError is 400 VALIDATION_FAILED, e.g. message "invalid query
// parameters" and details {"limit": "must be between 1 and 100"}.
func ValidationError(message string, details map[string]any) *errx.AppError {
	return errx.New(CodeValidationFailed, message).
		WithHTTPStatus(http.StatusBadRequest).
		WithDetails(details)
}

// Validator checks request input with validx (go-playground/validator plus
// Indonesian tags such as id_phone) and turns failures into one
// VALIDATION_FAILED error that lists every invalid field by the name the
// client used. It is safe for concurrent use; create one at start.
type Validator struct {
	v *validx.Validator
}

// NewValidator returns a Validator.
func NewValidator() *Validator {
	return &Validator{v: validx.New()}
}

// BindQuery fills dst, a pointer to a struct, from the URL query of r and
// validates it. Only fields with a `query:"name"` tag are read; their types
// may be string, int, int64 or bool. A parameter that is absent leaves its
// field unchanged, so set defaults in dst before calling. A parameter given
// twice is refused, rather than silently using one of the values.
//
// Its first caller is GET /v1/products in Bab 3:
//
//	q := productQuery{Sort: "newest", Limit: 20}
//	if err := h.validator.BindQuery(r, &q); err != nil {
//		httpapi.Error(w, r, err) // 400 VALIDATION_FAILED with details
//		return
//	}
//
// The error is a *errx.AppError (400) for bad input, or a plain error (500)
// when dst itself is not a supported struct, which is a programming mistake.
func (v *Validator) BindQuery(r *http.Request, dst any) error {
	details, err := decodeQuery(r.URL.Query(), dst)
	if err != nil {
		return err
	}
	if len(details) > 0 {
		// Values that did not parse would only produce confusing follow-up
		// messages from the validator, so stop here.
		return ValidationError("invalid query parameters", details)
	}
	return v.check(dst, "query", "invalid query parameters")
}

// Struct validates s (a struct or a pointer to one) by its `validate` tags.
// Fields are named in the error by their `json` tag, as a client sees them;
// an element of a top-level slice checked with dive is named "tags[0]".
//
// Only top-level fields are named that way. A field inside a nested struct,
// including one promoted from an embedded struct, is reported by its Go name
// ("City", not "address.city"), with a message built from the failed rule
// alone, so a min+max pair reads "must be at least 2", not "between": validx
// does not expose go-playground's RegisterTagNameFunc, which is the real fix
// (see docs/sdk-gaps.md). Nested request bodies arrive in a later chapter.
func (v *Validator) Struct(s any) error {
	return v.check(s, "json", "invalid request")
}

// check validates s and names each failed field by its nameTag.
func (v *Validator) check(s any, nameTag, message string) error {
	err := v.v.Struct(s)
	if err == nil {
		return nil
	}
	var fieldErrs validator.ValidationErrors
	if !errors.As(err, &fieldErrs) {
		return fmt.Errorf("validate %T: %w", s, err)
	}

	root := reflect.TypeOf(s)
	for root.Kind() == reflect.Pointer {
		root = root.Elem()
	}
	details := make(map[string]any, len(fieldErrs))
	for _, fe := range fieldErrs {
		// A nested field keeps its Go name, and its message comes from the
		// failed rule alone (fe.Tag, fe.Param).
		name, rules := fe.StructField(), ""
		if field, ok := topLevelField(root, fe); ok {
			name = fieldName(field, nameTag)
			// Rules before "dive" check the slice itself, rules after it
			// each element. An element ("Tags[0]") keeps its index after
			// the client's name: "tags[0]".
			sliceRules, elemRules, _ := strings.Cut(field.Tag.Get("validate"), "dive")
			rules = sliceRules
			if _, index, isElem := strings.Cut(fe.StructField(), "["); isElem {
				name, rules = name+"["+index, elemRules
			}
		}
		details[name] = fieldMessage(fe, rules)
	}
	return ValidationError(message, details)
}

// topLevelField returns the field of root that fe is about, but only when fe
// is about a field of root itself, or an element of one (a slice field with
// a dive rule). A nested field may share a Go name with a top-level one, and
// must not borrow its tags.
//
// The validator's namespace starts with the root type's name only for a
// named type ("order.Name", "order.Address.Name"); an anonymous struct starts
// at the field ("Name"). The name is cut as a whole because a generic type's
// name contains dots of its own.
func topLevelField(root reflect.Type, fe validator.FieldError) (reflect.StructField, bool) {
	path := fe.StructNamespace()
	if typeName := root.Name(); typeName != "" {
		path = strings.TrimPrefix(path, typeName+".")
	}
	if strings.Contains(path, ".") {
		return reflect.StructField{}, false
	}
	goName, _, _ := strings.Cut(fe.StructField(), "[")
	return root.FieldByName(goName)
}

// fieldName is the name a client knows the field by: the part of its tag
// before the first comma, or the Go name when the tag is missing.
func fieldName(field reflect.StructField, tag string) string {
	name, _, _ := strings.Cut(field.Tag.Get(tag), ",")
	if name == "" || name == "-" {
		return field.Name
	}
	return name
}

// decodeQuery copies query parameters into the tagged fields of dst. The map
// holds one message per parameter that could not be parsed.
func decodeQuery(query url.Values, dst any) (map[string]any, error) {
	rv := reflect.ValueOf(dst)
	if rv.Kind() != reflect.Pointer || rv.IsNil() || rv.Elem().Kind() != reflect.Struct {
		return nil, fmt.Errorf("bind query: dst must be a non-nil pointer to a struct, got %T", dst)
	}
	sv := rv.Elem()
	details := map[string]any{}
	for i := range sv.NumField() {
		field := sv.Type().Field(i)
		name := field.Tag.Get("query")
		values, present := query[name]
		if name == "" || name == "-" || !present {
			continue
		}
		if len(values) > 1 {
			details[name] = "must be given only once"
			continue
		}
		msg, err := setField(sv.Field(i), values[0])
		if err != nil {
			return nil, fmt.Errorf("bind query: field %s: %w", field.Name, err)
		}
		if msg != "" {
			details[name] = msg
		}
	}
	return details, nil
}

// setField parses raw into f. It returns a message for the client when raw
// is not a valid value, and an error when f has a type BindQuery does not
// support.
func setField(f reflect.Value, raw string) (string, error) {
	switch f.Kind() {
	case reflect.String:
		f.SetString(raw)
	case reflect.Int, reflect.Int64:
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || f.OverflowInt(n) {
			return "must be an integer", nil
		}
		f.SetInt(n)
	case reflect.Bool:
		b, err := strconv.ParseBool(raw)
		if err != nil {
			return "must be true or false", nil
		}
		f.SetBool(b)
	default:
		return "", fmt.Errorf("unsupported type %s", f.Type())
	}
	return "", nil
}

// fieldMessage turns one validator failure into a short English phrase that
// reads after the field name: "limit must be between 1 and 100".
func fieldMessage(fe validator.FieldError, validateTag string) string {
	unit := ""
	if fe.Kind() == reflect.String {
		unit = " characters"
	}
	switch fe.Tag() {
	case "required":
		return "is required"
	case "min", "gte", "max", "lte":
		if lo, hi, ok := bounds(validateTag); ok {
			return fmt.Sprintf("must be between %s and %s%s", lo, hi, unit)
		}
		if fe.Tag() == "min" || fe.Tag() == "gte" {
			return fmt.Sprintf("must be at least %s%s", fe.Param(), unit)
		}
		return fmt.Sprintf("must be at most %s%s", fe.Param(), unit)
	case "len":
		return fmt.Sprintf("must be exactly %s%s", fe.Param(), unit)
	case "oneof":
		return "must be one of: " + strings.Join(strings.Fields(fe.Param()), ", ")
	default:
		return "is invalid"
	}
}

// bounds finds a lower and an upper limit (min/gte and max/lte) in a validate
// tag such as "omitempty,min=1,max=100".
func bounds(validateTag string) (lo, hi string, ok bool) {
	for rule := range strings.SplitSeq(validateTag, ",") {
		key, value, _ := strings.Cut(rule, "=")
		switch key {
		case "min", "gte":
			lo = value
		case "max", "lte":
			hi = value
		}
	}
	return lo, hi, lo != "" && hi != ""
}
