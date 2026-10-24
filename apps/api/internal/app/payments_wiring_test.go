package app_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/storage"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// stubGateway is a payment gateway that refuses every signature.
type stubGateway struct{}

func (stubGateway) Name() string      { return "stub" }
func (stubGateway) ClientKey() string { return "stub-client-key" }
func (stubGateway) CreateTransaction(context.Context, payment.TransactionRequest) (payment.Transaction, error) {
	return payment.Transaction{}, errors.New("not used")
}

func (stubGateway) Status(context.Context, string) (payment.TransactionStatus, error) {
	return payment.TransactionStatus{}, errors.New("not used")
}
func (stubGateway) VerifySignature(string, string, string, string) bool { return false }

// stubStore is an image bucket that is never reached in these tests.
type stubStore struct{}

func (stubStore) PresignPut(context.Context, string, string, int64, time.Duration) (storage.PresignedUpload, error) {
	return storage.PresignedUpload{}, errors.New("not used")
}

func (stubStore) Stat(context.Context, string) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, errors.New("not used")
}

func (stubStore) Get(context.Context, string) (io.ReadCloser, error) {
	return nil, errors.New("not used")
}
func (stubStore) Delete(context.Context, string) error { return nil }
func (stubStore) Put(context.Context, string, string, io.Reader) (string, error) {
	return "", errors.New("not used")
}
func (stubStore) PublicURL(key string) string { return "https://img.test/" + key }

// notification is a well-formed Midtrans notification with a wrong
// signature.
const notification = `{"order_id":"GS-20261101-7KQ2M9-K3D9QX","status_code":"200","gross_amount":"117000.00","signature_key":"0000"}`

// New takes payments through the gateway WithPaymentGateway gives, else
// the one the configuration picks, else none (503 PAYMENTS_DISABLED).
func TestApp_PaymentGateway(t *testing.T) {
	tests := []struct {
		name     string
		payment  config.Payment
		opts     []app.Option
		wantLog  string
		status   int
		wantCode string
	}{
		// The answer with payments off (503 PAYMENTS_DISABLED) is
		// checked in zz_bug_disabled_503_test.go: it is 500 today.
		{name: "no key: payments off", wantLog: `"level":"WARN","msg":"payments are off: MIDTRANS_SERVER_KEY is not set"`},
		{
			name:    "a sandbox key: Midtrans",
			payment: config.Payment{Provider: config.PaymentMidtrans, MidtransServerKey: "SB-Mid-server-test", MidtransClientKey: "SB-Mid-client-test", Timeout: time.Second},
			wantLog: `"msg":"payments","provider":"midtrans"`, status: http.StatusForbidden, wantCode: payment.CodeInvalidSignature,
		},
		{
			name:    "the fake provider",
			payment: config.Payment{Provider: config.PaymentFake},
			wantLog: `"msg":"payments","provider":"fake"`, status: http.StatusForbidden, wantCode: payment.CodeInvalidSignature,
		},
		{
			name: "WithPaymentGateway wins", payment: config.Payment{Provider: config.PaymentFake},
			opts:    []app.Option{app.WithPaymentGateway(stubGateway{})},
			wantLog: `"msg":"payments","provider":"stub"`, status: http.StatusForbidden, wantCode: payment.CodeInvalidSignature,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			cfg := testConfig(config.EnvProduction)
			cfg.Payment = tt.payment
			h := app.New(cfg, logx.New(logx.WithOutput(&logs), logx.WithFormat("json")), (&fakeDB{}).open(t), testRedis(t), tt.opts...).Handler()

			rec, code := call(t, h, http.MethodPost, "/v1/payments/midtrans/notification", "", notification)

			if tt.status == 0 {
				// No gateway checked the signature.
				testx.AssertNotEqual(t, rec.Code, http.StatusForbidden, "body %s", rec.Body.String())
				testx.AssertNotEqual(t, code, payment.CodeInvalidSignature)
				testx.AssertFalse(t, strings.Contains(logs.String(), `"msg":"payments","provider"`), "logs: %s", logs.String())
			} else {
				testx.AssertEqual(t, rec.Code, tt.status, "body %s logs %s", rec.Body.String(), logs.String())
				testx.AssertEqual(t, code, tt.wantCode)
			}
			testx.AssertContains(t, logs.String(), tt.wantLog)
			testx.AssertFalse(t, strings.Contains(logs.String(), "SB-Mid-server-test"), "the server key is never logged")
		})
	}
}

// New serves image uploads with the bucket WithObjectStore gives, else the
// one the configuration names, else none (503 STORAGE_DISABLED).
func TestApp_ObjectStore(t *testing.T) {
	const upload = `{"content_type":"image/jpeg","size_bytes":1024}`
	valid := config.Storage{
		Endpoint: "http://127.0.0.1:1", Region: "us-east-1", Bucket: "goshop-images", AccessKey: "test-access", SecretKey: "test-secret",
	}
	broken := valid
	broken.Endpoint = "not a url"
	tests := []struct {
		name     string
		storage  config.Storage
		opts     []app.Option
		wantLog  string
		disabled bool
	}{
		{name: "no endpoint: uploads off", wantLog: `"level":"WARN","msg":"image uploads are off: S3_ENDPOINT is not set"`, disabled: true},
		{name: "a bucket", storage: valid},
		{name: "WithObjectStore", opts: []app.Option{app.WithObjectStore(stubStore{})}},
		{name: "a client that cannot be built: uploads off", storage: broken, wantLog: `"level":"ERROR","msg":"image storage is off"`, disabled: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			cfg := testConfig(config.EnvProduction)
			cfg.Storage = tt.storage
			h := app.New(cfg, logx.New(logx.WithOutput(&logs), logx.WithFormat("json")), (&fakeDB{}).open(t), testRedis(t),
				append(tt.opts, app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}}))...).Handler()

			rec, code := call(t, h, http.MethodPost, "/v1/admin/products/0190c8a0-0000-7000-8000-0000000000c1/images/uploads",
				bearer(t, user.RoleSeller, "s1"), upload)

			if tt.disabled {
				// The 503 STORAGE_DISABLED itself is checked in
				// zz_bug_disabled_503_test.go: it is 500 today. Here: no
				// bucket was asked to sign anything.
				testx.AssertNotEqual(t, rec.Code, http.StatusCreated, "body %s", rec.Body.String())
				testx.AssertContains(t, logs.String(), "image uploads are off")
				testx.AssertFalse(t, strings.Contains(logs.String(), `"error":"start upload: `), "the image service ran: %s", logs.String())
			} else {
				testx.AssertNotEqual(t, rec.Code, http.StatusServiceUnavailable, "body %s", rec.Body.String())
				testx.AssertNotEqual(t, code, "STORAGE_DISABLED")
				// The image service ran: the fake database has no
				// transactions, which is where it stops.
				testx.AssertContains(t, logs.String(), `"error":"start upload: begin transaction: `)
				testx.AssertFalse(t, strings.Contains(logs.String(), "image uploads are off"), "logs: %s", logs.String())
			}
			if tt.wantLog != "" {
				testx.AssertContains(t, logs.String(), tt.wantLog)
			}
			testx.AssertFalse(t, strings.Contains(logs.String(), "test-secret"), "the secret key is never logged")
		})
	}
}
