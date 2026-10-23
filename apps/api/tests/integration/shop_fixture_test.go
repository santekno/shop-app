//go:build integration

package integration_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The Bab 5 harness: a test server with the example categories, an admin,
// and helpers that drive carts, checkout and orders over real HTTP the way
// a client does. Fixtures the API has no endpoint for (products are made
// through the repository, vouchers and "paid" with SQL or the service
// Bab 6's webhook will call) go straight to the test's own database.

// shop is a running API with a catalog and an admin token.
type shop struct {
	*server
	cat *catalog
	// staff is an admin's access token, for /v1/admin.
	staff string
}

// newShop starts a development server on its own database and Redis,
// seeds the example categories and logs an admin in. The rate limiter
// allows everything unless opts bring their own (later options win).
func newShop(t *testing.T, env map[string]string, opts ...app.Option) *shop {
	t.Helper()
	s := startServer(t, env, append([]app.Option{withUnlimitedRate()}, opts...)...)
	return &shop{server: s, cat: newCatalog(t, s.db), staff: s.accountWithRole(t, user.RoleAdmin).AccessToken}
}

// productFixture is an active product and its variants' IDs by SKU.
type productFixture struct {
	ID       string
	Slug     string
	Variants map[string]string
}

// product stores an active product in the kaos category with variants
// (variant() in catalog_fixture_test.go: 200 g each) and returns its IDs.
func (sh *shop) product(t *testing.T, slug string, variants ...product.VariantInput) productFixture {
	t.Helper()
	id := sh.cat.create(t, "kaos", slug, "Kaos "+slug, "Kaos untuk uji "+slug, variants...)
	p := productFixture{ID: id, Slug: slug, Variants: map[string]string{}}
	rows, err := sh.db.QueryContext(t.Context(), `SELECT id, sku FROM product_variants WHERE product_id = $1`, id)
	if err != nil {
		t.Fatalf("read variants of %s: %v", slug, err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var vid, sku string
		if err := rows.Scan(&vid, &sku); err != nil {
			t.Fatal(err)
		}
		p.Variants[sku] = vid
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return p
}

// stock is a variant's stock in PostgreSQL.
func (sh *shop) stock(t *testing.T, variantID string) int {
	t.Helper()
	return sh.count(t, `SELECT stock FROM product_variants WHERE id = $1`, variantID)
}

// buyer is a verified account with a default address and a session.
type buyer struct {
	ID        string
	Email     string
	Token     string
	AddressID string
	Pair      tokenPairOut
}

// buyer registers an account over HTTP, marks its email verified with SQL
// (TestCheckout_EmailUnverified walks the real verification), logs it in
// and gives it a default address over HTTP.
func (sh *shop) buyer(t *testing.T, prefix string) buyer {
	t.Helper()
	u, p := sh.newAccount(t, prefix)
	mustExec(t, sh.db, `UPDATE users SET email_verified_at = now() WHERE id = $1`, u.ID)
	a := assertAddress(t, sh.call(t, http.MethodPost, "/v1/me/addresses", addressBody("Rumah", true), p.AccessToken),
		http.StatusCreated, "POST /v1/me/addresses")
	return buyer{ID: u.ID, Email: u.Email, Token: p.AccessToken, AddressID: a.ID, Pair: p}
}

// cartHeaders is the X-Cart-Token header when token is set.
func cartHeaders(token string) map[string]string {
	if token == "" {
		return nil
	}
	return map[string]string{"X-Cart-Token": token}
}

// addItem sends POST /v1/cart/items as bearer (empty for a guest) with the
// guest cartToken (empty for none).
func (sh *shop) addItem(t *testing.T, bearer, cartToken, variantID string, quantity int) response {
	t.Helper()
	resp, err := sh.tryCall(http.MethodPost, "/v1/cart/items",
		map[string]any{"variant_id": variantID, "quantity": quantity}, bearer, cartHeaders(cartToken))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// add puts quantity of variantID in b's cart and fails unless it worked.
func (sh *shop) add(t *testing.T, b buyer, variantID string, quantity int) cartOut {
	t.Helper()
	return assertCart(t, sh.addItem(t, b.Token, "", variantID, quantity), "POST /v1/cart/items")
}

// cartReq sends a cart request with a bearer and a guest token, either
// optional.
func (sh *shop) cartReq(t *testing.T, method, path string, body any, bearer, cartToken string) response {
	t.Helper()
	resp, err := sh.tryCall(method, path, body, bearer, cartHeaders(cartToken))
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// checkoutBody is a CheckoutRequest with JNE REG to addressID.
func checkoutBody(addressID string) map[string]any {
	return map[string]any{"address_id": addressID, "courier": "jne", "service": "REG"}
}

// withVoucher is body with voucher_code.
func withVoucher(body map[string]any, code string) map[string]any {
	out := map[string]any{"voucher_code": code}
	for k, v := range body {
		out[k] = v
	}
	return out
}

// tryCheckout sends POST /v1/checkout with key as Idempotency-Key (none
// when empty).
func (sh *shop) tryCheckout(token, key string, body any) (response, error) {
	var headers map[string]string
	if key != "" {
		headers = map[string]string{"Idempotency-Key": key}
	}
	return sh.tryCall(http.MethodPost, "/v1/checkout", body, token, headers)
}

// checkout is tryCheckout that fails the test on a transport error.
func (sh *shop) checkout(t *testing.T, token, key string, body any) response {
	t.Helper()
	resp, err := sh.tryCheckout(token, key, body)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// line is a variant and how many units of it to order.
type line struct {
	variantID string
	quantity  int
}

// order puts lines in b's cart, checks out with a fresh key and JNE REG,
// and returns the new order (checked against the contract).
func (sh *shop) order(t *testing.T, b buyer, lines ...line) orderOut {
	t.Helper()
	for _, l := range lines {
		sh.add(t, b, l.variantID, l.quantity)
	}
	return assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusCreated, "POST /v1/checkout")
}

// staffCall sends a request with the admin's token.
func (sh *shop) staffCall(t *testing.T, method, path string, body any) response {
	t.Helper()
	return sh.call(t, method, path, body, sh.staff)
}

// orders is the order service on the test database, for what Bab 5 has
// no route for (MarkPaid, the payment webhook's, arrives in Bab 6).
func (sh *shop) orders() *order.Service {
	return order.NewService(order.Deps{Repo: order.NewPostgresRepository(sh.db)})
}

// markPaid moves an order to paid the way Bab 6's webhook will.
func (sh *shop) markPaid(t *testing.T, orderID string) {
	t.Helper()
	if err := sh.orders().MarkPaid(t.Context(), orderID); err != nil {
		t.Fatalf("MarkPaid %s: %v", orderID, err)
	}
}

// expireNow moves an unpaid order's payment deadline into the past.
func (sh *shop) expireNow(t *testing.T, orderID string) {
	t.Helper()
	mustExec(t, sh.db, `UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, orderID)
}

// events lists the outbox event types of an order, oldest first.
func (sh *shop) events(t *testing.T, orderID string) []string {
	t.Helper()
	rows, err := sh.db.QueryContext(t.Context(),
		`SELECT event_type FROM outbox_events WHERE aggregate_type = 'order' AND aggregate_id = $1 ORDER BY created_at, id`, orderID)
	if err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			t.Fatal(err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// assertEvents fails unless the order's outbox holds exactly want, in order.
func (sh *shop) assertEvents(t *testing.T, orderID string, want ...string) {
	t.Helper()
	if got := sh.events(t, orderID); !slices.Equal(got, want) {
		t.Errorf("outbox events of %s = %v, want %v", orderID, got, want)
	}
}

// voucherSpec is one row of vouchers; zero limits mean "unlimited" and
// zero times "from an hour ago for a day".
type voucherSpec struct {
	code        string
	kind        string
	value       int64
	minSpend    int64
	maxDiscount int64
	usageLimit  int32
	perUser     int32
	startsAt    time.Time
	endsAt      time.Time
}

// voucher inserts spec (make seed's way: there is no voucher admin until
// Bab 12) and returns its ID.
func (sh *shop) voucher(t *testing.T, spec voucherSpec) string {
	t.Helper()
	if spec.startsAt.IsZero() {
		spec.startsAt = time.Now().Add(-time.Hour)
	}
	if spec.endsAt.IsZero() {
		spec.endsAt = time.Now().Add(24 * time.Hour)
	}
	if spec.perUser == 0 {
		spec.perUser = 1
	}
	var maxDiscount, usageLimit any
	if spec.maxDiscount > 0 {
		maxDiscount = spec.maxDiscount
	}
	if spec.usageLimit > 0 {
		usageLimit = spec.usageLimit
	}
	id := uuidx.NewV7()
	mustExec(t, sh.db, `INSERT INTO vouchers (id, code, kind, value, min_spend, max_discount, starts_at, ends_at, usage_limit, per_user_limit)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		id, spec.code, spec.kind, spec.value, spec.minSpend, maxDiscount, spec.startsAt, spec.endsAt, usageLimit, spec.perUser)
	return id
}

// usedCount is a voucher's used_count.
func (sh *shop) usedCount(t *testing.T, voucherID string) int {
	t.Helper()
	return sh.count(t, `SELECT used_count FROM vouchers WHERE id = $1`, voucherID)
}

// runCommand runs the api binary's one-shot command name (`api
// expire-orders`, …) in-process through app.Run, with the environment the
// test server was started with, so it reads the same database, and returns
// what it logged.
func runCommand(t *testing.T, name string) string {
	t.Helper()
	var out bytes.Buffer
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	if err := app.Run(ctx, []string{name}, &out); err != nil {
		t.Fatalf("api %s: %v\n%s", name, err, out.String())
	}
	return out.String()
}

// testShipping is a shipping.Provider a test steers. By default it prices
// like shipping.Static. failing makes every quote fail as an unreachable
// courier API would; barrier(n) makes the next n quotes wait for each
// other, so n checkouts read their carts before any of them commits;
// holdNext parks the next quote alone until the test releases it.
type testShipping struct {
	failing atomic.Bool
	calls   atomic.Int64

	mu      sync.Mutex
	parties int
	arrived int
	gate    chan struct{}
	holds   []parkedQuote
}

// parkedQuote is one quote holdNext parks.
type parkedQuote struct {
	entered chan struct{}
	release chan struct{}
}

var _ shipping.Provider = (*testShipping)(nil)

// Name implements shipping.Provider.
func (*testShipping) Name() string { return "test" }

// Quote implements shipping.Provider.
func (p *testShipping) Quote(ctx context.Context, req shipping.Request) ([]shipping.Quote, error) {
	p.calls.Add(1)
	if p.failing.Load() {
		return nil, fmt.Errorf("%w: the test made the courier API fail", shipping.ErrUnavailable)
	}
	var wait chan struct{}
	p.mu.Lock()
	switch {
	case len(p.holds) > 0:
		h := p.holds[0]
		p.holds = p.holds[1:]
		close(h.entered)
		wait = h.release
	case p.gate != nil:
		wait = p.gate
		p.arrived++
		if p.arrived == p.parties {
			close(p.gate)
			p.gate, p.parties, p.arrived = nil, 0, 0
		}
	}
	p.mu.Unlock()
	if wait != nil {
		select {
		case <-wait:
		case <-time.After(10 * time.Second):
		case <-ctx.Done():
			return nil, fmt.Errorf("%w: %w", shipping.ErrUnavailable, ctx.Err())
		}
	}
	return shipping.Static{}.Quote(ctx, req)
}

// barrier makes the next n quotes wait until all n have arrived (at most
// 10 seconds).
func (p *testShipping) barrier(n int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.gate, p.parties, p.arrived = make(chan struct{}), n, 0
}

// holdNext parks the next quote: entered is closed when it arrives, and it
// goes on when release is called (or after 10 seconds). Quotes after it
// are not held.
func (p *testShipping) holdNext() (entered <-chan struct{}, release func()) {
	h := parkedQuote{entered: make(chan struct{}), release: make(chan struct{})}
	p.mu.Lock()
	p.holds = append(p.holds, h)
	p.mu.Unlock()
	var once sync.Once
	return h.entered, func() { once.Do(func() { close(h.release) }) }
}

// waitFor fails the test unless ch is closed within 10 seconds.
func waitFor(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

// moneyOf is whole rupiah as Money.
func moneyOf(amount int64) moneyOut { return moneyOut{Amount: amount, Currency: "IDR"} }

// statusCounts tallies responses as "201", "409 CART_CHANGED", …, for race
// reports.
func statusCounts(t *testing.T, results []response) map[string]int {
	t.Helper()
	out := map[string]int{}
	for _, r := range results {
		key := fmt.Sprint(r.Status)
		if r.Status >= 400 {
			var e struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			_ = json.Unmarshal(r.Body, &e)
			key += " " + e.Error.Code
		}
		out[key]++
	}
	return out
}

// assertNo5xx fails on any server error among results.
func assertNo5xx(t *testing.T, what string, results ...response) {
	t.Helper()
	for _, r := range results {
		if r.Status >= 500 {
			t.Errorf("%s: %d %s", what, r.Status, r.Body)
		}
	}
}

// queryStrings runs a query that returns one text column.
func queryStrings(t *testing.T, db *sql.DB, query string, args ...any) []string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(), query, args...)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// errorCode is the code of an error body, or "".
func errorCode(body []byte) string {
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &e)
	return e.Error.Code
}

// is reports whether resp is status with the error code (code "" for a
// success).
func is(resp response, status int, code string) bool {
	return resp.Status == status && (code == "" || errorCode(resp.Body) == code)
}

// describe is a short form of resp for messages.
func describe(resp response) string {
	return fmt.Sprintf("%d %s", resp.Status, strings.TrimSpace(string(resp.Body)))
}
