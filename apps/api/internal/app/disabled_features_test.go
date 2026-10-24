package app_test

import (
	"net/http"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// With MIDTRANS_SERVER_KEY or S3_ENDPOINT empty, the wired API answers the
// payment and image routes with 503 PAYMENTS_DISABLED / STORAGE_DISABLED
// (ADR 0007, api/openapi.yaml), not 500 INTERNAL_ERROR: the end-to-end view
// through app.New of the handler tests in internal/payment and
// internal/product.
func TestApp_DisabledFeaturesAnswer503(t *testing.T) {
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}})).Handler()
	tests := []struct {
		name, path, auth, body, code string
	}{
		{name: "payments off", path: "/v1/payments/midtrans/notification", body: notification, code: "PAYMENTS_DISABLED"},
		{
			name: "uploads off", path: "/v1/admin/products/0190c8a0-0000-7000-8000-0000000000c1/images/uploads",
			auth: bearer(t, user.RoleSeller, "s1"), body: `{"content_type":"image/jpeg","size_bytes":1024}`, code: "STORAGE_DISABLED",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, code := call(t, h, http.MethodPost, tt.path, tt.auth, tt.body)
			testx.AssertEqual(t, rec.Code, http.StatusServiceUnavailable, "body %s", rec.Body.String())
			testx.AssertEqual(t, code, tt.code)
		})
	}
}
