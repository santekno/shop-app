package httpapi_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// productQuery is the GET /v1/products query of Bab 3.
type productQuery struct {
	Q       string `query:"q"`
	Sort    string `query:"sort" validate:"oneof=newest price_asc price_desc"`
	Limit   int    `query:"limit" validate:"min=1,max=100"`
	InStock bool   `query:"in_stock"`
	Ignored string // no query tag: never read
}

// bind runs BindQuery on GET /v1/products?rawQuery, starting from the
// defaults a handler would set.
func bind(t *testing.T, rawQuery string) (productQuery, error) {
	t.Helper()
	q := productQuery{Sort: "newest", Limit: 20}
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/products?"+rawQuery, nil)
	err := httpapi.NewValidator().BindQuery(r, &q)
	return q, err
}

// details returns the field messages of a VALIDATION_FAILED error.
func details(t *testing.T, err error, wantMessage string) map[string]any {
	t.Helper()
	var appErr *errx.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error = %v (%T), want *errx.AppError", err, err)
	}
	testx.AssertEqual(t, appErr.Code, httpapi.CodeValidationFailed)
	testx.AssertEqual(t, appErr.HTTPStatus, http.StatusBadRequest)
	testx.AssertEqual(t, appErr.Message, wantMessage)
	return appErr.Details
}

func TestBindQuery_Values(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  productQuery
	}{
		{name: "absent parameters keep the defaults", query: "", want: productQuery{Sort: "newest", Limit: 20}},
		{
			name:  "string, int and bool",
			query: "q=kaos&sort=price_asc&limit=100&in_stock=true",
			want:  productQuery{Q: "kaos", Sort: "price_asc", Limit: 100, InStock: true},
		},
		{name: "untagged field is never read", query: "Ignored=x", want: productQuery{Sort: "newest", Limit: 20}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := bind(t, tt.query)
			if err != nil {
				t.Fatalf("BindQuery: %v", err)
			}
			testx.AssertEqual(t, got, tt.want)
		})
	}
}

func TestBindQuery_InvalidInput(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  map[string]any
	}{
		{name: "not an integer", query: "limit=ten", want: map[string]any{"limit": "must be an integer"}},
		{name: "not a bool", query: "in_stock=yes", want: map[string]any{"in_stock": "must be true or false"}},
		{name: "repeated parameter", query: "limit=1&limit=2", want: map[string]any{"limit": "must be given only once"}},
		{name: "below min", query: "limit=0", want: map[string]any{"limit": "must be between 1 and 100"}},
		{name: "above max", query: "limit=101", want: map[string]any{"limit": "must be between 1 and 100"}},
		{name: "not one of", query: "sort=oldest", want: map[string]any{"sort": "must be one of: newest, price_asc, price_desc"}},
		{
			// Values that did not parse stop here; sort is not validated.
			name:  "parse errors stop before validation",
			query: "limit=x&sort=oldest",
			want:  map[string]any{"limit": "must be an integer"},
		},
		{
			name:  "every invalid field is listed",
			query: "limit=0&sort=oldest",
			want:  map[string]any{"limit": "must be between 1 and 100", "sort": "must be one of: newest, price_asc, price_desc"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := bind(t, tt.query)
			got := details(t, err, "invalid query parameters")
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("details = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestBindQuery_Required(t *testing.T) {
	type searchQuery struct {
		Q string `query:"q" validate:"required"`
	}
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/v1/search", nil)
	err := httpapi.NewValidator().BindQuery(r, &searchQuery{})
	testx.AssertEqual(t, details(t, err, "invalid query parameters")["q"], any("is required"))
}

// A dst BindQuery cannot fill is the programmer's mistake: a plain error,
// which httpapi.Error turns into a 500, never a 400 for the client.
func TestBindQuery_ProgrammingMistakes(t *testing.T) {
	type unsupported struct {
		Price float64 `query:"price"`
	}
	tests := []struct {
		name    string
		query   string
		dst     any
		wantErr string
	}{
		{name: "not a pointer", dst: productQuery{}, wantErr: "bind query: dst must be a non-nil pointer to a struct, got httpapi_test.productQuery"},
		{name: "nil pointer", dst: (*productQuery)(nil), wantErr: "got *httpapi_test.productQuery"},
		{name: "pointer to a non-struct", dst: new(int), wantErr: "got *int"},
		{name: "unsupported field type", query: "price=1.5", dst: &unsupported{}, wantErr: "bind query: field Price: unsupported type float64"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/?"+tt.query, nil)
			err := httpapi.NewValidator().BindQuery(r, tt.dst)
			if err == nil {
				t.Fatal("BindQuery: want error, got nil")
			}
			var appErr *errx.AppError
			testx.AssertFalse(t, errors.As(err, &appErr), "want a plain error, got %v", err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

// createProduct is a flat request body: one field per message Struct writes.
type createProduct struct {
	Name  string `json:"name" validate:"required"`
	Slug  string `json:"slug,omitempty" validate:"min=2,max=20"`
	SKU   string `json:"sku" validate:"len=8"`
	Price int    `json:"price" validate:"min=1000"`
	Stock int    `json:"stock" validate:"max=999"`
	Note  string `json:"note" validate:"max=5"`
	Email string `json:"email" validate:"omitempty,email"`
	Sort  string `json:"-" validate:"oneof=newest oldest"`
}

func validProduct() createProduct {
	return createProduct{Name: "Kaos", Slug: "kaos", SKU: "KAOS-001", Price: 50000, Sort: "newest"}
}

func TestValidator_Struct(t *testing.T) {
	tests := []struct {
		name   string
		change func(p *createProduct)
		want   map[string]any // nil: valid
	}{
		{name: "valid", change: func(*createProduct) {}},
		{name: "required", change: func(p *createProduct) { p.Name = "" }, want: map[string]any{"name": "is required"}},
		{name: "min and max on a string", change: func(p *createProduct) { p.Slug = "k" }, want: map[string]any{"slug": "must be between 2 and 20 characters"}},
		{name: "len", change: func(p *createProduct) { p.SKU = "KAOS" }, want: map[string]any{"sku": "must be exactly 8 characters"}},
		{name: "min only", change: func(p *createProduct) { p.Price = 999 }, want: map[string]any{"price": "must be at least 1000"}},
		{name: "max only", change: func(p *createProduct) { p.Stock = 1000 }, want: map[string]any{"stock": "must be at most 999"}},
		{name: "max on a string counts characters", change: func(p *createProduct) { p.Note = "panjang" }, want: map[string]any{"note": "must be at most 5 characters"}},
		{name: "other rules", change: func(p *createProduct) { p.Email = "nope" }, want: map[string]any{"email": "is invalid"}},
		{name: "json:\"-\" uses the Go name", change: func(p *createProduct) { p.Sort = "random" }, want: map[string]any{"Sort": "must be one of: newest, oldest"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := validProduct()
			tt.change(&p)
			err := httpapi.NewValidator().Struct(&p)
			if tt.want == nil {
				testx.AssertNoError(t, err)
				return
			}
			if got := details(t, err, "invalid request"); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("details = %v, want %v", got, tt.want)
			}
		})
	}
}

// A nested field is reported by its Go name, with a message from the failed
// rule alone; only top-level fields use their json tag and full rule set.
// The last two rows pin limitations documented in docs/sdk-gaps.md.
func TestValidator_Struct_NestedFields(t *testing.T) {
	type address struct {
		Name string `json:"name" validate:"required"`
		City string `json:"city" validate:"required"`
		Slug string `json:"slug" validate:"min=2,max=10"`
	}
	type order struct {
		Name    string  `json:"order_name" validate:"min=2,max=10"`
		Address address `json:"address"`
	}
	type twoAddresses struct {
		Billing  address `json:"billing"`
		Shipping address `json:"shipping"`
	}
	type Meta struct {
		Note string `json:"note" validate:"max=3"`
	}
	type withEmbedded struct {
		Meta
	}
	full := address{Name: "Rumah", City: "Bandung", Slug: "rumah"}

	tests := []struct {
		name string
		in   any
		want map[string]any
	}{
		{
			name: "nested field keeps its Go name",
			in:   order{Name: "ok", Address: address{Name: "Rumah", Slug: "rumah"}},
			want: map[string]any{"City": "is required"},
		},
		{
			name: "nested Name does not borrow the top-level Name's tags",
			in:   order{Name: "ok", Address: address{City: "Bandung", Slug: "rumah"}},
			want: map[string]any{"Name": "is required"},
		},
		{
			name: "both fail: each is named and described on its own",
			in:   order{Name: "x", Address: address{City: "Bandung", Slug: "rumah"}},
			want: map[string]any{"order_name": "must be between 2 and 10 characters", "Name": "is required"},
		},
		{
			name: "nested min message comes from the rule's parameter only",
			in:   order{Name: "ok", Address: address{Name: "Rumah", City: "Bandung", Slug: "r"}},
			want: map[string]any{"Slug": "must be at least 2 characters"},
		},
		{
			name: "anonymous root: top-level uses the json tag, nested Name does not borrow it",
			in: struct {
				Name    string  `json:"order_name" validate:"min=2,max=10"`
				Address address `json:"address"`
			}{Name: "x", Address: address{City: "Bandung", Slug: "rumah"}},
			want: map[string]any{"order_name": "must be between 2 and 10 characters", "Name": "is required"},
		},
		{
			name: "limitation: a field promoted from an embedded struct counts as nested",
			in:   withEmbedded{Meta{Note: "panjang"}},
			want: map[string]any{"Note": "must be at most 3 characters"},
		},
		{
			name: "limitation: two nested fields with the same Go name share one key",
			in:   twoAddresses{Billing: address{Name: "Rumah", Slug: "rumah"}, Shipping: full},
			want: map[string]any{"City": "is required"},
		},
		{
			name: "limitation: ... even when both fail",
			in:   twoAddresses{Billing: address{Name: "Rumah", Slug: "rumah"}, Shipping: address{Name: "Kantor", Slug: "kantor"}},
			want: map[string]any{"City": "is required"},
		},
	}
	v := httpapi.NewValidator()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := details(t, v.Struct(tt.in), "invalid request")
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("details = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestValidator_Struct_NotAStruct(t *testing.T) {
	err := httpapi.NewValidator().Struct(42)
	if err == nil {
		t.Fatal("Struct(42): want error, got nil")
	}
	var appErr *errx.AppError
	testx.AssertFalse(t, errors.As(err, &appErr), "want a plain error, got %v", err)
	testx.AssertContains(t, err.Error(), "validate int: ")
}
