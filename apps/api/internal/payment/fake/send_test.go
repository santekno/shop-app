package fake

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

func TestSend_PostsTheNotificationAsJSON(t *testing.T) {
	var method, contentType, path string
	var body map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, contentType, path = r.Method, r.Header.Get("Content-Type"), r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, `{"data":{"status":"ok"}}`)
	}))
	t.Cleanup(srv.Close)

	n := Notification("GS-1", "200", "117000.00")
	status, answer, err := Send(context.Background(), srv.URL+"/v1/payments/midtrans/notification", n)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, status, http.StatusAccepted)
	testx.AssertEqual(t, answer, `{"data":{"status":"ok"}}`)
	testx.AssertEqual(t, method, http.MethodPost)
	testx.AssertEqual(t, contentType, "application/json")
	testx.AssertEqual(t, path, "/v1/payments/midtrans/notification")
	testx.AssertEqual(t, len(body), 4, "body %v", body)
	testx.AssertEqual(t, body["order_id"], "GS-1")
	testx.AssertEqual(t, body["status_code"], "200")
	testx.AssertEqual(t, body["gross_amount"], "117000.00")
	testx.AssertEqual(t, body["signature_key"], n.SignatureKey)
}

func TestSend_ErrorAnswerIsReturned(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"error":{"code":"INVALID_SIGNATURE"}}`)
	}))
	t.Cleanup(srv.Close)
	status, answer, err := Send(context.Background(), srv.URL, Notification("GS-1", "200", "1.00"))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, status, http.StatusForbidden)
	testx.AssertContains(t, answer, "INVALID_SIGNATURE")
}

func TestSend_AnswerIsCappedAt64KiB(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", 100<<10))
	}))
	t.Cleanup(srv.Close)
	status, answer, err := Send(context.Background(), srv.URL, Notification("GS-1", "200", "1.00"))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, status, http.StatusOK)
	testx.AssertEqual(t, len(answer), 64<<10)
}

func TestSend_Errors(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	closed := srv.URL
	srv.Close()

	status, answer, err := Send(context.Background(), closed, Notification("GS-1", "200", "1.00"))
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "fake: send notification")
	testx.AssertEqual(t, status, 0)
	testx.AssertEqual(t, answer, "")

	_, _, err = Send(context.Background(), "http://bad host/", Notification("GS-1", "200", "1.00"))
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "fake: build notification")
}
