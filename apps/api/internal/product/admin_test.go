package product_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

func adminProduct() product.AdminProduct {
	price := int64(89000)
	return product.AdminProduct{
		ID: productID, CategoryID: catID, Slug: "kaos-polos-hitam", Name: "Kaos Polos Hitam",
		Description: "Katun", Status: product.StatusActive, PriceFrom: &price, Version: 9,
		Variants: []product.AdminVariant{
			{ID: variantID, SKU: "KPH-S", Name: "S", Price: 89000, Stock: 3, WeightGrams: 180, Version: 4},
		},
		CreatedAt: time.Date(2026, 10, 1, 19, 0, 0, 0, time.FixedZone("WIB", 7*3600)),
		UpdatedAt: time.Date(2026, 10, 2, 19, 0, 0, 0, time.FixedZone("WIB", 7*3600)),
	}
}

// body returns a valid product request body with change applied to its
// decoded form.
func body(t *testing.T, change func(m map[string]any)) string {
	t.Helper()
	m := map[string]any{
		"category_id": catID,
		"slug":        "kaos-polos-hitam",
		"name":        "Kaos Polos Hitam",
		"description": "Katun",
		"status":      "active",
		"variants": []any{
			map[string]any{"sku": "kph-s", "name": "S", "price": 89000, "stock": 3, "weight_grams": 180},
		},
	}
	if change != nil {
		change(m)
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// putBody is body with the product's version a PUT must send back.
func putBody(t *testing.T, version any, change func(m map[string]any)) string {
	t.Helper()
	return body(t, func(m map[string]any) {
		m["version"] = version
		if change != nil {
			change(m)
		}
	})
}

func variants(vs ...map[string]any) []any {
	out := make([]any, len(vs))
	for i, v := range vs {
		out[i] = v
	}
	return out
}

func variant(sku string) map[string]any {
	return map[string]any{"sku": sku, "name": "V", "price": 1000, "stock": 0, "weight_grams": 100}
}

func TestAdmin_GetProduct(t *testing.T) {
	svc := &fakeService{admin: adminProduct()}

	rec := serve(svc, http.MethodGet, "/v1/admin/products/"+productID, "")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, strings.Join(svc.adminCalls, ","), productID)
	data := decodeJSON(t, rec)["data"].(map[string]any)
	testx.AssertEqual(t, data["status"], any("active"))
	testx.AssertEqual(t, data["category_id"], any(catID))
	testx.AssertEqual(t, data["created_at"], any("2026-10-01T12:00:00Z"))
	testx.AssertEqual(t, data["updated_at"], any("2026-10-02T12:00:00Z"))
	price := data["price_from"].(map[string]any)
	testx.AssertEqual(t, price["amount"], any(json.Number("89000")))
	v := data["variants"].([]any)[0].(map[string]any)
	testx.AssertEqual(t, v["weight_grams"], any(json.Number("180")))
	testx.AssertEqual(t, v["sku"], any("KPH-S"))
	testx.AssertEqual(t, v["version"], any(json.Number("4")), "the form sends it back with the save")
	testx.AssertEqual(t, data["version"], any(json.Number("9")), "the product's own version, for the save too")
}

func TestAdmin_GetProduct_NoSellableVariant(t *testing.T) {
	p := adminProduct()
	p.PriceFrom, p.Variants = nil, nil
	svc := &fakeService{admin: p}

	rec := serve(svc, http.MethodGet, "/v1/admin/products/"+productID, "")

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertContains(t, rec.Body.String(), `"price_from":null`)
	testx.AssertContains(t, rec.Body.String(), `"variants":[]`)
}

// A path id that is not a UUID is a 404 on every admin route, and the
// service is never asked.
func TestAdmin_NonUUIDIsNotFound(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		for _, id := range []string{"123", "kaos-polos-hitam", productID + "0"} {
			t.Run(method+" "+id, func(t *testing.T) {
				svc := &fakeService{admin: adminProduct()}
				rec := serve(svc, method, "/v1/admin/products/"+id, body(t, nil))

				testx.AssertEqual(t, rec.Code, http.StatusNotFound)
				testx.AssertEqual(t, decodeError(t, rec).Error.Code, httpapi.CodeNotFound)
				testx.AssertEqual(t, len(svc.adminCalls)+len(svc.updatedIDs)+len(svc.archived), 0, "the service was asked")
			})
		}
	}
}

func TestAdmin_GetProduct_Errors(t *testing.T) {
	tests := []struct {
		err        error
		wantStatus int
		wantCode   string
	}{
		{err: product.ErrNotFound, wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{err: errors.New("connection refused"), wantStatus: 500, wantCode: httpapi.CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.err.Error(), func(t *testing.T) {
			svc := &fakeService{adminErr: tt.err}
			rec := serve(svc, http.MethodGet, "/v1/admin/products/"+productID, "")
			testx.AssertEqual(t, rec.Code, tt.wantStatus)
			testx.AssertEqual(t, decodeError(t, rec).Error.Code, tt.wantCode)
		})
	}
}

func TestAdmin_CreateProduct(t *testing.T) {
	svc := &fakeService{admin: adminProduct()}

	rec := serve(svc, http.MethodPost, "/v1/admin/products", body(t, func(m map[string]any) {
		m["variants"] = variants(
			map[string]any{"sku": "  kph-s ", "name": "S", "price": 89000, "stock": 0, "weight_grams": 180},
			variant("KPH-M"),
		)
	}))

	testx.AssertEqual(t, rec.Code, http.StatusCreated)
	testx.AssertEqual(t, rec.Header().Get("Location"), "/v1/admin/products/"+productID)
	data := decodeJSON(t, rec)["data"].(map[string]any)
	testx.AssertEqual(t, data["id"], any(productID))
	if len(svc.created) != 1 {
		t.Fatalf("Create called %d times, want 1", len(svc.created))
	}
	in := svc.created[0]
	testx.AssertEqual(t, in.CategoryID, catID)
	testx.AssertEqual(t, in.Slug, "kaos-polos-hitam")
	testx.AssertEqual(t, in.Name, "Kaos Polos Hitam")
	testx.AssertEqual(t, in.Description, "Katun")
	testx.AssertEqual(t, in.Status, "active")
	testx.AssertEqual(t, len(in.Variants), 2)
	testx.AssertEqual(t, in.Variants[0], product.VariantInput{SKU: "KPH-S", Name: "S", Price: 89000, Stock: 0, WeightGrams: 180},
		"SKU trimmed and upper-cased")
	// The request's order is the variants' position.
	testx.AssertEqual(t, in.Variants[1].SKU, "KPH-M")
}

func TestAdmin_UpdateProduct(t *testing.T) {
	svc := &fakeService{admin: adminProduct()}

	rec := serve(svc, http.MethodPut, "/v1/admin/products/"+productID, putBody(t, 9, func(m map[string]any) {
		v := variant("kph-s")
		v["id"] = variantID
		v["version"] = 3 // the version the form loaded
		m["variants"] = variants(v, variant("kph-xl"))
	}))

	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, rec.Header().Get("Location"), "", "no Location on an update")
	testx.AssertEqual(t, strings.Join(svc.updatedIDs, ","), productID)
	in := svc.updated[0]
	testx.AssertEqual(t, in.Version, int32(9), "the product's loaded version goes to the repository's check")
	testx.AssertEqual(t, in.Variants[0].ID, variantID, "an existing variant keeps its id")
	testx.AssertEqual(t, in.Variants[0].SKU, "KPH-S")
	testx.AssertEqual(t, in.Variants[0].Version, int32(3), "the loaded version goes to the repository's check")
	testx.AssertEqual(t, in.Variants[1].ID, "", "a new variant has none")
	testx.AssertEqual(t, in.Variants[1].Version, int32(0), "nor a version")
	testx.AssertEqual(t, in.Variants[1].SKU, "KPH-XL")
}

func TestAdmin_Validation(t *testing.T) {
	long := func(n int) string { return strings.Repeat("a", n) }
	tests := []struct {
		name   string
		body   string
		want   map[string]any // the exact details
		prefix map[string]string
	}{
		{
			name: "empty body",
			body: "",
			want: map[string]any{"body": "is empty"},
		},
		{
			name:   "unknown field",
			body:   body(t, func(m map[string]any) { m["price"] = 1 }),
			prefix: map[string]string{"body": `must be valid JSON matching the schema: json: unknown field "price"`},
		},
		{
			name: "wrong type names the json field",
			body: body(t, func(m map[string]any) { m["name"] = 12 }),
			want: map[string]any{"body": "field name has the wrong JSON type"},
		},
		{
			// encoding/json gives the dotted path, without the index.
			name: "wrong type in a variant names the dotted path",
			body: body(t, func(m map[string]any) { m["variants"] = variants(map[string]any{"sku": "A", "price": "89000"}) }),
			want: map[string]any{"body": "field variants.price has the wrong JSON type"},
		},
		{
			name: "an array is not a product",
			body: `[` + body(t, nil) + `]`,
			want: map[string]any{"body": "must be a JSON object"},
		},
		{
			// JSON can carry a NUL (\u0000), which PostgreSQL text refuses.
			name: "NUL in the product's text fields",
			body: `{"category_id":"` + catID + `","slug":"kaos\u0000","name":"Kaos\u0000","description":"\u0000",` +
				`"status":"active","variants":[{"sku":"KPH-S","name":"S","price":1,"stock":0,"weight_grams":1}]}`,
			want: map[string]any{
				"slug":        "must be valid UTF-8 text without NUL characters",
				"name":        "must be valid UTF-8 text without NUL characters",
				"description": "must be valid UTF-8 text without NUL characters",
			},
		},
		{
			name: "NUL in a variant's sku and name",
			body: `{"category_id":"` + catID + `","slug":"kaos","name":"Kaos","status":"active","variants":[` +
				`{"sku":"OK","name":"S","price":1,"stock":0,"weight_grams":1},` +
				`{"sku":"KPH\u0000","name":"M\u0000","price":1,"stock":0,"weight_grams":1}]}`,
			want: map[string]any{
				"variants[1].sku":  "must be valid UTF-8 text without NUL characters",
				"variants[1].name": "must be valid UTF-8 text without NUL characters",
			},
		},
		{
			name: "missing fields",
			body: `{}`,
			want: map[string]any{
				"category_id": "is required", "slug": "is required", "name": "is required",
				"status": "is required", "variants": "is required",
			},
		},
		{
			name: "bad product fields",
			body: body(t, func(m map[string]any) {
				m["category_id"] = "kaos"
				m["name"] = long(201)
				m["description"] = long(5001)
				m["status"] = "deleted"
			}),
			want: map[string]any{
				"category_id": "is invalid",
				"name":        "must be at most 200 characters",
				"description": "must be at most 5000 characters",
				"status":      "must be one of: draft, active, archived",
			},
		},
		{
			name: "empty variant list",
			body: body(t, func(m map[string]any) { m["variants"] = []any{} }),
			want: map[string]any{"variants": "must be between 1 and 50"},
		},
		{
			name: "too many variants",
			body: body(t, func(m map[string]any) {
				var vs []map[string]any
				for i := range 51 {
					vs = append(vs, variant(fmt.Sprintf("SKU-%02d", i)))
				}
				m["variants"] = variants(vs...)
			}),
			want: map[string]any{"variants": "must be between 1 and 50"},
		},
		{
			name: "each variant is reported by its index",
			body: body(t, func(m map[string]any) {
				m["variants"] = variants(
					variant("OK-1"),
					map[string]any{"id": "nope", "sku": " ", "name": "", "price": 0, "stock": -1, "weight_grams": 0},
					map[string]any{"sku": long(65), "name": long(101), "price": 1000000001, "stock": 1000001, "weight_grams": 100001},
				)
			}),
			want: map[string]any{
				"variants[1].id":           "is invalid",
				"variants[1].version":      "is required with id: send the version the variant was loaded with",
				"variants[1].sku":          "is required",
				"variants[1].name":         "is required",
				"variants[1].price":        "must be between 1 and 1000000000",
				"variants[1].stock":        "must be between 0 and 1000000",
				"variants[1].weight_grams": "must be between 1 and 100000",
				"variants[2].sku":          "must be at most 64 characters",
				"variants[2].name":         "must be at most 100 characters",
				"variants[2].price":        "must be between 1 and 1000000000",
				"variants[2].stock":        "must be between 0 and 1000000",
				"variants[2].weight_grams": "must be between 1 and 100000",
			},
		},
		{
			name: "duplicate SKU after trimming and upper-casing",
			body: body(t, func(m map[string]any) { m["variants"] = variants(variant("KPH-S"), variant(" kph-s")) }),
			want: map[string]any{"variants[1].sku": "is used by another variant in this request"},
		},
		{
			name: "duplicate variant id",
			body: body(t, func(m map[string]any) {
				a, b := variant("A"), variant("B")
				a["id"], b["id"] = variantID, variantID
				a["version"], b["version"] = 1, 1
				m["variants"] = variants(a, b)
			}),
			want: map[string]any{"variants[1].id": "is listed twice in this request"},
		},
		{
			// ADR 0006: an existing variant is saved only at the version
			// the form loaded, so the version cannot be left out.
			name: "an existing variant without its version",
			body: body(t, func(m map[string]any) {
				v := variant("KPH-S")
				v["id"] = variantID
				m["variants"] = variants(v, variant("KPH-M"))
			}),
			want: map[string]any{"variants[0].version": "is required with id: send the version the variant was loaded with"},
		},
		{
			name: "a negative version",
			body: body(t, func(m map[string]any) {
				v := variant("KPH-S")
				v["id"], v["version"] = variantID, -1
				m["variants"] = variants(v)
			}),
			want: map[string]any{"variants[0].version": "must be at least 0"},
		},
		{
			name: "blank SKUs are reported as required, not as duplicates",
			body: body(t, func(m map[string]any) { m["variants"] = variants(variant(""), variant("")) }),
			want: map[string]any{"variants[0].sku": "is required", "variants[1].sku": "is required"},
		},
	}
	for _, slug := range []string{"Kaos", "kaos_polos", "-kaos", "kaos-", "kaos--polos", "kaos polos"} {
		tests = append(tests, struct {
			name   string
			body   string
			want   map[string]any
			prefix map[string]string
		}{
			name: "bad slug " + slug,
			body: body(t, func(m map[string]any) { m["slug"] = slug }),
			want: map[string]any{"slug": "must be lower-case letters and digits in words joined by single hyphens"},
		})
	}
	tests = append(tests, struct {
		name   string
		body   string
		want   map[string]any
		prefix map[string]string
	}{
		name: "slug too long",
		body: body(t, func(m map[string]any) { m["slug"] = long(201) }),
		want: map[string]any{"slug": "must be at most 200 characters"},
	})

	for _, tt := range tests {
		for _, method := range []string{http.MethodPost, http.MethodPut} {
			t.Run(method+" "+tt.name, func(t *testing.T) {
				svc := &fakeService{admin: adminProduct()}
				target := "/v1/admin/products"
				if method == http.MethodPut {
					target += "/" + productID
				}

				rec := serve(svc, method, target, tt.body)

				testx.AssertEqual(t, rec.Code, http.StatusBadRequest, "body %s", rec.Body.String())
				got := decodeError(t, rec).Error
				testx.AssertEqual(t, got.Code, httpapi.CodeValidationFailed)
				if tt.want != nil {
					testx.AssertEqual(t, len(got.Details), len(tt.want), "details %v", got.Details)
					for k, v := range tt.want {
						testx.AssertEqual(t, got.Details[k], v, "details[%q]", k)
					}
				}
				for k, p := range tt.prefix {
					msg, _ := got.Details[k].(string)
					testx.AssertTrue(t, strings.HasPrefix(msg, p), "details[%q] = %q, want prefix %q", k, msg, p)
				}
				testx.AssertEqual(t, len(svc.created)+len(svc.updated), 0, "the service was asked")
			})
		}
	}
}

func TestAdmin_ServiceErrors(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		wantStatus  int
		wantCode    string
		wantDetails map[string]any
	}{
		{
			name: "slug taken", err: product.ErrSlugTaken, wantStatus: 409, wantCode: product.CodeSlugTaken,
			wantDetails: map[string]any{"slug": "another product already uses this slug"},
		},
		{
			name: "sku taken", err: product.ErrSKUTaken, wantStatus: 409, wantCode: product.CodeSKUTaken,
			wantDetails: map[string]any{"variants": "a variant with one of these SKUs already exists"},
		},
		{
			name: "unknown category", err: product.ErrUnknownCategory, wantStatus: 400, wantCode: product.CodeUnknownCategory,
			wantDetails: map[string]any{"category_id": "names no category"},
		},
		{
			name: "unknown variant", err: product.ErrUnknownVariant, wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"variants": "an id must name a sellable variant of this product; leave it out for a new variant"},
		},
		{
			name: "text the database refused", err: product.ErrInvalidText, wantStatus: 400, wantCode: httpapi.CodeValidationFailed,
			wantDetails: map[string]any{"body": "must be valid UTF-8 text without NUL characters"},
		},
		{
			// A sale (or another admin) changed the variant since the form
			// loaded it: reload and save again (ADR 0006).
			name: "version conflict", err: &product.VersionConflictError{VariantID: variantID}, wantStatus: 409, wantCode: product.CodeVersionConflict,
			wantDetails: map[string]any{"variant_id": variantID},
		},
		{
			// Another save or an archive changed the product itself: the
			// details name the product, not a variant (Bab 12).
			name: "stale product", err: &product.StaleProductError{ProductID: productID}, wantStatus: 409, wantCode: product.CodeVersionConflict,
			wantDetails: map[string]any{"product_id": productID},
		},
		{
			// A variant the form still shows was archived by another save.
			name: "variant archived", err: &product.VariantArchivedError{VariantID: variantID}, wantStatus: 409, wantCode: product.CodeVariantArchived,
			wantDetails: map[string]any{"variant_id": variantID},
		},
		{name: "not found", err: product.ErrNotFound, wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "variant not found", err: product.ErrVariantNotFound, wantStatus: 404, wantCode: httpapi.CodeNotFound},
		{name: "failure", err: errors.New("connection refused"), wantStatus: 500, wantCode: httpapi.CodeInternal},
	}
	for _, tt := range tests {
		for _, method := range []string{http.MethodPost, http.MethodPut} {
			t.Run(method+" "+tt.name, func(t *testing.T) {
				// Wrapped, as the service returns them.
				wrapped := errors.Join(errors.New("save product"), tt.err)
				svc := &fakeService{createErr: wrapped, updateErr: wrapped}
				target := "/v1/admin/products"
				if method == http.MethodPut {
					target += "/" + productID
				}

				rec := serve(svc, method, target, putBody(t, 3, nil))

				testx.AssertEqual(t, rec.Code, tt.wantStatus)
				got := decodeError(t, rec).Error
				testx.AssertEqual(t, got.Code, tt.wantCode)
				testx.AssertEqual(t, len(got.Details), len(tt.wantDetails), "details %v", got.Details)
				for k, v := range tt.wantDetails {
					testx.AssertEqual(t, got.Details[k], v, "details[%q]", k)
				}
				testx.AssertEqual(t, rec.Header().Get("Location"), "", "no Location on an error")
			})
		}
	}
}

// PUT must send the product's version back (Bab 12); POST does not need
// one and ignores it.
func TestAdmin_UpdateProductVersion(t *testing.T) {
	t.Run("PUT without a version", func(t *testing.T) {
		svc := &fakeService{admin: adminProduct()}
		rec := serve(svc, http.MethodPut, "/v1/admin/products/"+productID, body(t, nil))
		testx.AssertEqual(t, rec.Code, http.StatusBadRequest, "body %s", rec.Body.String())
		got := decodeError(t, rec).Error
		testx.AssertEqual(t, got.Code, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, len(got.Details), 1, "details %v", got.Details)
		testx.AssertEqual(t, got.Details["version"], any("is required: send the product's version you loaded it with"))
		testx.AssertEqual(t, len(svc.updated), 0, "the service was asked")
	})
	t.Run("PUT with version null", func(t *testing.T) {
		svc := &fakeService{admin: adminProduct()}
		rec := serve(svc, http.MethodPut, "/v1/admin/products/"+productID, putBody(t, nil, nil))
		testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
		testx.AssertEqual(t, decodeError(t, rec).Error.Details["version"], any("is required: send the product's version you loaded it with"))
		testx.AssertEqual(t, len(svc.updated), 0)
	})
	t.Run("PUT with a negative version", func(t *testing.T) {
		svc := &fakeService{admin: adminProduct()}
		rec := serve(svc, http.MethodPut, "/v1/admin/products/"+productID, putBody(t, -1, nil))
		testx.AssertEqual(t, rec.Code, http.StatusBadRequest)
		testx.AssertEqual(t, decodeError(t, rec).Error.Details["version"], any("must be at least 0"))
		testx.AssertEqual(t, len(svc.updated), 0)
	})
	t.Run("PUT with version 0", func(t *testing.T) {
		svc := &fakeService{admin: adminProduct()}
		rec := serve(svc, http.MethodPut, "/v1/admin/products/"+productID, putBody(t, 0, nil))
		testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
		testx.AssertEqual(t, svc.updated[0].Version, int32(0), "0 is a version, not a missing one")
	})
	t.Run("POST without a version", func(t *testing.T) {
		svc := &fakeService{admin: adminProduct()}
		rec := serve(svc, http.MethodPost, "/v1/admin/products", body(t, nil))
		testx.AssertEqual(t, rec.Code, http.StatusCreated, "body %s", rec.Body.String())
		testx.AssertEqual(t, len(svc.created), 1)
	})
	t.Run("POST with a version", func(t *testing.T) {
		svc := &fakeService{admin: adminProduct()}
		rec := serve(svc, http.MethodPost, "/v1/admin/products", putBody(t, 7, nil))
		testx.AssertEqual(t, rec.Code, http.StatusCreated, "body %s", rec.Body.String())
		testx.AssertEqual(t, len(svc.created), 1)
	})
}
