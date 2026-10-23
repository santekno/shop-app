//go:build integration

package integration_test

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
)

// requestHash is the SHA-256 the API stores for a checkout body: the
// handler's struct re-encoded as JSON (order.RequestHash), so field order
// and whitespace do not matter. TestIdempotency_Replay checks it against a
// stored row before other tests rely on it.
func requestHash(addressID, courier, service, voucher string) []byte {
	sum := sha256.Sum256(fmt.Appendf(nil, `{"address_id":%q,"courier":%q,"service":%q,"voucher_code":%q}`,
		addressID, courier, service, voucher))
	return sum[:]
}

// TestIdempotency_KeyRequired: the header is required and must be 1-255
// printable ASCII characters (400 IDEMPOTENCY_KEY_REQUIRED, nothing
// written); 255 characters are fine.
func TestIdempotency_KeyRequired(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-kunci", variant("KC-M", "M", 10000, 5))
	b := sh.buyer(t, "kunci")
	sh.add(t, b, p.Variants["KC-M"], 1)
	for name, key := range map[string]string{
		"missing": "", "a space": "kunci saya", "256 characters": strings.Repeat("k", 256), "non-ASCII": "kunci-é",
	} {
		t.Run(name, func(t *testing.T) {
			assertError(t, sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)), http.StatusBadRequest, "IDEMPOTENCY_KEY_REQUIRED")
		})
	}
	if n := sh.count(t, `SELECT count(*) FROM orders`) + sh.count(t, `SELECT count(*) FROM idempotency_keys`); n != 0 {
		t.Errorf("refused keys wrote %d rows", n)
	}
	assertOrderDetail(t, sh.checkout(t, b.Token, strings.Repeat("k", 255), checkoutBody(b.AddressID)), http.StatusCreated, "a 255-character key")
}

// TestIdempotency_Replay: a retry with the same key and the same body (in
// another key order and spacing) gets the first 201 byte for byte, with
// Idempotency-Replayed: true and the same Location, even after the order
// moved on; there is one order and the stock is taken once. The same key
// with another body is 422 IDEMPOTENCY_KEY_REUSED. Keys belong to their
// user: another buyer may use the same one. A browser may read the replay
// header.
func TestIdempotency_Replay(t *testing.T) {
	const web = "http://localhost:5173"
	sh := newShop(t, map[string]string{"APP_CORS_ALLOWED_ORIGINS": web})
	p := sh.product(t, "kaos-ulang", variant("UL-M", "M", 10000, 10))
	m := p.Variants["UL-M"]
	b := sh.buyer(t, "ulang")
	sh.add(t, b, m, 2)
	key := uuidx.NewV7()

	first := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID))
	o := assertOrderDetail(t, first, http.StatusCreated, "first")
	if n := sh.count(t, `SELECT count(*) FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND request_hash = $3`,
		b.ID, key, requestHash(b.AddressID, "jne", "REG", "")); n != 1 {
		t.Fatal("the stored request hash is not order.RequestHash of the body as this test computes it")
	}
	reordered := fmt.Sprintf(`{ "service" : "REG",   "courier":"jne",
		"address_id": %q }`, b.AddressID)
	for i := range 3 {
		resp, err := sh.tryCall(http.MethodPost, "/v1/checkout", reordered, b.Token,
			map[string]string{"Idempotency-Key": key, "Origin": web})
		if err != nil {
			t.Fatal(err)
		}
		assertOrderDetail(t, resp, http.StatusCreated, fmt.Sprintf("replay %d", i))
		if string(resp.Body) != string(first.Body) {
			t.Errorf("replay %d body:\n%s\nwant the first answer:\n%s", i, resp.Body, first.Body)
		}
		if resp.Header.Get("Idempotency-Replayed") != "true" || resp.Header.Get("Location") != first.Header.Get("Location") {
			t.Errorf("replay %d: Idempotency-Replayed %q, Location %q", i, resp.Header.Get("Idempotency-Replayed"), resp.Header.Get("Location"))
		}
		assertExposes(t, resp, exposedHeaders...)
	}
	if n := sh.count(t, `SELECT count(*) FROM orders`); n != 1 {
		t.Errorf("%d orders, want 1", n)
	}
	if s := sh.stock(t, m); s != 8 {
		t.Errorf("stock = %d, want 8", s)
	}
	sh.assertEvents(t, o.ID, "order.created")

	// The stored answer is the order as it was created.
	assertOrderDetail(t, sh.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	if r := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)); string(r.Body) != string(first.Body) {
		t.Errorf("a replay after the cancel = %s, want the stored first answer", r.Body)
	}

	for name, body := range map[string]map[string]any{
		"another service": {"address_id": b.AddressID, "courier": "jne", "service": "YES"},
		"a voucher":       withVoucher(checkoutBody(b.AddressID), "HEMAT10"),
	} {
		t.Run(name, func(t *testing.T) {
			assertError(t, sh.checkout(t, b.Token, key, body), http.StatusUnprocessableEntity, "IDEMPOTENCY_KEY_REUSED")
		})
	}

	other := sh.buyer(t, "ulang-lain")
	sh.add(t, other, m, 1)
	theirs := assertOrderDetail(t, sh.checkout(t, other.Token, key, checkoutBody(other.AddressID)), http.StatusCreated, "another buyer, same key")
	if theirs.ID == o.ID {
		t.Error("another buyer's key replayed the first buyer's order")
	}
	assertNoErrorLog(t, sh.server)
}

// TestIdempotency_InFlight holds the first checkout in its shipping quote:
// a retry with the same key is 409 IDEMPOTENCY_IN_PROGRESS (another body
// still 422); once the first finishes, a retry replays it.
func TestIdempotency_InFlight(t *testing.T) {
	provider := &testShipping{}
	sh := newShop(t, nil, app.WithShippingProvider(provider))
	p := sh.product(t, "kaos-jalan", variant("JL-M", "M", 10000, 10))
	b := sh.buyer(t, "jalan")
	sh.add(t, b, p.Variants["JL-M"], 1)
	key := uuidx.NewV7()

	entered, release := provider.holdNext()
	defer release()
	firstDone := make(chan response, 1)
	go func() {
		r, err := sh.tryCheckout(b.Token, key, checkoutBody(b.AddressID))
		if err != nil {
			r = response{Status: -1, Body: []byte(err.Error())}
		}
		firstDone <- r
	}()
	waitFor(t, entered, "the first checkout's quote")

	assertError(t, sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)), http.StatusConflict, "IDEMPOTENCY_IN_PROGRESS")
	assertError(t, sh.checkout(t, b.Token, key, map[string]any{"address_id": b.AddressID, "courier": "jnt", "service": "EZ"}),
		http.StatusUnprocessableEntity, "IDEMPOTENCY_KEY_REUSED")
	release()
	first := <-firstDone
	assertOrderDetail(t, first, http.StatusCreated, "the held checkout")
	replay := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID))
	if replay.Status != http.StatusCreated || replay.Header.Get("Idempotency-Replayed") != "true" || string(replay.Body) != string(first.Body) {
		t.Errorf("retry after the first finished = %s", describe(replay))
	}
	if n := sh.count(t, `SELECT count(*) FROM orders`); n != 1 {
		t.Errorf("%d orders, want 1", n)
	}
}

// TestIdempotency_ReleasedAfterFailure: a checkout that fails frees its
// key, so the same key works once the buyer has fixed the cart.
func TestIdempotency_ReleasedAfterFailure(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-lepas", variant("LP-M", "M", 10000, 2))
	b := sh.buyer(t, "lepas")
	key := uuidx.NewV7()
	assertError(t, sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)), http.StatusConflict, "CART_EMPTY")
	sh.add(t, b, p.Variants["LP-M"], 2)
	mustExec(t, sh.db, `UPDATE product_variants SET stock = 1 WHERE id = $1`, p.Variants["LP-M"])
	assertCheckoutProblems(t, sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)), "too little stock")
	if n := sh.count(t, `SELECT count(*) FROM idempotency_keys`); n != 0 {
		t.Errorf("%d keys after two failures, want them released", n)
	}
	assertCart(t, sh.cartReq(t, http.MethodPatch, "/v1/cart/items/"+p.Variants["LP-M"], map[string]any{"quantity": 1}, b.Token, ""), "PATCH")
	resp := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID))
	assertOrderDetail(t, resp, http.StatusCreated, "same key after the fix")
	if resp.Header.Get("Idempotency-Replayed") != "" {
		t.Error("a fresh checkout after failures was marked replayed")
	}
}

// TestIdempotency_StaleClaim: a key whose request never finished (the
// process died) can be claimed again after 2 minutes, and a request that
// was taken over that way can neither store its answer under the key nor
// release it: it rolls back with 409 IDEMPOTENCY_IN_PROGRESS while the
// request that took over places the one order. A finished key past its 24
// hours is a new key again.
func TestIdempotency_StaleClaim(t *testing.T) {
	provider := &testShipping{}
	sh := newShop(t, nil, app.WithShippingProvider(provider))
	p := sh.product(t, "kaos-basi", variant("BS-M", "M", 10000, 10))
	m := p.Variants["BS-M"]
	b := sh.buyer(t, "basi")
	sh.add(t, b, m, 1)

	// A dead process's claim: no answer, three minutes old.
	dead := uuidx.NewV7()
	mustExec(t, sh.db, `INSERT INTO idempotency_keys (user_id, key, request_hash, claim_id, created_at, expires_at)
		VALUES ($1, $2, $3, $4, now() - interval '3 minutes', now() + interval '1 day')`,
		b.ID, dead, requestHash(b.AddressID, "jne", "REG", ""), uuidx.NewV7())
	assertOrderDetail(t, sh.checkout(t, b.Token, dead, checkoutBody(b.AddressID)), http.StatusCreated, "claim of a dead request's key")
	// A fresh claim without an answer is still in flight.
	live := uuidx.NewV7()
	mustExec(t, sh.db, `INSERT INTO idempotency_keys (user_id, key, request_hash, claim_id, created_at, expires_at)
		VALUES ($1, $2, $3, $4, now(), now() + interval '1 day')`, b.ID, live, requestHash(b.AddressID, "jne", "REG", ""), uuidx.NewV7())
	sh.add(t, b, m, 1)
	assertError(t, sh.checkout(t, b.Token, live, checkoutBody(b.AddressID)), http.StatusConflict, "IDEMPOTENCY_IN_PROGRESS")

	// A takes the key and stalls; it goes stale; B takes it over and
	// stalls too; A finishes first.
	key := uuidx.NewV7()
	run := func() chan response {
		done := make(chan response, 1)
		go func() {
			r, err := sh.tryCheckout(b.Token, key, checkoutBody(b.AddressID))
			if err != nil {
				r = response{Status: -1, Body: []byte(err.Error())}
			}
			done <- r
		}()
		return done
	}
	enteredA, releaseA := provider.holdNext()
	defer releaseA()
	doneA := run()
	waitFor(t, enteredA, "A's quote")
	claimA := queryStrings(t, sh.db, `SELECT claim_id::text FROM idempotency_keys WHERE user_id = $1 AND key = $2`, b.ID, key)
	mustExec(t, sh.db, `UPDATE idempotency_keys SET created_at = now() - interval '3 minutes' WHERE user_id = $1 AND key = $2`, b.ID, key)
	enteredB, releaseB := provider.holdNext()
	defer releaseB()
	doneB := run()
	waitFor(t, enteredB, "B's quote")
	claimB := queryStrings(t, sh.db, `SELECT claim_id::text FROM idempotency_keys WHERE user_id = $1 AND key = $2`, b.ID, key)
	if len(claimA) != 1 || len(claimB) != 1 || claimA[0] == claimB[0] {
		t.Fatalf("claims A %v, B %v: B must have taken the key over with a new claim", claimA, claimB)
	}

	releaseA()
	a := <-doneA
	assertError(t, a, http.StatusConflict, "IDEMPOTENCY_IN_PROGRESS")
	if n := sh.count(t, `SELECT count(*) FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND claim_id = $3
		AND response_status IS NULL`, b.ID, key, claimB[0]); n != 1 {
		t.Error("the taken-over request released or overwrote B's claim")
	}
	releaseB()
	bResp := <-doneB
	o := assertOrderDetail(t, bResp, http.StatusCreated, "B")
	if n := sh.count(t, `SELECT count(*) FROM orders WHERE user_id = $1`, b.ID); n != 2 {
		t.Errorf("%d orders, want the dead key's and B's", n)
	}
	if r := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID)); string(r.Body) != string(bResp.Body) {
		t.Errorf("replay = %s, want B's answer", describe(r))
	}

	// Past its 24 hours a finished key is claimed anew.
	mustExec(t, sh.db, `UPDATE idempotency_keys SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND key = $2`, b.ID, key)
	sh.add(t, b, m, 1)
	again := sh.checkout(t, b.Token, key, checkoutBody(b.AddressID))
	if fresh := assertOrderDetail(t, again, http.StatusCreated, "expired key"); fresh.ID == o.ID || again.Header.Get("Idempotency-Replayed") != "" {
		t.Errorf("an expired key replayed: %s", describe(again))
	}
	if s := sh.stock(t, m); s != 7 {
		t.Errorf("stock = %d, want 10 - 3 orders", s)
	}
}

// TestCleanupIdempotencyKeys_Command runs `api cleanup-idempotency-keys`
// for real: keys past their expiry go, finished or not; live ones stay.
func TestCleanupIdempotencyKeys_Command(t *testing.T) {
	sh := newShop(t, nil)
	b := sh.buyer(t, "bersih")
	insert := func(key, expires string, finished bool) {
		status, body := any(nil), any(nil)
		if finished {
			status, body = 201, `{"data":{}}`
		}
		mustExec(t, sh.db, `INSERT INTO idempotency_keys (user_id, key, request_hash, claim_id, response_status, response_body, created_at, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, now() - interval '2 days', now() + $7::interval)`,
			b.ID, key, requestHash(b.AddressID, "jne", "REG", ""), uuidx.NewV7(), status, body, expires)
	}
	insert("lama-selesai", "-1 hour", true)
	insert("lama-gantung", "-1 minute", false)
	insert("baru", "+23 hours", true)

	logs := runCommand(t, "cleanup-idempotency-keys")
	if !strings.Contains(logs, "deleted expired idempotency keys") || !strings.Contains(logs, "deleted=2") {
		t.Errorf("cleanup logged:\n%s", logs)
	}
	if got := queryStrings(t, sh.db, `SELECT key FROM idempotency_keys ORDER BY key`); strings.Join(got, ",") != "baru" {
		t.Errorf("keys left = %v, want only the live one", got)
	}
	if logs := runCommand(t, "cleanup-idempotency-keys"); !strings.Contains(logs, "deleted=0") {
		t.Errorf("a second cleanup logged:\n%s", logs)
	}
}
