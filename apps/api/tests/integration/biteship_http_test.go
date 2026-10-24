//go:build integration

package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// fakeBiteship is Biteship's rates API (POST /v1/rates/couriers) on an
// httptest server: the real shipping.Biteship client, with its timeout and
// circuit breaker, talks to it over HTTP. status is what it answers next
// (200 with two JNE services by default), delay how long it takes, and
// hijack makes it drop the connection (a transport error).
type fakeBiteship struct {
	*httptest.Server
	status atomic.Int64
	delay  atomic.Int64
	hijack atomic.Bool
	// done counts the requests it finished answering; entered gets a
	// value as each request arrives.
	done    atomic.Int64
	entered chan struct{}

	mu   sync.Mutex
	last map[string]any
	auth string
}

const fakeBiteshipKey = "biteship_test.fake-key"

func newFakeBiteship(t *testing.T) *fakeBiteship {
	t.Helper()
	f := &fakeBiteship{entered: make(chan struct{}, 64)}
	f.status.Store(http.StatusOK)
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeBiteship) serve(w http.ResponseWriter, r *http.Request) {
	defer f.done.Add(1)
	select {
	case f.entered <- struct{}{}:
	default:
	}
	var body map[string]any
	raw, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(raw, &body)
	f.mu.Lock()
	f.last, f.auth = body, r.Header.Get("Authorization")
	f.mu.Unlock()
	// Sleeps whatever happens to the caller: an upstream does not stop
	// working because one of GoShop's buyers hung up.
	time.Sleep(time.Duration(f.delay.Load()))
	if f.hijack.Load() {
		if conn, _, err := http.NewResponseController(w).Hijack(); err == nil {
			_ = conn.Close()
		}
		return
	}
	status := int(f.status.Load())
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if status != http.StatusOK {
		_, _ = io.WriteString(w, `{"success":false,"error":"fake refusal","code":40001001}`)
		return
	}
	_, _ = io.WriteString(w, `{"success":true,"pricing":[
		{"courier_code":"jne","courier_name":"JNE","courier_service_code":"yes","courier_service_name":"Yakin Esok Sampai","duration":"1 days","price":26000},
		{"courier_code":"jne","courier_name":"JNE","courier_service_code":"reg","courier_service_name":"Reguler","duration":"2 - 3 days","price":12000},
		{"courier_code":"anteraja","courier_name":"AnterAja","courier_service_code":"reg","courier_service_name":"Regular","duration":"2 days","price":9000}]}`)
}

// biteshipShop is a development server whose shipping provider is the real
// Biteship client pointed at f, with a buyer holding one unit in the cart.
func biteshipShop(t *testing.T, f *fakeBiteship) (*shop, buyer) {
	t.Helper()
	sh := newShop(t, map[string]string{"APP_SHIPPING_ORIGIN_POSTAL_CODE": "40111"},
		app.WithShippingProvider(shipping.NewBiteship(fakeBiteshipKey, f.URL, 5*time.Second)))
	p := sh.product(t, "kaos-biteship", variant("BS-M", "M", 50000, 10))
	b := sh.buyer(t, "biteship")
	sh.add(t, b, p.Variants["BS-M"], 2)
	return sh, b
}

// TestBiteship_Quotes: quotes, preview and checkout price through Biteship:
// the key goes as it is in Authorization, the postal codes as numbers and
// the cart as one item of its weight and value; only GoShop's couriers
// are kept, upper-cased and cheapest first, and the order's fee is
// Biteship's price.
func TestBiteship_Quotes(t *testing.T) {
	f := newFakeBiteship(t)
	sh, b := biteshipShop(t, f)

	q := assertQuotes(t, sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes?address_id="+b.AddressID, nil, b.Token))
	want := []quoteOut{
		{"jne", "JNE", "REG", "Reguler", moneyOf(12000), "2 - 3 days"},
		{"jne", "JNE", "YES", "Yakin Esok Sampai", moneyOf(26000), "1 days"},
	}
	if q.WeightGrams != 400 || asJSON(t, q.Quotes) != asJSON(t, want) {
		t.Errorf("quotes = %d g %s, want 400 g %s", q.WeightGrams, asJSON(t, q.Quotes), asJSON(t, want))
	}
	f.mu.Lock()
	last, auth := f.last, f.auth
	f.mu.Unlock()
	items, _ := last["items"].([]any)
	item, _ := func() (map[string]any, bool) {
		if len(items) != 1 {
			return nil, false
		}
		m, ok := items[0].(map[string]any)
		return m, ok
	}()
	if auth != fakeBiteshipKey || last["origin_postal_code"] != float64(40111) || last["destination_postal_code"] != float64(40111) ||
		last["couriers"] != "jne,jnt,sicepat" || item["weight"] != float64(400) || item["value"] != float64(100000) {
		t.Errorf("Biteship got Authorization %q and body %v", auth, last)
	}

	pv := assertPreview(t, sh.call(t, http.MethodPost, "/v1/checkout/preview", checkoutBody(b.AddressID), b.Token))
	if pv.Shipping == nil || pv.Totals.ShippingFee != moneyOf(12000) {
		t.Errorf("preview shipping %+v, fee %d", pv.Shipping, pv.Totals.ShippingFee.Amount)
	}
	o := assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusCreated, "checkout via Biteship")
	if o.Totals.ShippingFee != moneyOf(12000) {
		t.Errorf("order fee %d, want Biteship's 12000", o.Totals.ShippingFee.Amount)
	}
	assertNoErrorLog(t, sh.server)
}

// TestBiteship_Errors maps Biteship's answers: a refused parcel (400, 404,
// 422) is 422 SHIPPING_UNAVAILABLE (no courier serves the address;
// retrying does not help), while a Biteship that cannot be used (401,
// 403, 429, 5xx, a dropped connection) is 503 UPSTREAM_UNAVAILABLE.
// Checkout writes nothing either way and frees its key.
func TestBiteship_Errors(t *testing.T) {
	f := newFakeBiteship(t)
	sh, b := biteshipShop(t, f)
	routes := map[string]func() response{
		"quotes": func() response {
			return sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes?address_id="+b.AddressID, nil, b.Token)
		},
		"preview": func() response {
			return sh.call(t, http.MethodPost, "/v1/checkout/preview", checkoutBody(b.AddressID), b.Token)
		},
		"checkout": func() response { return sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)) },
	}
	cases := []struct {
		name   string
		status int // what Biteship answers; 0 drops the connection
		want   int
		code   string
	}{
		{"400 unknown postal code", http.StatusBadRequest, http.StatusUnprocessableEntity, "SHIPPING_UNAVAILABLE"},
		{"404", http.StatusNotFound, http.StatusUnprocessableEntity, "SHIPPING_UNAVAILABLE"},
		{"422", http.StatusUnprocessableEntity, http.StatusUnprocessableEntity, "SHIPPING_UNAVAILABLE"},
		{"401 bad key", http.StatusUnauthorized, http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE"},
		{"429", http.StatusTooManyRequests, http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE"},
		{"500", http.StatusInternalServerError, http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE"},
		{"dropped connection", 0, http.StatusServiceUnavailable, "UPSTREAM_UNAVAILABLE"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f.hijack.Store(tc.status == 0)
			f.status.Store(int64(max(tc.status, http.StatusOK)))
			for route, call := range routes {
				resp := call()
				assertError(t, resp, tc.want, tc.code)
				if resp.Status == http.StatusInternalServerError {
					t.Errorf("%s: 500", route)
				}
			}
			// Back to a working Biteship: three failures in a row are
			// below the breaker's five, and one success resets them.
			f.hijack.Store(false)
			f.status.Store(http.StatusOK)
			assertQuotes(t, routes["quotes"]())
		})
	}
	if n := sh.count(t, `SELECT count(*) FROM orders`) + sh.count(t, `SELECT count(*) FROM idempotency_keys`); n != 0 {
		t.Errorf("failed checkouts wrote %d orders and keys", n)
	}
}

// TestBiteship_ClientHangUpKeepsBreakerClosed is the B1 regression on the
// real server: eight buyers hang up while Biteship is still answering
// (each one cancels once its call has reached Biteship). The courier call
// goes on without them (context.WithoutCancel) and succeeds, so the
// circuit breaker, which opens after five failures in a row, stays closed:
// the next buyer is priced normally instead of getting 503.
func TestBiteship_ClientHangUpKeepsBreakerClosed(t *testing.T) {
	f := newFakeBiteship(t)
	sh, b := biteshipShop(t, f)
	f.delay.Store(int64(300 * time.Millisecond))
	const hangUps = 8
	for i := range hangUps {
		ctx, cancel := context.WithCancel(context.Background())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, sh.URL+"/v1/checkout/shipping-quotes?address_id="+b.AddressID, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+b.Token)
		answered := make(chan error, 1)
		go func() {
			resp, err := sh.client.Do(req)
			if err == nil {
				_ = resp.Body.Close()
				err = fmt.Errorf("got %d before hanging up", resp.StatusCode)
			} else {
				err = nil
			}
			answered <- err
		}()
		select {
		case <-f.entered: // the API is talking to Biteship now
		case <-time.After(10 * time.Second):
			t.Fatalf("hang-up %d: the API never called Biteship (an open breaker answers 503 without calling)", i)
		}
		cancel()
		if err := <-answered; err != nil {
			t.Fatalf("hang-up %d: %v; the breaker opened or the call ended with the client", i, err)
		}
	}
	deadline := time.Now().Add(15 * time.Second)
	for f.done.Load() < hangUps && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if n := f.done.Load(); n != hangUps {
		t.Fatalf("Biteship finished %d of %d calls", n, hangUps)
	}
	f.delay.Store(0)
	q := assertQuotes(t, sh.call(t, http.MethodGet, "/v1/checkout/shipping-quotes?address_id="+b.AddressID, nil, b.Token))
	if len(q.Quotes) != 2 {
		t.Errorf("quotes after the hang-ups = %+v", q.Quotes)
	}
	assertOrderDetail(t, sh.checkout(t, b.Token, uuidx.NewV7(), checkoutBody(b.AddressID)), http.StatusCreated, "checkout after the hang-ups")
}
