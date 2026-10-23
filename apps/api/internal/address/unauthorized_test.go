package address_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/address"
)

// A caller whose account is gone gets 401 with WWW-Authenticate from every
// address route; a missing address is a plain 404 without it.
func TestHandler_AccountGoneAsksForBearer(t *testing.T) {
	requests := []struct{ method, path, body string }{
		{http.MethodGet, "/me/addresses", ""},
		{http.MethodGet, "/me/addresses/" + addrID, ""},
		{http.MethodPatch, "/me/addresses/" + addrID, `{}`},
		{http.MethodDelete, "/me/addresses/" + addrID, ""},
	}
	for _, req := range requests {
		b := newFakeBook()
		b.err = address.ErrNoUser
		rec := serve(b, req.method, req.path, req.body)
		assertError(t, rec, http.StatusUnauthorized, "UNAUTHORIZED")
		testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`, "%s %s", req.method, req.path)
	}
	b := newFakeBook()
	b.err = address.ErrNoUser
	rec := serve(b, http.MethodPost, "/me/addresses", jsonBody(t, validCreate()))
	testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), `Bearer realm="goshop"`, "POST")

	rec = serve(newFakeBook(), http.MethodGet, "/me/addresses/"+otherID, "")
	assertError(t, rec, http.StatusNotFound, "NOT_FOUND")
	testx.AssertEqual(t, rec.Header().Get("WWW-Authenticate"), "", "a 404 asks for no credentials")
}
