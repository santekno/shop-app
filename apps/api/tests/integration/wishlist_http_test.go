//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lib/pq"

	"github.com/santekno/shop-app/apps/api/internal/user"
	"github.com/santekno/shop-app/apps/api/internal/wishlist"
)

// Bab 14: /v1/me/wishlist over real HTTP, real PostgreSQL and the real auth
// middleware. Products are made through the repository (the API has no
// buyer-side endpoint for that); everything the buyer does goes over HTTP.

// wishlistShop is a server with the example categories and the listing
// fixture's helpers, where nothing is rate limited.
type wishlistShop struct {
	*server
	cat *catalog
	n   int // products made so far, for unique slugs and SKUs
}

func newWishlistShop(t *testing.T) *wishlistShop {
	t.Helper()
	s := startServer(t, nil, withUnlimitedRate())
	return &wishlistShop{server: s, cat: newCatalog(t, s.db)}
}

// product stores an active product and returns its slug.
func (w *wishlistShop) product(t *testing.T) string {
	t.Helper()
	w.n++
	slug := fmt.Sprintf("wl-produk-%03d", w.n)
	w.cat.create(t, "kaos", slug, "Produk "+slug, "", variant(fmt.Sprintf("WL-%03d", w.n), "M", 10000+int64(w.n), 5))
	return slug
}

// products stores n active products and returns their slugs.
func (w *wishlistShop) products(t *testing.T, n int) []string {
	t.Helper()
	out := make([]string, n)
	for i := range out {
		out[i] = w.product(t)
	}
	return out
}

// buyer is a buyer with a verified email and a session.
func (w *wishlistShop) buyer(t *testing.T, prefix string) (userOut, string) {
	t.Helper()
	u, p := w.newAccount(t, prefix)
	mustExec(t, w.db, `UPDATE users SET email_verified_at = now() WHERE id = $1`, u.ID)
	return u, p.AccessToken
}

func (w *wishlistShop) put(t *testing.T, token, slug string) response {
	t.Helper()
	return w.call(t, http.MethodPut, "/v1/me/wishlist/"+slug, nil, token)
}

func (w *wishlistShop) del(t *testing.T, token, slug string) response {
	t.Helper()
	return w.call(t, http.MethodDelete, "/v1/me/wishlist/"+slug, nil, token)
}

func (w *wishlistShop) list(t *testing.T, token, query string) ([]productOut, string) {
	t.Helper()
	path := "/v1/me/wishlist"
	if query != "" {
		path += "?" + query
	}
	return assertProductList(t, w.call(t, http.MethodGet, path, nil, token))
}

// listAll follows next_cursor and returns every slug in order.
func (w *wishlistShop) listAll(t *testing.T, token string, limit int) []string {
	t.Helper()
	var out []string
	q := url.Values{"limit": {fmt.Sprint(limit)}}
	for range 1000 {
		products, cursor := w.list(t, token, q.Encode())
		out = append(out, productSlugs(products)...)
		if cursor == "" {
			return out
		}
		q.Set("cursor", cursor)
	}
	t.Fatal("no last page after 1000 pages")
	return nil
}

func assertNoContent(t *testing.T, resp response, what string) {
	t.Helper()
	if resp.Status != http.StatusNoContent || len(resp.Body) != 0 {
		t.Fatalf("%s = %d %q, want 204 with no body", what, resp.Status, resp.Body)
	}
}

// saveAt gives the buyer's wishlist rows distinct, ordered created_at values
// (the first slug the oldest), so the newest-first order is not a matter of
// clock resolution.
func (w *wishlistShop) saveAt(t *testing.T, token string, slugs []string) {
	t.Helper()
	base := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	for i, slug := range slugs {
		assertNoContent(t, w.put(t, token, slug), "PUT "+slug)
		mustExec(t, w.db, `UPDATE wishlist_items SET created_at = $1
			WHERE product_id = (SELECT id FROM products WHERE slug = $2)`, base.Add(time.Duration(i)*time.Hour), slug)
	}
}

func (w *wishlistShop) rows(t *testing.T, userID string) int {
	t.Helper()
	return w.count(t, `SELECT count(*) FROM wishlist_items WHERE user_id = $1`, userID)
}

// TestWishlist_AddListRemove walks the happy path and the idempotent edges.
func TestWishlist_AddListRemove(t *testing.T) {
	w := newWishlistShop(t)
	slugs := w.products(t, 3)
	u, token := w.buyer(t, "wl")

	// Empty: data [] and next_cursor null.
	resp := w.call(t, http.MethodGet, "/v1/me/wishlist", nil, token)
	if products, cursor := assertProductList(t, resp); len(products) != 0 || cursor != "" {
		t.Errorf("empty wishlist = %v, %q", productSlugs(products), cursor)
	}
	if body := strings.ReplaceAll(string(resp.Body), " ", ""); !strings.Contains(body, `"data":[]`) {
		t.Errorf("empty wishlist body = %s, want data []", resp.Body)
	}

	w.saveAt(t, token, slugs)
	// Newest saved first, and each item is a full storefront product.
	products, cursor := w.list(t, token, "")
	if want := []string{slugs[2], slugs[1], slugs[0]}; !slices.Equal(productSlugs(products), want) || cursor != "" {
		t.Errorf("wishlist = %v, %q; want %v", productSlugs(products), cursor, want)
	}

	// Saving again is 204 and keeps the first row (and its created_at, so the order).
	var before time.Time
	if err := w.db.QueryRowContext(t.Context(), `SELECT created_at FROM wishlist_items WHERE user_id = $1 AND product_id = (SELECT id FROM products WHERE slug = $2)`, u.ID, slugs[0]).Scan(&before); err != nil {
		t.Fatal(err)
	}
	assertNoContent(t, w.put(t, token, slugs[0]), "PUT again")
	var after time.Time
	if err := w.db.QueryRowContext(t.Context(), `SELECT created_at FROM wishlist_items WHERE user_id = $1 AND product_id = (SELECT id FROM products WHERE slug = $2)`, u.ID, slugs[0]).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !before.Equal(after) || w.rows(t, u.ID) != 3 {
		t.Errorf("re-adding changed the row: created_at %s -> %s, %d rows", before, after, w.rows(t, u.ID))
	}
	if products, _ := w.list(t, token, ""); !slices.Equal(productSlugs(products), []string{slugs[2], slugs[1], slugs[0]}) {
		t.Errorf("re-adding changed the order: %v", productSlugs(products))
	}

	// The item is the same product GET /v1/products/{slug} shows.
	detail := assertProductDetail(t, w.get(t, "/v1/products/"+slugs[1]))
	for _, p := range products {
		if p.Slug == slugs[1] && (p.ID != detail.ID || p.Name != detail.Name || p.PriceFrom != detail.PriceFrom) {
			t.Errorf("wishlist item %+v differs from the product %+v", p, detail)
		}
	}

	// Delete: 204, idempotent, and a slug that names nothing is 204 too.
	assertNoContent(t, w.del(t, token, slugs[1]), "DELETE")
	assertNoContent(t, w.del(t, token, slugs[1]), "DELETE again")
	assertNoContent(t, w.del(t, token, "tidak-ada-produk-ini"), "DELETE unknown slug")
	assertNoContent(t, w.del(t, token, strings.Repeat("a", 300)), "DELETE over-long slug")
	assertNoContent(t, w.del(t, token, "Bukan_Slug"), "DELETE malformed slug")
	if got := w.listAll(t, token, 20); !slices.Equal(got, []string{slugs[2], slugs[0]}) {
		t.Errorf("after delete: %v", got)
	}
	// The product itself is untouched.
	assertProductDetail(t, w.get(t, "/v1/products/"+slugs[1]))
	assertNoErrorLog(t, w.server)
}

// TestWishlist_AddRefusals: PUT answers 404 for what is not an active
// product: unknown, malformed, draft and archived.
func TestWishlist_AddRefusals(t *testing.T) {
	w := newWishlistShop(t)
	_, token := w.buyer(t, "wl404")
	w.cat.createWithStatus(t, "draft", "kaos", "wl-draft", "Draft", "", variant("WLD-1", "M", 10000, 1))
	archivedID := w.cat.create(t, "kaos", "wl-arsip", "Arsip", "", variant("WLA-1", "M", 10000, 1))
	if err := w.cat.repo.Archive(t.Context(), archivedID); err != nil {
		t.Fatal(err)
	}
	for _, slug := range []string{"tidak-ada-produk-ini", "wl-draft", "wl-arsip", "Bukan_Slug", "dua--strip", strings.Repeat("a", 201)} {
		t.Run(slug[:min(len(slug), 20)], func(t *testing.T) {
			assertError(t, w.put(t, token, slug), http.StatusNotFound, "NOT_FOUND")
		})
	}
	if n := w.count(t, `SELECT count(*) FROM wishlist_items`); n != 0 {
		t.Errorf("refused saves wrote %d rows", n)
	}
	assertNoErrorLog(t, w.server)
}

// TestWishlist_Paging pages newest-first, checks the bad query values, and
// keeps the cursor stable when a product is saved or removed mid-scroll.
func TestWishlist_Paging(t *testing.T) {
	w := newWishlistShop(t)
	slugs := w.products(t, 7)
	_, token := w.buyer(t, "wlpage")
	w.saveAt(t, token, slugs[:6])
	newest := []string{slugs[5], slugs[4], slugs[3], slugs[2], slugs[1], slugs[0]}

	for _, limit := range []int{1, 2, 4, 6, 100} {
		got := w.listAll(t, token, limit)
		assertNoDuplicates(t, got)
		if !slices.Equal(got, newest) {
			t.Errorf("limit=%d: got %v, want %v", limit, got, newest)
		}
	}
	if products, _ := w.list(t, token, ""); len(products) != 6 {
		t.Errorf("default limit listed %d, want 6", len(products))
	}

	t.Run("saving mid-scroll does not shift or repeat", func(t *testing.T) {
		first, cursor := w.list(t, token, "limit=2")
		if cursor == "" || !slices.Equal(productSlugs(first), newest[:2]) {
			t.Fatalf("first page = %v, %q", productSlugs(first), cursor)
		}
		// The buyer saves a seventh product, which is now the newest.
		assertNoContent(t, w.put(t, token, slugs[6]), "PUT mid-scroll")
		second, cursor2 := w.list(t, token, "limit=2&cursor="+url.QueryEscape(cursor))
		if !slices.Equal(productSlugs(second), newest[2:4]) {
			t.Errorf("second page = %v, want %v (no repeat, no skip)", productSlugs(second), newest[2:4])
		}
		rest, cursor3 := w.list(t, token, "limit=2&cursor="+url.QueryEscape(cursor2))
		if !slices.Equal(productSlugs(rest), newest[4:]) || cursor3 != "" {
			t.Errorf("last page = %v, %q; want %v", productSlugs(rest), cursor3, newest[4:])
		}
		// A new scroll from the top starts with the new one.
		if fresh, _ := w.list(t, token, "limit=1"); productSlugs(fresh)[0] != slugs[6] {
			t.Errorf("fresh first page = %v, want %s first", productSlugs(fresh), slugs[6])
		}
	})

	t.Run("removing the cursor row mid-scroll keeps going", func(t *testing.T) {
		_, cursor := w.list(t, token, "limit=2") // after slugs[6], slugs[5]
		assertNoContent(t, w.del(t, token, slugs[5]), "DELETE the row the cursor points at")
		next, _ := w.list(t, token, "limit=2&cursor="+url.QueryEscape(cursor))
		if !slices.Equal(productSlugs(next), []string{slugs[4], slugs[3]}) {
			t.Errorf("page after removing the cursor row = %v", productSlugs(next))
		}
	})

	t.Run("bad query", func(t *testing.T) {
		_, goodCursor := w.list(t, token, "limit=1")
		_, productCursor := assertProductList(t, w.get(t, "/v1/products?limit=1"))
		tests := []struct{ name, query, field string }{
			{"limit 0", "limit=0", "limit"},
			{"limit 101", "limit=101", "limit"},
			{"limit text", "limit=dua", "limit"},
			{"garbage cursor", "cursor=" + url.QueryEscape("not a cursor!"), "cursor"},
			{"edited cursor", "limit=1&cursor=" + url.QueryEscape(goodCursor[:len(goodCursor)-2]+"AA"), "cursor"},
			{"cursor of the product list", "limit=1&cursor=" + url.QueryEscape(productCursor), "cursor"},
			{"cursor over 512 characters", "cursor=" + strings.Repeat("a", 513), "cursor"},
			{"cursor with NUL", "cursor=%00", "cursor"},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				resp := w.call(t, http.MethodGet, "/v1/me/wishlist?"+tt.query, nil, token)
				if details := assertErrorDetails(t, resp, http.StatusBadRequest, "VALIDATION_FAILED"); details[tt.field] == nil {
					t.Errorf("details = %v, want an entry for %q", details, tt.field)
				}
			})
		}
	})
	assertNoErrorLog(t, w.server)
}

// TestWishlist_Limit: the 201st distinct product is 409 with details.max
// 200, saving one already saved at the cap is still 204, and removing one
// (or archiving one) makes room.
func TestWishlist_Limit(t *testing.T) {
	w := newWishlistShop(t)
	slugs := w.products(t, 202)
	u, token := w.buyer(t, "wlcap")
	w.fillWishlist(t, u.ID, slugs[:200])

	details := assertError(t, w.put(t, token, slugs[200]), http.StatusConflict, "WISHLIST_LIMIT_REACHED")
	if details["max"] != float64(wishlist.MaxItems) || wishlist.MaxItems != 200 {
		t.Errorf("details = %v, want max 200", details)
	}
	if n := w.rows(t, u.ID); n != 200 {
		t.Errorf("rows = %d after the refused save, want 200", n)
	}
	// Already saved: still 204 at the cap, nothing changes.
	assertNoContent(t, w.put(t, token, slugs[0]), "re-add at the cap")
	assertNoContent(t, w.put(t, token, slugs[199]), "re-add the other end at the cap")
	if n := w.rows(t, u.ID); n != 200 {
		t.Errorf("rows = %d, want 200", n)
	}
	// 404 wins over 409 for a product that cannot be saved at all.
	assertError(t, w.put(t, token, "tidak-ada-produk-ini"), http.StatusNotFound, "NOT_FOUND")

	// The limit is per user.
	_, other := w.buyer(t, "wlcap2")
	assertNoContent(t, w.put(t, other, slugs[200]), "another buyer at 1 item")

	// A removal frees one place, and only one.
	assertNoContent(t, w.del(t, token, slugs[5]), "DELETE at the cap")
	assertNoContent(t, w.put(t, token, slugs[200]), "PUT after a removal")
	assertError(t, w.put(t, token, slugs[201]), http.StatusConflict, "WISHLIST_LIMIT_REACHED")

	// An archived product stops counting, as it stops being listed.
	var archivedID string
	if err := w.db.QueryRowContext(t.Context(), `SELECT id FROM products WHERE slug = $1`, slugs[10]).Scan(&archivedID); err != nil {
		t.Fatal(err)
	}
	if err := w.cat.repo.Archive(t.Context(), archivedID); err != nil {
		t.Fatal(err)
	}
	assertNoContent(t, w.put(t, token, slugs[201]), "PUT after archiving a saved product")
	if got := w.listAll(t, token, 100); len(got) != 200 {
		t.Errorf("visible items = %d, want 200 (201 rows, one archived)", len(got))
	}
	assertNoErrorLog(t, w.server)
}

// fillWishlist saves slugs for userID with SQL, as if the buyer had saved
// them one by one, so the limit tests need not make 200 requests.
func (w *wishlistShop) fillWishlist(t *testing.T, userID string, slugs []string) {
	t.Helper()
	mustExec(t, w.db, `INSERT INTO wishlist_items (user_id, product_id)
		SELECT $1, id FROM products WHERE slug = ANY($2)`, userID, pq.Array(slugs))
	if n := w.rows(t, userID); n != len(slugs) {
		t.Fatalf("fixture: %d rows, want %d", n, len(slugs))
	}
}

// TestWishlist_LimitRace: 20 distinct products saved at once from 190 cannot
// pass 200; exactly ten are saved and ten refused with 409, each iteration.
func TestWishlist_LimitRace(t *testing.T) {
	w := newWishlistShop(t)
	slugs := w.products(t, 190+20)
	for iter := range 5 {
		u, token := w.buyer(t, fmt.Sprintf("wlrace%d", iter))
		w.fillWishlist(t, u.ID, slugs[:190])

		statuses := make([]int, 20)
		var mu sync.Mutex
		fns := make([]func(), 20)
		for i := range fns {
			fns[i] = func() {
				resp, err := w.tryCall(http.MethodPut, "/v1/me/wishlist/"+slugs[190+i], nil, token, nil)
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					statuses[i] = -1
					t.Errorf("PUT: %v", err)
					return
				}
				statuses[i] = resp.Status
			}
		}
		together(fns...)

		var ok, full int
		for _, s := range statuses {
			switch s {
			case http.StatusNoContent:
				ok++
			case http.StatusConflict:
				full++
			default:
				t.Errorf("iteration %d: status %d, want 204 or 409", iter, s)
			}
		}
		if n := w.rows(t, u.ID); n != 200 || ok != 10 || full != 10 {
			t.Errorf("iteration %d: %d rows, %d saved, %d refused; want exactly 200, 10 and 10", iter, n, ok, full)
		}
	}
	assertNoErrorLog(t, w.server)
}

// TestWishlist_RaceSameProduct: the same product saved by many requests at
// once is one row, every answer 204.
func TestWishlist_RaceSameProduct(t *testing.T) {
	w := newWishlistShop(t)
	slug := w.product(t)
	u, token := w.buyer(t, "wlsame")
	statuses := make([]int, 12)
	fns := make([]func(), len(statuses))
	for i := range fns {
		fns[i] = func() {
			resp, err := w.tryCall(http.MethodPut, "/v1/me/wishlist/"+slug, nil, token, nil)
			if err != nil {
				statuses[i] = -1
				return
			}
			statuses[i] = resp.Status
		}
	}
	together(fns...)
	for _, s := range statuses {
		if s != http.StatusNoContent {
			t.Errorf("statuses = %v, want all 204", statuses)
			break
		}
	}
	if n := w.rows(t, u.ID); n != 1 {
		t.Errorf("rows = %d, want 1", n)
	}
	assertNoErrorLog(t, w.server)
}

// TestWishlist_ArchivedProduct: an archived product disappears from the
// list (the row stays), PUT answers 404 for it, DELETE still 204.
func TestWishlist_ArchivedProduct(t *testing.T) {
	w := newWishlistShop(t)
	slugs := w.products(t, 3)
	u, token := w.buyer(t, "wlarch")
	w.saveAt(t, token, slugs)

	var id string
	if err := w.db.QueryRowContext(t.Context(), `SELECT id FROM products WHERE slug = $1`, slugs[1]).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if err := w.cat.repo.Archive(t.Context(), id); err != nil {
		t.Fatal(err)
	}
	if got := w.listAll(t, token, 1); !slices.Equal(got, []string{slugs[2], slugs[0]}) {
		t.Errorf("list after archiving = %v", got)
	}
	if products, _ := w.list(t, token, "limit=2"); len(products) != 2 {
		t.Errorf("a page of 2 had %d items", len(products))
	}
	assertError(t, w.put(t, token, slugs[1]), http.StatusNotFound, "NOT_FOUND")
	if n := w.rows(t, u.ID); n != 3 {
		t.Errorf("rows = %d, want 3 (archiving keeps the row)", n)
	}
	assertNoContent(t, w.del(t, token, slugs[1]), "DELETE an archived product")
	assertNoErrorLog(t, w.server)
}

// TestWishlist_Isolation: a buyer sees and changes only their own list.
func TestWishlist_Isolation(t *testing.T) {
	w := newWishlistShop(t)
	slugs := w.products(t, 3)
	a, tokenA := w.buyer(t, "wla")
	b, tokenB := w.buyer(t, "wlb")
	w.saveAt(t, tokenA, slugs[:2])
	assertNoContent(t, w.put(t, tokenB, slugs[2]), "B saves")
	assertNoContent(t, w.put(t, tokenB, slugs[0]), "B saves a product A has too")

	if got := w.listAll(t, tokenA, 10); !slices.Equal(got, []string{slugs[1], slugs[0]}) {
		t.Errorf("A sees %v", got)
	}
	if got := w.listAll(t, tokenB, 10); !slices.Equal(got, []string{slugs[0], slugs[2]}) {
		t.Errorf("B sees %v", got)
	}
	// B removing the shared product leaves A's row.
	assertNoContent(t, w.del(t, tokenB, slugs[0]), "B removes")
	if got := w.listAll(t, tokenA, 10); !slices.Equal(got, []string{slugs[1], slugs[0]}) {
		t.Errorf("A sees %v after B removed", got)
	}
	// A cursor from A's list on B's list is a cursor of a position, not of
	// a user: it never exposes A's items.
	_, cursor := w.list(t, tokenA, "limit=1")
	page, _ := w.list(t, tokenB, "cursor="+url.QueryEscape(cursor))
	for _, p := range page {
		if p.Slug == slugs[1] {
			t.Errorf("B reads A's item %s through A's cursor", p.Slug)
		}
	}
	if w.rows(t, a.ID) != 2 || w.rows(t, b.ID) != 1 {
		t.Errorf("rows: A %d, B %d; want 2 and 1", w.rows(t, a.ID), w.rows(t, b.ID))
	}
	// The user ID is never taken from the request.
	if r := w.call(t, http.MethodGet, "/v1/me/wishlist?user_id="+b.ID, nil, tokenA); r.Status != http.StatusOK {
		t.Errorf("GET with a user_id parameter = %d", r.Status)
	} else if products, _ := assertProductList(t, r); len(products) != 2 {
		t.Errorf("a user_id parameter changed the list: %v", productSlugs(products))
	}
	assertNoErrorLog(t, w.server)
}

// TestWishlist_Auth: no token or a bad token is 401, a seller or an admin
// is 403, on all three routes; nothing is written.
func TestWishlist_Auth(t *testing.T) {
	w := newWishlistShop(t)
	slug := w.product(t)
	seller := w.accountWithRole(t, user.RoleSeller).AccessToken
	admin := w.accountWithRole(t, user.RoleAdmin).AccessToken

	routes := []struct{ method, path string }{
		{http.MethodGet, "/v1/me/wishlist"},
		{http.MethodPut, "/v1/me/wishlist/" + slug},
		{http.MethodDelete, "/v1/me/wishlist/" + slug},
	}
	for _, r := range routes {
		t.Run(r.method, func(t *testing.T) {
			assertError(t, w.call(t, r.method, r.path, nil, ""), http.StatusUnauthorized, "UNAUTHORIZED")
			assertError(t, w.call(t, r.method, r.path, nil, "garbage"), http.StatusUnauthorized, "UNAUTHORIZED")
			assertError(t, w.call(t, r.method, r.path, nil, seller), http.StatusForbidden, "FORBIDDEN")
			assertError(t, w.call(t, r.method, r.path, nil, admin), http.StatusForbidden, "FORBIDDEN")
		})
	}
	if n := w.count(t, `SELECT count(*) FROM wishlist_items`); n != 0 {
		t.Errorf("refused requests wrote %d rows", n)
	}
	assertNoErrorLog(t, w.server)
}

// TestWishlist_DeleteAccount: DELETE /v1/me removes the wishlist rows (the
// user row is anonymised, so the foreign key's CASCADE never fires) and
// leaves other buyers' alone.
func TestWishlist_DeleteAccount(t *testing.T) {
	w := newWishlistShop(t)
	slugs := w.products(t, 3)
	gone, tokenGone := w.buyer(t, "wlgone")
	stay, tokenStay := w.buyer(t, "wlstay")
	w.saveAt(t, tokenGone, slugs)
	w.saveAt(t, tokenStay, slugs[:1])

	assertNoContent(t, w.call(t, http.MethodDelete, "/v1/me", nil, tokenGone), "DELETE /v1/me")
	if n := w.rows(t, gone.ID); n != 0 {
		t.Errorf("%d wishlist rows left for the deleted account", n)
	}
	if n := w.rows(t, stay.ID); n != 1 {
		t.Errorf("other buyer has %d rows, want 1", n)
	}
	w.assertAnonymised(t, gone.ID)
	// The deleted account's token no longer works.
	assertError(t, w.call(t, http.MethodGet, "/v1/me/wishlist", nil, tokenGone), http.StatusUnauthorized, "UNAUTHORIZED")
	if got := w.listAll(t, tokenStay, 10); !slices.Equal(got, []string{slugs[0]}) {
		t.Errorf("the other buyer sees %v", got)
	}
	assertNoErrorLog(t, w.server)
}
