package midtrans

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/payment"
)

// snapRecord is what the Snap test server saw of one request.
type snapRecord struct {
	method, path, auth, contentType, accept string
	body                                    map[string]any
	user, pass                              string
	basicOK                                 bool
}

// snapServer answers every request with status and body, recording it.
func snapServer(t *testing.T, status int, body string) (*httptest.Server, *[]snapRecord) {
	t.Helper()
	var got []snapRecord
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		dec := json.NewDecoder(strings.NewReader(string(raw)))
		dec.UseNumber()
		var m map[string]any
		_ = dec.Decode(&m)
		rec := snapRecord{
			method: r.Method, path: r.URL.Path, auth: r.Header.Get("Authorization"),
			contentType: r.Header.Get("Content-Type"), accept: r.Header.Get("Accept"), body: m,
		}
		rec.user, rec.pass, rec.basicOK = r.BasicAuth()
		got = append(got, rec)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func snapRequest1() payment.TransactionRequest {
	return payment.TransactionRequest{
		OrderID: "GS-20261101-7KQ2M9-K3D9QX", Amount: 117000,
		Start: time.Date(2026, 10, 24, 3, 4, 5, 0, time.UTC), Minutes: 1438,
	}
}

func TestClient_NameAndClientKey(t *testing.T) {
	c := New(testServerKey, testClientKey, time.Second)
	testx.AssertEqual(t, c.Name(), "midtrans")
	testx.AssertEqual(t, c.ClientKey(), testClientKey)
	testx.AssertEqual(t, c.snapURL, SandboxSnapURL)
	testx.AssertEqual(t, c.apiURL, SandboxAPIURL)
	testx.AssertEqual(t, SandboxSnapURL, "https://app.sandbox.midtrans.com")
	testx.AssertEqual(t, SandboxAPIURL, "https://api.sandbox.midtrans.com")
	var _ payment.Gateway = c
}

func TestCreateTransaction_Success(t *testing.T) {
	srv, got := snapServer(t, http.StatusCreated,
		`{"token":"snap-token-1","redirect_url":"https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-1"}`)
	// A trailing slash on the base URL is trimmed.
	c := newTestClient(srv.URL+"/", "http://unused.invalid")

	tx, err := c.CreateTransaction(context.Background(), snapRequest1())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, tx.Token, "snap-token-1")
	testx.AssertEqual(t, tx.RedirectURL, "https://app.sandbox.midtrans.com/snap/v4/redirection/snap-token-1")

	if len(*got) != 1 {
		t.Fatalf("want 1 request, got %d", len(*got))
	}
	r := (*got)[0]
	testx.AssertEqual(t, r.method, http.MethodPost)
	testx.AssertEqual(t, r.path, "/snap/v1/transactions")
	testx.AssertEqual(t, r.auth, "Basic "+base64.StdEncoding.EncodeToString([]byte(testServerKey+":")))
	testx.AssertTrue(t, r.basicOK, "HTTP Basic")
	testx.AssertEqual(t, r.user, testServerKey)
	testx.AssertEqual(t, r.pass, "")
	testx.AssertEqual(t, r.contentType, "application/json")
	testx.AssertEqual(t, r.accept, "application/json")

	// Only the transaction details and the expiry are sent.
	testx.AssertEqual(t, len(r.body), 2, "body %v", r.body)
	details, _ := r.body["transaction_details"].(map[string]any)
	testx.AssertEqual(t, details["order_id"], any("GS-20261101-7KQ2M9-K3D9QX"))
	// gross_amount is a JSON integer, not a string or a decimal.
	testx.AssertEqual(t, details["gross_amount"], any(json.Number("117000")))
	expiry, _ := r.body["expiry"].(map[string]any)
	// 03:04:05 UTC is 10:04:05 in WIB.
	testx.AssertEqual(t, expiry["start_time"], any("2026-10-24 10:04:05 +0700"))
	testx.AssertEqual(t, expiry["unit"], any("minute"))
	testx.AssertEqual(t, expiry["duration"], any(json.Number("1438")))
}

func TestCreateTransaction_StartTimeIsWIBWhateverTheZone(t *testing.T) {
	srv, got := snapServer(t, http.StatusCreated, `{"token":"t","redirect_url":"https://r"}`)
	c := newTestClient(srv.URL, srv.URL)
	req := snapRequest1()
	// 23:30 on the 24th at UTC-5 is 11:30 on the 25th in WIB.
	req.Start = time.Date(2026, 10, 24, 23, 30, 0, 0, time.FixedZone("EST", -5*60*60))
	_, err := c.CreateTransaction(context.Background(), req)
	testx.AssertNoError(t, err)
	expiry, _ := (*got)[0].body["expiry"].(map[string]any)
	testx.AssertEqual(t, expiry["start_time"], any("2026-10-25 11:30:00 +0700"))
}

func TestCreateTransaction_BadAnswers(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "201 without a token", status: http.StatusCreated, body: `{"redirect_url":"https://r"}`},
		{name: "201 without a redirect_url", status: http.StatusCreated, body: `{"token":"t"}`},
		{name: "201 empty object", status: http.StatusCreated, body: `{}`},
		{name: "201 not JSON", status: http.StatusCreated, body: `<html>oops</html>`},
		{name: "201 empty body", status: http.StatusCreated, body: ``},
		{name: "200 is not 201", status: http.StatusOK, body: `{"token":"t","redirect_url":"https://r"}`},
		{name: "500", status: http.StatusInternalServerError, body: `{"error_messages":["down"]}`},
		{name: "503", status: http.StatusServiceUnavailable, body: ``},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, _ := snapServer(t, tt.status, tt.body)
			logger, logs := newLogger()
			c := newTestClient(srv.URL, srv.URL, WithLogger(logger))

			tx, err := c.CreateTransaction(context.Background(), snapRequest1())
			testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
			testx.AssertEqual(t, tx, payment.Transaction{})
			// Only a 4xx is logged as a refusal.
			testx.AssertFalse(t, strings.Contains(logs.String(), "midtrans refused a request"), "logs %s", logs.String())
		})
	}
}

func TestCreateTransaction_RefusalIsLoggedWithoutSecrets(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			// The upstream echoes the key it was sent, as a broken proxy might.
			srv, _ := snapServer(t, status, `{"error_messages":["Access denied for `+testServerKey+` secret-body-marker"]}`)
			logger, logs := newLogger()
			c := newTestClient(srv.URL, srv.URL, WithLogger(logger))

			_, err := c.CreateTransaction(context.Background(), snapRequest1())
			testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
			testx.AssertContains(t, err.Error(), "midtrans answered "+strconv.Itoa(status))
			for _, leak := range []string{testServerKey, "secret-body-marker", "error_messages",
				base64.StdEncoding.EncodeToString([]byte(testServerKey + ":"))} {
				testx.AssertFalse(t, strings.Contains(err.Error(), leak), "error leaks %q: %v", leak, err)
				testx.AssertFalse(t, strings.Contains(logs.String(), leak), "log leaks %q: %s", leak, logs.String())
			}

			var warn map[string]any
			for _, l := range logs.lines(t) {
				if l["msg"] == "midtrans refused a request" {
					warn = l
				}
			}
			if warn == nil {
				t.Fatalf("no refusal logged: %s", logs.String())
			}
			testx.AssertEqual(t, warn["level"], any("WARN"))
			testx.AssertEqual(t, warn["status"], any(float64(status)))
			testx.AssertEqual(t, warn["path"], any("/snap/v1/transactions"))
		})
	}
}

func TestCreateTransaction_RefusalWithoutLogger(t *testing.T) {
	srv, _ := snapServer(t, http.StatusUnauthorized, `{}`)
	c := newTestClient(srv.URL, srv.URL)
	_, err := c.CreateTransaction(context.Background(), snapRequest1())
	testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
}

func TestCreateTransaction_Unreachable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	c := newTestClient(url, url)
	_, err := c.CreateTransaction(context.Background(), snapRequest1())
	testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
	testx.AssertContains(t, err.Error(), "midtrans")
}

func TestCreateTransaction_BadBaseURL(t *testing.T) {
	c := New(testServerKey, testClientKey, time.Second, WithBaseURLs("http://bad host", "http://bad host"))
	_, err := c.CreateTransaction(context.Background(), snapRequest1())
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "midtrans: build request")
	_, err = c.Status(context.Background(), "GS-1")
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "midtrans: build request")
}

// delayedSnap answers 201 with a token after delay, counting requests.
func delayedSnap(t *testing.T, delay time.Duration) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n.Add(1)
		time.Sleep(delay)
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"token":"tok","redirect_url":"https://r"}`)
	}))
	t.Cleanup(srv.Close)
	return srv, &n
}

// A buyer hanging up does not cancel the call to Midtrans: the request
// runs to its answer (context.WithoutCancel in do).
func TestCreateTransaction_CallerCancelDoesNotCancelTheCall(t *testing.T) {
	srv, n := delayedSnap(t, 50*time.Millisecond)
	c := newTestClient(srv.URL, srv.URL)

	t.Run("already cancelled", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		tx, err := c.CreateTransaction(ctx, snapRequest1())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, tx.Token, "tok")
	})
	t.Run("cancelled mid-call", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		time.AfterFunc(10*time.Millisecond, cancel)
		defer cancel()
		tx, err := c.CreateTransaction(ctx, snapRequest1())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, tx.Token, "tok")
	})
	t.Run("deadline already passed", func(t *testing.T) {
		ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		defer cancel()
		tx, err := c.CreateTransaction(ctx, snapRequest1())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, tx.Token, "tok")
	})
	testx.AssertEqual(t, n.Load(), int32(3))
}

// Callers hanging up must not trip httpx's circuit breaker (5 consecutive
// failures in sdk v0.2.0): after more cancelled calls than that, a normal
// call still reaches Midtrans.
func TestCreateTransaction_CancelledCallersDoNotTripTheBreaker(t *testing.T) {
	srv, n := delayedSnap(t, 0)
	c := newTestClient(srv.URL, srv.URL)

	const cancelled = 8 // > httpx.DefaultBreakerThreshold (5)
	for i := range cancelled {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := c.CreateTransaction(ctx, snapRequest1())
		testx.AssertNoError(t, err, "cancelled call %d", i)
	}
	tx, err := c.CreateTransaction(context.Background(), snapRequest1())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, tx.Token, "tok")
	testx.AssertEqual(t, n.Load(), int32(cancelled+1))
}

// The client's own timeout still bounds a call.
func TestCreateTransaction_SlowUpstreamTimesOut(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(release) })

	c := New(testServerKey, testClientKey, 100*time.Millisecond, WithBaseURLs(srv.URL, srv.URL))
	start := time.Now()
	_, err := c.CreateTransaction(context.Background(), snapRequest1())
	elapsed := time.Since(start)
	testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
	testx.AssertTrue(t, elapsed >= 100*time.Millisecond, "gave up after %s, before the timeout", elapsed)
	testx.AssertTrue(t, elapsed < 2*time.Second, "took %s, the timeout is 100ms", elapsed)
}
