//go:build integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// send makes a request with a JSON body and returns the whole response.
func (s *server) send(t *testing.T, method, path, body string) response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, s.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: read body: %v", method, path, err)
	}
	return response{Status: resp.StatusCode, Header: resp.Header, Body: b}
}

// asJSON encodes v, to compare decoded values that hold pointers.
func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// productJSON builds a ProductWrite body.
func productJSON(t *testing.T, categoryID, slug, status string, variants ...map[string]any) string {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		"category_id": categoryID, "slug": slug, "name": "Produk " + slug,
		"description": "Deskripsi " + slug, "status": status, "variants": variants,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

// variantJSON builds a VariantWrite; id is left out when empty.
func variantJSON(id, sku, name string, price, stock int) map[string]any {
	v := map[string]any{"sku": sku, "name": name, "price": price, "stock": stock, "weight_grams": 250}
	if id != "" {
		v["id"] = id
	}
	return v
}

// catalogServer is a development server with the example categories and
// the listing fixture in its own database.
func catalogServer(t *testing.T, env map[string]string) (*server, *catalog) {
	t.Helper()
	s := startServer(t, env)
	c := newCatalog(t, s.db)
	c.addListingProducts(t)
	return s, c
}

// TestProductsHTTP_List checks GET /v1/products against the contract with
// the defaults: newest first, 20 per page, only active products with a
// sellable variant.
func TestProductsHTTP_List(t *testing.T) {
	s, c := catalogServer(t, nil)

	products, cursor := assertProductList(t, s.get(t, "/v1/products"))
	if want := expectedOrder(c.activeProducts(t), product.SortNewest, nil); !slices.Equal(productSlugs(products), want) {
		t.Errorf("GET /v1/products:\n got %v\nwant %v (newest first)", productSlugs(products), want)
	}
	if cursor != "" {
		t.Errorf("next_cursor = %q with %d products and the default limit 20, want null", cursor, len(products))
	}

	byslug := map[string]productOut{}
	for _, p := range products {
		byslug[p.Slug] = p
	}
	hitam := byslug["kaos-polos-hitam"]
	if hitam.Category.Slug != "kaos" || hitam.Category.ParentID == nil || *hitam.Category.ParentID != c.cats["pakaian"] {
		t.Errorf("category of kaos-polos-hitam = %+v, want kaos under pakaian", hitam.Category)
	}
	if hitam.PriceFrom.Amount != 89000 || !hitam.InStock || len(hitam.Variants) != 2 || hitam.Variants[0].SKU != "KPH-M" {
		t.Errorf("kaos-polos-hitam = %+v", hitam)
	}
	if putih := byslug["kaos-polos-putih"]; putih.InStock {
		t.Error("kaos-polos-putih has no stock but in_stock is true")
	}
	for _, slug := range []string{"kaos-draft", "kaos-arsip"} {
		if _, ok := byslug[slug]; ok {
			t.Errorf("%s is listed; drafts and archived products never are", slug)
		}
	}
}

// TestProductsHTTP_Detail checks GET /v1/products/{slug}: the product as in
// the list, and one 404 for every slug that does not show a product.
func TestProductsHTTP_Detail(t *testing.T) {
	s, _ := catalogServer(t, nil)

	p := assertProductDetail(t, s.get(t, "/v1/products/kaos-polos-hitam"))
	list, _ := assertProductList(t, s.get(t, "/v1/products?category=kaos"))
	idx := slices.IndexFunc(list, func(l productOut) bool { return l.Slug == "kaos-polos-hitam" })
	if idx < 0 {
		t.Fatal("kaos-polos-hitam is not in the kaos list")
	}
	if a, b := asJSON(t, p), asJSON(t, list[idx]); a != b {
		t.Errorf("detail and list disagree:\ndetail %s\nlist   %s", a, b)
	}

	notFound := []string{
		"tidak-ada",        // no such product
		"kaos-draft",       // a draft
		"kaos-arsip",       // archived
		"Kaos-Polos-Hitam", // malformed: upper case
		"kaos--polos",      // malformed: double hyphen
		"-kaos",            // malformed: leading hyphen
		"kaos_polos",       // malformed: underscore
		"kaos%20polos",     // malformed: a space
		strings.Repeat("a", 201),
	}
	for _, slug := range notFound {
		name := slug
		if len(name) > 30 {
			name = "201 characters"
		}
		t.Run(name, func(t *testing.T) {
			resp := s.get(t, "/v1/products/"+slug)
			if resp.Status != http.StatusNotFound {
				t.Fatalf("status = %d, want 404: %s", resp.Status, resp.Body)
			}
			assertErrorBody(t, resp.Body, "NOT_FOUND")
			if !strings.Contains(string(resp.Body), `"product not found"`) {
				t.Errorf("body = %s, want the product's 404, not the router's", resp.Body)
			}
		})
	}
}

// TestAdminHTTP_CreateGetUpdate walks a product through the admin API and
// checks each step on the storefront too.
func TestAdminHTTP_CreateGetUpdate(t *testing.T) {
	s := startServer(t, nil)
	c := newCatalog(t, s.db)

	// Create: SKUs are trimmed and upper-cased; 201 with Location.
	resp := s.send(t, http.MethodPost, "/v1/admin/products", productJSON(t, c.cats["kaos"], "kaos-admin", "active",
		variantJSON("", " ka-l ", "L", 99000, 0), variantJSON("", "ka-m", "M", 89000, 5)))
	if resp.Status != http.StatusCreated {
		t.Fatalf("POST = %d, want 201: %s", resp.Status, resp.Body)
	}
	created := assertAdminProduct(t, resp.Body)
	if loc := resp.Header.Get("Location"); loc != "/v1/admin/products/"+created.ID {
		t.Errorf("Location = %q, want /v1/admin/products/%s", loc, created.ID)
	}
	if created.Status != "active" || created.PriceFrom == nil || created.PriceFrom.Amount != 89000 ||
		len(created.Variants) != 2 || created.Variants[0].SKU != "KA-M" || created.Variants[1].SKU != "KA-L" ||
		created.Variants[0].WeightGrams != 250 {
		t.Errorf("created = %+v", created)
	}

	got := s.get(t, resp.Header.Get("Location"))
	if got.Status != http.StatusOK {
		t.Fatalf("GET Location = %d: %s", got.Status, got.Body)
	}
	if a, b := asJSON(t, assertAdminProduct(t, got.Body)), asJSON(t, created); a != b {
		t.Errorf("GET differs from the POST response:\nGET  %s\nPOST %s", a, b)
	}
	if sp := assertProductDetail(t, s.get(t, "/v1/products/kaos-admin")); sp.ID != created.ID || !sp.InStock {
		t.Errorf("storefront = %+v", sp)
	}

	// Update: keep M (by id), leave L out (archived), add S; the order in
	// the body is the position.
	m := created.Variants[0]
	resp = s.send(t, http.MethodPut, "/v1/admin/products/"+created.ID, productJSON(t, c.cats["kaos"], "kaos-admin", "active",
		variantJSON("", "KA-S", "S", 89000, 2), variantJSON(m.ID, "KA-M", "M", 89000, 4)))
	if resp.Status != http.StatusOK {
		t.Fatalf("PUT = %d, want 200: %s", resp.Status, resp.Body)
	}
	updated := assertAdminProduct(t, resp.Body)
	if gotSKUs := []string{updated.Variants[0].SKU, updated.Variants[1].SKU}; len(updated.Variants) != 2 ||
		!slices.Equal(gotSKUs, []string{"KA-S", "KA-M"}) {
		t.Errorf("variants after PUT = %+v, want KA-S then KA-M (same price, body order)", updated.Variants)
	}
	if updated.Variants[1].ID != m.ID || updated.Variants[1].Stock != 4 {
		t.Errorf("KA-M was not updated in place: %+v", updated.Variants[1])
	}
	if !updated.UpdatedAt.After(created.UpdatedAt) || !updated.CreatedAt.Equal(created.CreatedAt) {
		t.Errorf("updated_at %v → %v, created_at %v → %v", created.UpdatedAt, updated.UpdatedAt, created.CreatedAt, updated.CreatedAt)
	}
	if n := queryInt(t, s.db, `SELECT count(*) FROM product_variants WHERE sku = 'KA-L' AND archived_at IS NOT NULL`); n != 1 {
		t.Error("KA-L, left out of the PUT, was not archived")
	}

	// Last save wins: two saves in a row, the second one is what stays.
	for _, name := range []string{"first", "second"} {
		body := strings.Replace(productJSON(t, c.cats["kemeja"], "kaos-admin", "draft",
			variantJSON(updated.Variants[0].ID, "KA-S", "S", 79000, 1)), `"Produk kaos-admin"`, `"`+name+`"`, 1)
		if r := s.send(t, http.MethodPut, "/v1/admin/products/"+created.ID, body); r.Status != http.StatusOK {
			t.Fatalf("PUT %s = %d: %s", name, r.Status, r.Body)
		}
	}
	final := assertAdminProduct(t, s.get(t, "/v1/admin/products/"+created.ID).Body)
	if final.Name != "second" || final.CategoryID != c.cats["kemeja"] || final.Status != "draft" ||
		final.PriceFrom == nil || final.PriceFrom.Amount != 79000 || len(final.Variants) != 1 {
		t.Errorf("after two saves = %+v, want the second save whole", final)
	}
	// A draft is not on the storefront.
	if r := s.get(t, "/v1/products/kaos-admin"); r.Status != http.StatusNotFound {
		t.Errorf("storefront GET of a draft = %d, want 404", r.Status)
	}
}

// TestAdminHTTP_WriteErrors sends one bad write per case and checks the
// status, the code and the field the details name, then checks that no
// failed request stored anything.
func TestAdminHTTP_WriteErrors(t *testing.T) {
	s := startServer(t, nil)
	c := newCatalog(t, s.db)
	kaos := c.cats["kaos"]
	existing := c.create(t, "kaos", "kaos-ada", "Kaos Ada", "", variant("ADA-1", "M", 50000, 1), variant("ADA-2", "L", 60000, 1))
	// ADA-2 is archived: its SKU stays taken.
	mustExec(t, s.db, `UPDATE product_variants SET archived_at = now() WHERE sku = 'ADA-2'`)
	adaVariant := getAdmin(t, c, existing).Variants[0].ID
	other := c.create(t, "kaos", "kaos-polos", "Kaos Polos", "", variant("KP-1", "M", 1000, 1))
	ok := variantJSON("", "NEW-1", "M", 1000, 1)
	before := queryInt(t, s.db, `SELECT count(*) FROM products`) + queryInt(t, s.db, `SELECT count(*) FROM product_variants`)

	manyVariants := make([]map[string]any, 51)
	for i := range manyVariants {
		manyVariants[i] = variantJSON("", fmt.Sprintf("MV-%d", i), "M", 1000, 1)
	}

	tests := []struct {
		name       string
		method     string
		path       string // after /v1/admin/products
		body       string
		wantStatus int
		wantCode   string
		wantField  string // a key of details
		wantText   string // part of that detail's message, when it matters
	}{
		{"unknown field", "POST", "", `{"category_id":"` + kaos + `","slug":"x","name":"x","status":"active","variants":[],"colour":"red"}`,
			400, "VALIDATION_FAILED", "body", "unknown field"},
		{"array body", "POST", "", `[]`, 400, "VALIDATION_FAILED", "body", "must be a JSON object"},
		{"string body", "POST", "", `"kaos"`, 400, "VALIDATION_FAILED", "body", "must be a JSON object"},
		{"empty body", "POST", "", ``, 400, "VALIDATION_FAILED", "body", "is empty"},
		{"two objects", "POST", "", `{}{}`, 400, "VALIDATION_FAILED", "body", "single JSON object"},
		{"broken JSON", "POST", "", `{"slug":`, 400, "VALIDATION_FAILED", "body", "valid JSON"},
		{"wrong type", "POST", "", `{"variants":[{"price":"murah"}]}`, 400, "VALIDATION_FAILED", "body", "wrong JSON type"},
		{"over 1 MiB", "POST", "", `{"description":"` + strings.Repeat("x", 1<<20) + `"}`,
			400, "VALIDATION_FAILED", "body", "at most 1048576 bytes"},
		{"missing fields", "POST", "", `{}`, 400, "VALIDATION_FAILED", "category_id", ""},
		{"bad slug", "POST", "", productJSON(t, kaos, "Kaos Baru", "active", ok), 400, "VALIDATION_FAILED", "slug", ""},
		{"bad status", "POST", "", productJSON(t, kaos, "kaos-baru", "published", ok), 400, "VALIDATION_FAILED", "status", ""},
		{"no variants", "POST", "", productJSON(t, kaos, "kaos-baru", "active"), 400, "VALIDATION_FAILED", "variants", ""},
		{"51 variants", "POST", "", productJSON(t, kaos, "kaos-baru", "active", manyVariants...), 400, "VALIDATION_FAILED", "variants", ""},
		{"variant field", "POST", "", productJSON(t, kaos, "kaos-baru", "active", ok, variantJSON("", "NEW-2", "L", 0, 1)),
			400, "VALIDATION_FAILED", "variants[1].price", ""},
		{"negative stock", "POST", "", productJSON(t, kaos, "kaos-baru", "active", variantJSON("", "NEW-3", "L", 10, -1)),
			400, "VALIDATION_FAILED", "variants[0].stock", ""},
		{"same SKU twice after upper-casing", "POST", "", productJSON(t, kaos, "kaos-baru", "active",
			variantJSON("", "dup-1", "M", 10, 1), variantJSON("", " DUP-1", "L", 10, 1)),
			400, "VALIDATION_FAILED", "variants[1].sku", "another variant in this request"},
		{"variant id on create", "POST", "", productJSON(t, kaos, "kaos-baru", "active", variantJSON(adaVariant, "NEW-4", "M", 10, 1)),
			400, "VALIDATION_FAILED", "variants", ""},
		{"unknown category", "POST", "", productJSON(t, uuidx.NewV7(), "kaos-baru", "active", ok),
			400, "UNKNOWN_CATEGORY", "category_id", "names no category"},
		{"slug taken", "POST", "", productJSON(t, kaos, "kaos-ada", "active", ok), 409, "SLUG_TAKEN", "slug", ""},
		{"SKU taken", "POST", "", productJSON(t, kaos, "kaos-baru", "active", ok, variantJSON("", "ada-1", "L", 10, 1)),
			409, "SKU_TAKEN", "variants", ""},
		{"archived SKU taken", "POST", "", productJSON(t, kaos, "kaos-baru", "active", variantJSON("", "ADA-2", "L", 10, 1)),
			409, "SKU_TAKEN", "variants", ""},
		{"update: variant of another product", "PUT", "/" + other,
			productJSON(t, kaos, "kaos-polos", "active", variantJSON(adaVariant, "KP-1", "M", 1000, 1)),
			400, "VALIDATION_FAILED", "variants", "sellable variant of this product"},
		{"update: slug taken", "PUT", "/" + other,
			productJSON(t, kaos, "kaos-ada", "active", variantJSON("", "KP-9", "M", 1000, 1)), 409, "SLUG_TAKEN", "slug", ""},
		{"update: SKU taken", "PUT", "/" + other,
			productJSON(t, kaos, "kaos-polos", "active", variantJSON("", "ADA-1", "M", 1000, 1)), 409, "SKU_TAKEN", "variants", ""},
		// NUL cannot be stored in a PostgreSQL text column: refused as a
		// 400 naming the field, never a 500 from the database.
		{"NUL in name", "POST", "", strings.Replace(productJSON(t, kaos, "kaos-nul", "active", ok),
			`"Produk kaos-nul"`, `"Pro\u0000duk"`, 1), 400, "VALIDATION_FAILED", "name", httpapi.InvalidTextMessage},
		{"NUL in description", "POST", "", strings.Replace(productJSON(t, kaos, "kaos-nul", "active", ok),
			`"Deskripsi kaos-nul"`, `"a\u0000b"`, 1), 400, "VALIDATION_FAILED", "description", httpapi.InvalidTextMessage},
		{"NUL in slug", "POST", "", productJSON(t, kaos, "kaos\x00nul", "active", ok), 400, "VALIDATION_FAILED", "slug", ""},
		{"NUL in a variant's sku", "POST", "", productJSON(t, kaos, "kaos-nul", "active", variantJSON("", "NUL\x001", "M", 10, 1)),
			400, "VALIDATION_FAILED", "variants[0].sku", httpapi.InvalidTextMessage},
		{"NUL in a variant's name", "POST", "", productJSON(t, kaos, "kaos-nul", "active", ok, variantJSON("", "NUL-2", "L\x00", 10, 1)),
			400, "VALIDATION_FAILED", "variants[1].name", httpapi.InvalidTextMessage},
		{"update: NUL in a variant's name", "PUT", "/" + other,
			productJSON(t, kaos, "kaos-polos", "active", variantJSON("", "KP-NUL", "M\x00", 1000, 1)),
			400, "VALIDATION_FAILED", "variants[0].name", httpapi.InvalidTextMessage},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := s.send(t, tt.method, "/v1/admin/products"+tt.path, tt.body)
			details := assertErrorDetails(t, resp, tt.wantStatus, tt.wantCode)
			msg, ok := details[tt.wantField].(string)
			if !ok {
				t.Fatalf("details = %v, want a message for %q", details, tt.wantField)
			}
			if !strings.Contains(msg, tt.wantText) {
				t.Errorf("details[%q] = %q, want it to mention %q", tt.wantField, msg, tt.wantText)
			}
		})
	}

	assertNoErrorLog(t, s)
	after := queryInt(t, s.db, `SELECT count(*) FROM products`) + queryInt(t, s.db, `SELECT count(*) FROM product_variants`)
	if after != before {
		t.Errorf("failed writes stored rows: %d products+variants before, %d after", before, after)
	}
	if p := getAdmin(t, c, other); p.Slug != "kaos-polos" || len(p.Variants) != 1 || p.Variants[0].SKU != "KP-1" {
		t.Errorf("a failed PUT changed the product: %+v", p)
	}
}

// TestAdminHTTP_NotFound covers the admin 404s: unknown ids and ids that
// are not UUIDs, on every admin route.
func TestAdminHTTP_NotFound(t *testing.T) {
	s := startServer(t, nil)
	c := newCatalog(t, s.db)
	body := productJSON(t, c.cats["kaos"], "kaos-x", "active", variantJSON("", "X-1", "M", 1000, 1))
	for _, id := range []string{uuidx.NewV7(), "not-a-uuid", "123"} {
		for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
			t.Run(method+" "+id, func(t *testing.T) {
				resp := s.send(t, method, "/v1/admin/products/"+id, body)
				if resp.Status != http.StatusNotFound {
					t.Fatalf("status = %d, want 404: %s", resp.Status, resp.Body)
				}
				assertErrorBody(t, resp.Body, "NOT_FOUND")
				if !strings.Contains(string(resp.Body), "product not found") {
					t.Errorf("body = %s, want the product's 404", resp.Body)
				}
			})
		}
	}
}

// TestAdminHTTP_OnlyInDevelopment checks that the unauthenticated admin
// routes exist only with APP_ENV=development and answer the router's 404
// everywhere else.
func TestAdminHTTP_OnlyInDevelopment(t *testing.T) {
	id := uuidx.NewV7()
	routes := []struct{ method, path string }{
		{http.MethodPost, "/v1/admin/products"},
		{http.MethodGet, "/v1/admin/products/" + id},
		{http.MethodPut, "/v1/admin/products/" + id},
		{http.MethodDelete, "/v1/admin/products/" + id},
	}
	for _, env := range []string{config.EnvDevelopment, config.EnvStaging, config.EnvProduction} {
		t.Run(env, func(t *testing.T) {
			s := startServer(t, map[string]string{"APP_ENV": env})
			for _, r := range routes {
				resp := s.send(t, r.method, r.path, `{}`)
				routerNotFound := resp.Status == http.StatusNotFound && strings.Contains(string(resp.Body), "route not found")
				if env == config.EnvDevelopment && routerNotFound {
					t.Errorf("%s %s is not mounted in development", r.method, r.path)
				}
				if env != config.EnvDevelopment && !routerNotFound {
					t.Errorf("%s %s in %s = %d %s, want the router's 404", r.method, r.path, env, resp.Status, resp.Body)
				}
			}
			warned := strings.Contains(s.logs.String(), "admin routes are mounted WITHOUT authentication")
			if warned != (env == config.EnvDevelopment) {
				t.Errorf("admin warning logged = %v in %s", warned, env)
			}
		})
	}
}
