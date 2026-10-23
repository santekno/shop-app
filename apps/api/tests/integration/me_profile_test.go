//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// TestProfile_Patch changes the name and phone through PATCH /v1/me: a
// field left out keeps its value, phone null removes it, every invalid
// field is a 400, and the response and the row agree.
func TestProfile_Patch(t *testing.T) {
	s := startServer(t, nil)
	u, p := s.newAccount(t, "profil")
	patch := func(body any) response { return s.call(t, http.MethodPatch, "/v1/me", body, p.AccessToken) }

	got := assertUserDetail(t, patch(map[string]any{"name": "  Budi Baru ", "phone": "081234567890"}), http.StatusOK, "PATCH name and phone")
	if got.Name != "Budi Baru" || got.Phone == nil || *got.Phone != "081234567890" || got.Email != u.Email {
		t.Errorf("after the patch: %+v", got)
	}
	got = assertUserDetail(t, patch(map[string]any{"phone": "+6281234567890"}), http.StatusOK, "PATCH phone only")
	if got.Name != "Budi Baru" || got.Phone == nil || *got.Phone != "+6281234567890" {
		t.Errorf("a phone-only patch changed the name or not the phone: %+v", got)
	}
	got = assertUserDetail(t, patch(map[string]any{"phone": nil}), http.StatusOK, "PATCH phone null")
	if got.Phone != nil {
		t.Errorf("phone null did not remove the phone: %+v", got)
	}
	if n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND name = 'Budi Baru' AND phone IS NULL`, u.ID); n != 1 {
		t.Error("the row does not match the response")
	}
	if me := assertUserDetail(t, s.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken), http.StatusOK, "GET /v1/me"); me != got {
		t.Errorf("GET /v1/me = %+v, want the patched %+v", me, got)
	}

	for name, body := range map[string]any{
		"empty name":     map[string]any{"name": " "},
		"long name":      map[string]any{"name": strings.Repeat("n", 101)},
		"bad phone":      map[string]any{"phone": "12345"},
		"phone a number": map[string]any{"phone": 81234567890},
		"email":          map[string]any{"email": uniqueEmail("ganti")},
		"role":           map[string]any{"role": "admin"},
		"not JSON":       `{"name":`,
	} {
		t.Run(name, func(t *testing.T) {
			assertError(t, patch(body), http.StatusBadRequest, "VALIDATION_FAILED")
		})
	}
	if n := s.count(t, `SELECT count(*) FROM users WHERE id = $1 AND role = 'buyer' AND email = $2 AND name = 'Budi Baru'`, u.ID, u.Email); n != 1 {
		t.Error("a refused patch changed the account")
	}
}

// addressBody is an AddressCreate.
func addressBody(label string, isDefault bool) map[string]any {
	return map[string]any{
		"label": label, "recipient_name": "Budi Santoso", "phone": "081234567890",
		"street": "Jl. Merdeka No. 10", "city": "Bandung", "province": "Jawa Barat",
		"postal_code": "40111", "is_default": isDefault,
	}
}

// addressOut is Address in api/openapi.yaml (the fields the tests read).
type addressOut struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	City      string `json:"city"`
	IsDefault bool   `json:"is_default"`
}

// assertAddress checks an AddressDetail body against the contract.
func assertAddress(t *testing.T, resp response, status int, what string) addressOut {
	t.Helper()
	if resp.Status != status {
		t.Fatalf("%s = %d, want %d: %s", what, resp.Status, status, resp.Body)
	}
	top := decodeObject(t, resp.Body)
	assertMatchesSchema(t, top, contractSchema(t, "AddressDetail"), what)
	assertMatchesSchema(t, decodeObject(t, top["data"]), contractSchema(t, "Address"), what+" data")
	return decodeData[addressOut](t, resp.Body)
}

// listAddresses returns GET /v1/me/addresses, checked against the contract.
func (s *server) listAddresses(t *testing.T, token string) []addressOut {
	t.Helper()
	resp := s.call(t, http.MethodGet, "/v1/me/addresses", nil, token)
	if resp.Status != http.StatusOK {
		t.Fatalf("GET /v1/me/addresses = %d: %s", resp.Status, resp.Body)
	}
	top := decodeObject(t, resp.Body)
	assertMatchesSchema(t, top, contractSchema(t, "AddressList"), "address list")
	return decodeData[[]addressOut](t, resp.Body)
}

// labels lists label:default pairs, for error messages and comparisons.
func labels(list []addressOut) string {
	var b strings.Builder
	for _, a := range list {
		fmt.Fprintf(&b, "%s:%v ", a.Label, a.IsDefault)
	}
	return strings.TrimSpace(b.String())
}

// TestAddresses_CRUD walks an address book: the first address is the
// default whatever it says, a new default takes over, the list is the
// default first then the newest, PATCH changes only what it names, the
// default cannot be unset, and deleting the default promotes the newest
// remaining address. PostgreSQL holds exactly one default throughout.
func TestAddresses_CRUD(t *testing.T) {
	s := startServer(t, nil)
	u, p := s.newAccount(t, "alamat")
	create := func(body any) response { return s.call(t, http.MethodPost, "/v1/me/addresses", body, p.AccessToken) }
	defaults := func() int {
		return s.count(t, `SELECT count(*) FROM addresses WHERE user_id = $1 AND is_default`, u.ID)
	}

	if list := s.listAddresses(t, p.AccessToken); len(list) != 0 {
		t.Fatalf("a new account has addresses: %v", list)
	}
	resp := create(addressBody("Rumah", false))
	home := assertAddress(t, resp, http.StatusCreated, "first address")
	if !home.IsDefault || resp.Header.Get("Location") != "/v1/me/addresses/"+home.ID {
		t.Errorf("first address: default %v, Location %q", home.IsDefault, resp.Header.Get("Location"))
	}
	office := assertAddress(t, create(addressBody("Kantor", true)), http.StatusCreated, "second address as default")
	kos := assertAddress(t, create(addressBody("Kos", false)), http.StatusCreated, "third address")
	if got := labels(s.listAddresses(t, p.AccessToken)); got != "Kantor:true Kos:false Rumah:false" || defaults() != 1 {
		t.Errorf("list = %s with %d defaults, want Kantor:true Kos:false Rumah:false and one default", got, defaults())
	}

	got := assertAddress(t, s.call(t, http.MethodGet, "/v1/me/addresses/"+home.ID, nil, p.AccessToken), http.StatusOK, "GET address")
	if got.Label != "Rumah" || got.IsDefault {
		t.Errorf("GET %s = %+v", home.ID, got)
	}
	got = assertAddress(t, s.call(t, http.MethodPatch, "/v1/me/addresses/"+home.ID, map[string]any{"city": " Jakarta "}, p.AccessToken),
		http.StatusOK, "PATCH city")
	if got.City != "Jakarta" || got.Label != "Rumah" || got.IsDefault {
		t.Errorf("PATCH city = %+v, want only the city changed (trimmed)", got)
	}
	// null is the same as leaving a field out (AddressPatch allows it).
	got = assertAddress(t, s.call(t, http.MethodPatch, "/v1/me/addresses/"+home.ID,
		map[string]any{"label": nil, "city": nil, "is_default": nil}, p.AccessToken), http.StatusOK, "PATCH nulls")
	if got.City != "Jakarta" || got.Label != "Rumah" || got.IsDefault {
		t.Errorf("PATCH with nulls = %+v, want nothing changed", got)
	}
	details := assertError(t, s.call(t, http.MethodPatch, "/v1/me/addresses/"+office.ID, map[string]any{"is_default": false}, p.AccessToken),
		http.StatusConflict, "DEFAULT_ADDRESS_REQUIRED")
	if _, ok := details["is_default"]; !ok {
		t.Errorf("DEFAULT_ADDRESS_REQUIRED details = %v", details)
	}
	got = assertAddress(t, s.call(t, http.MethodPatch, "/v1/me/addresses/"+home.ID, map[string]any{"is_default": true}, p.AccessToken),
		http.StatusOK, "PATCH is_default")
	if !got.IsDefault || defaults() != 1 {
		t.Errorf("making Rumah the default: %+v with %d defaults", got, defaults())
	}

	if r := s.call(t, http.MethodDelete, "/v1/me/addresses/"+home.ID, nil, p.AccessToken); r.Status != http.StatusNoContent || len(r.Body) != 0 {
		t.Fatalf("DELETE the default = %d %q, want 204", r.Status, r.Body)
	}
	if got := labels(s.listAddresses(t, p.AccessToken)); got != "Kos:true Kantor:false" || defaults() != 1 {
		t.Errorf("after deleting the default: %s, want the newest (Kos) promoted", got)
	}
	assertError(t, s.call(t, http.MethodGet, "/v1/me/addresses/"+home.ID, nil, p.AccessToken), http.StatusNotFound, "NOT_FOUND")
	for _, id := range []string{kos.ID, office.ID} {
		if r := s.call(t, http.MethodDelete, "/v1/me/addresses/"+id, nil, p.AccessToken); r.Status != http.StatusNoContent {
			t.Fatalf("DELETE %s = %d", id, r.Status)
		}
	}
	if n := s.count(t, `SELECT count(*) FROM addresses WHERE user_id = $1`, u.ID); n != 0 {
		t.Errorf("%d addresses left after deleting all", n)
	}
}

// TestAddresses_Refusals: invalid bodies are a 400 per field, the 21st
// address is 409 ADDRESS_LIMIT_REACHED with details.max, ids that are not
// UUIDs or are unknown are 404, and the routes need a login.
func TestAddresses_Refusals(t *testing.T) {
	s := startServer(t, nil)
	u, p := s.newAccount(t, "alamat-tolak")
	create := func(body any) response { return s.call(t, http.MethodPost, "/v1/me/addresses", body, p.AccessToken) }

	bad := func(change func(b map[string]any)) map[string]any {
		b := addressBody("Rumah", false)
		change(b)
		return b
	}
	for name, tt := range map[string]struct {
		body  any
		field string
	}{
		"missing fields": {map[string]any{}, "label"},
		"postal code":    {bad(func(b map[string]any) { b["postal_code"] = "0123" }), "postal_code"},
		"phone":          {bad(func(b map[string]any) { b["phone"] = "12345" }), "phone"},
		"long street":    {bad(func(b map[string]any) { b["street"] = strings.Repeat("j", 501) }), "street"},
		"NUL in city":    {bad(func(b map[string]any) { b["city"] = "Ban\x00dung" }), "city"},
		"user_id":        {bad(func(b map[string]any) { b["user_id"] = uuidx.NewV7() }), "body"},
	} {
		t.Run(name, func(t *testing.T) {
			details := assertError(t, create(tt.body), http.StatusBadRequest, "VALIDATION_FAILED")
			if _, ok := details[tt.field]; !ok {
				t.Errorf("details = %v, want %q", details, tt.field)
			}
		})
	}
	if n := s.count(t, `SELECT count(*) FROM addresses`); n != 0 {
		t.Fatalf("%d addresses stored by invalid bodies", n)
	}

	for i := range 20 {
		assertAddress(t, create(addressBody(fmt.Sprint("Alamat ", i), false)), http.StatusCreated, "address")
	}
	details := assertError(t, create(addressBody("Satu lagi", false)), http.StatusConflict, "ADDRESS_LIMIT_REACHED")
	if details["max"] != float64(20) {
		t.Errorf("ADDRESS_LIMIT_REACHED details = %v, want max 20", details)
	}
	if n := s.count(t, `SELECT count(*) FROM addresses WHERE user_id = $1`, u.ID); n != 20 {
		t.Errorf("%d addresses, want 20", n)
	}

	for _, id := range []string{uuidx.NewV7(), "bukan-uuid", "1"} {
		for _, method := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete} {
			assertError(t, s.call(t, method, "/v1/me/addresses/"+id, map[string]any{"city": "X"}, p.AccessToken), http.StatusNotFound, "NOT_FOUND")
		}
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		assertError(t, s.call(t, method, "/v1/me/addresses", addressBody("x", false), ""), http.StatusUnauthorized, "UNAUTHORIZED")
	}
}

// TestAddresses_Ownership: another user's address answers 404 on GET,
// PATCH and DELETE, exactly like a missing one, never appears in their
// list, and is left unchanged in PostgreSQL.
func TestAddresses_Ownership(t *testing.T) {
	s := startServer(t, nil)
	_, owner := s.newAccount(t, "pemilik")
	_, intruder := s.newAccount(t, "penyusup")
	a := assertAddress(t, s.call(t, http.MethodPost, "/v1/me/addresses", addressBody("Rumah", true), owner.AccessToken),
		http.StatusCreated, "owner's address")
	missing := s.call(t, http.MethodGet, "/v1/me/addresses/"+uuidx.NewV7(), nil, intruder.AccessToken)

	for _, method := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete} {
		resp := s.call(t, method, "/v1/me/addresses/"+a.ID, map[string]any{"city": "Diretas", "is_default": true}, intruder.AccessToken)
		assertError(t, resp, http.StatusNotFound, "NOT_FOUND")
		if string(resp.Body) != string(missing.Body) {
			t.Errorf("%s of another user's address = %s, want exactly the missing address's 404 %s", method, resp.Body, missing.Body)
		}
	}
	if list := s.listAddresses(t, intruder.AccessToken); len(list) != 0 {
		t.Errorf("the intruder's list shows %v", list)
	}
	if n := s.count(t, `SELECT count(*) FROM addresses WHERE id = $1 AND city = 'Bandung' AND is_default`, a.ID); n != 1 {
		t.Error("the intruder changed or deleted the owner's address")
	}
	if got := labels(s.listAddresses(t, owner.AccessToken)); got != "Rumah:true" {
		t.Errorf("owner's list = %s", got)
	}
}

// TestAddresses_CrossOriginLocation: a browser app on another origin can
// read the Location of a new address, because the API exposes it through
// CORS.
func TestAddresses_CrossOriginLocation(t *testing.T) {
	const web = "http://localhost:5173"
	s := startServer(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": web})
	_, p := s.newAccount(t, "cors-lokasi")
	resp, err := s.tryCall(http.MethodPost, "/v1/me/addresses", addressBody("Rumah", true), p.AccessToken, map[string]string{"Origin": web})
	if err != nil {
		t.Fatal(err)
	}
	a := assertAddress(t, resp, http.StatusCreated, "cross-origin address create")
	if got := resp.Header.Get("Location"); got != "/v1/me/addresses/"+a.ID {
		t.Errorf("Location = %q", got)
	}
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != web {
		t.Errorf("Access-Control-Allow-Origin on the 201 = %q, want %q", got, web)
	}
	assertExposes(t, resp, "X-Request-ID", "Retry-After", "Location")
}
