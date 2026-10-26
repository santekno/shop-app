package midtrans

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/payment"
)

// statusBody is a status answer for orderID signed with key.
func statusBody(key, orderID, code string) map[string]any {
	return map[string]any{
		"status_code": code, "status_message": "Success, transaction is found",
		"order_id": orderID, "transaction_id": "a1b2c3d4-0000-4000-8000-000000000001",
		"transaction_status": "capture", "fraud_status": "challenge", "payment_type": "credit_card",
		"gross_amount": "117000.00", "currency": "IDR",
		"signature_key": Signature(key, orderID, code, "117000.00"),
	}
}

// statusServer answers GET /v2/{id}/status with status and body (a JSON
// value or a raw string), recording the request URI and method.
func statusServer(t *testing.T, status int, body any) (*httptest.Server, *[]string) {
	t.Helper()
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.RequestURI+" "+r.Header.Get("Accept"))
		w.WriteHeader(status)
		if s, ok := body.(string); ok {
			_, _ = io.WriteString(w, s)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

func TestStatus_SignedAnswer(t *testing.T) {
	const orderID = "GS-20261101-7KQ2M9-K3D9QX"
	srv, seen := statusServer(t, http.StatusOK, statusBody(testServerKey, orderID, "201"))
	c := newTestClient("http://unused.invalid", srv.URL+"/")

	got, err := c.Status(context.Background(), orderID)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got, payment.TransactionStatus{
		OrderID: orderID, StatusCode: "201", TransactionID: "a1b2c3d4-0000-4000-8000-000000000001",
		TransactionStatus: "capture", FraudStatus: "challenge", PaymentType: "credit_card",
		GrossAmount: "117000.00",
	})
	testx.AssertEqual(t, len(*seen), 1)
	testx.AssertEqual(t, (*seen)[0], "GET /v2/"+orderID+"/status application/json")
}

func TestStatus_UpperCaseSignatureAccepted(t *testing.T) {
	body := statusBody(testServerKey, "GS-1", "200")
	body["signature_key"] = strings.ToUpper(body["signature_key"].(string))
	srv, _ := statusServer(t, http.StatusOK, body)
	c := newTestClient(srv.URL, srv.URL)
	got, err := c.Status(context.Background(), "GS-1")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.StatusCode, "200")
}

func TestStatus_OrderIDIsPathEscaped(t *testing.T) {
	const orderID = "GS-1/A B?x"
	srv, seen := statusServer(t, http.StatusOK, statusBody(testServerKey, orderID, "200"))
	c := newTestClient(srv.URL, srv.URL)
	got, err := c.Status(context.Background(), orderID)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.OrderID, orderID)
	testx.AssertEqual(t, (*seen)[0], "GET /v2/GS-1%2FA%20B%3Fx/status application/json")
}

func TestStatus_NotFound(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   any
	}{
		{name: "HTTP 404", status: http.StatusNotFound, body: `{"status_code":"404","status_message":"Transaction doesn't exist."}`},
		{name: "HTTP 404 without a body", status: http.StatusNotFound, body: ``},
		// The v2 status API answers 200 with the 404 in the body, unsigned.
		{name: "200 with status_code 404", status: http.StatusOK, body: map[string]any{
			"status_code": "404", "status_message": "Transaction doesn't exist.", "id": "x",
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, _ := statusServer(t, tt.status, tt.body)
			c := newTestClient(srv.URL, srv.URL)
			got, err := c.Status(context.Background(), "GS-404")
			testx.AssertTrue(t, errors.Is(err, payment.ErrTransactionNotFound), "err %v", err)
			testx.AssertFalse(t, errors.Is(err, payment.ErrGatewayUnavailable), "a missing transaction is not an outage")
			testx.AssertEqual(t, got, payment.TransactionStatus{})
		})
	}
}

// An answer that is not signed with the merchant's key for the asked
// order_id is not Midtrans' (ADR 0007: the status answer's signature is
// checked too).
func TestStatus_RefusesAnAnswerNotSignedForTheOrder(t *testing.T) {
	const orderID = "GS-1-ABC"
	wrongKey := statusBody("SB-Mid-server-attacker", orderID, "200")
	noSignature := statusBody(testServerKey, orderID, "200")
	delete(noSignature, "signature_key")
	tampered := statusBody(testServerKey, orderID, "200")
	tampered["gross_amount"] = "1.00" // the signature covers 117000.00
	tamperedCode := statusBody(testServerKey, orderID, "201")
	tamperedCode["status_code"] = "200"

	tests := []struct {
		name string
		body map[string]any
	}{
		{name: "signed with another key", body: wrongKey},
		{name: "no signature", body: noSignature},
		{name: "gross_amount changed", body: tampered},
		{name: "status_code changed", body: tamperedCode},
		{name: "another order, signed correctly for it", body: statusBody(testServerKey, "GS-2-OTHER", "200")},
		{name: "another order, signed for the asked one", body: func() map[string]any {
			b := statusBody(testServerKey, orderID, "200")
			b["order_id"] = "GS-2-OTHER"
			return b
		}()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, _ := statusServer(t, http.StatusOK, tt.body)
			c := newTestClient(srv.URL, srv.URL)
			got, err := c.Status(context.Background(), orderID)
			testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
			testx.AssertFalse(t, errors.Is(err, payment.ErrTransactionNotFound), "err %v", err)
			testx.AssertContains(t, err.Error(), "not signed for "+orderID)
			testx.AssertEqual(t, got, payment.TransactionStatus{})
		})
	}
}

func TestStatus_UpstreamFailures(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   any
	}{
		{name: "500", status: http.StatusInternalServerError, body: `{"status_code":"500"}`},
		{name: "401", status: http.StatusUnauthorized, body: `{"status_code":"401"}`},
		{name: "201 is not 200", status: http.StatusCreated, body: statusBody(testServerKey, "GS-1", "200")},
		{name: "not JSON", status: http.StatusOK, body: `not json`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, _ := statusServer(t, tt.status, tt.body)
			c := newTestClient(srv.URL, srv.URL)
			_, err := c.Status(context.Background(), "GS-1")
			testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
			testx.AssertFalse(t, errors.Is(err, payment.ErrTransactionNotFound), "err %v", err)
		})
	}
}

func TestStatus_RefusalIsLoggedWithItsPath(t *testing.T) {
	srv, _ := statusServer(t, http.StatusUnauthorized, `{"status_message":"`+testServerKey+`"}`)
	logger, logs := newLogger()
	c := newTestClient(srv.URL, srv.URL, WithLogger(logger))
	_, err := c.Status(context.Background(), "GS-7")
	testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
	testx.AssertContains(t, logs.String(), `"path":"/v2/GS-7/status"`)
	testx.AssertContains(t, logs.String(), `"status":401`)
	testx.AssertFalse(t, strings.Contains(logs.String(), testServerKey), "log leaks the key: %s", logs.String())
	testx.AssertFalse(t, strings.Contains(err.Error(), testServerKey), "error leaks the key: %v", err)
}

func TestStatus_CallerCancelDoesNotCancelTheCall(t *testing.T) {
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n.Add(1)
		time.Sleep(50 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(statusBody(testServerKey, "GS-5", "200"))
	}))
	t.Cleanup(srv.Close)
	c := newTestClient(srv.URL, srv.URL)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	got, err := c.Status(ctx, "GS-5")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.TransactionStatus, "capture")

	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	time.AfterFunc(10*time.Millisecond, cancel2)
	got, err = c.Status(ctx2, "GS-5")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.OrderID, "GS-5")
	testx.AssertEqual(t, n.Load(), int32(2))
}

func TestStatus_SlowUpstreamTimesOut(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(release) })

	c := New(testServerKey, testClientKey, 100*time.Millisecond, WithBaseURLs(srv.URL, srv.URL))
	start := time.Now()
	_, err := c.Status(context.Background(), "GS-1")
	elapsed := time.Since(start)
	testx.AssertTrue(t, errors.Is(err, payment.ErrGatewayUnavailable), "err %v", err)
	testx.AssertTrue(t, elapsed < 2*time.Second, "took %s, the timeout is 100ms", elapsed)
}
