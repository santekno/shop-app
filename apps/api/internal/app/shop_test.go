package app_test

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

type namedProvider struct{ shipping.Static }

func (namedProvider) Name() string { return "fixed-for-test" }

// New logs which provider prices shipping: the one WithShippingProvider
// gives, otherwise the one the configuration picks.
func TestApp_ShippingProvider(t *testing.T) {
	tests := []struct {
		name string
		key  string
		opts []app.Option
		want string
	}{
		{name: "no key", want: `"provider":"static"`},
		{name: "a Biteship key", key: "biteship_test.key", want: `"provider":"biteship"`}, // #nosec G101 -- a test value
		{name: "WithShippingProvider wins", key: "biteship_test.key", opts: []app.Option{app.WithShippingProvider(namedProvider{})}, want: `"provider":"fixed-for-test"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			cfg := testConfig(config.EnvProduction)
			cfg.Shipping = config.Shipping{BiteshipAPIKey: tt.key, OriginPostalCode: "40115"}
			app.New(cfg, logx.New(logx.WithOutput(&logs), logx.WithFormat("json")), (&fakeDB{}).open(t), testRedis(t), tt.opts...)
			testx.AssertContains(t, logs.String(), `"msg":"shipping fees"`)
			testx.AssertContains(t, logs.String(), tt.want)
			testx.AssertFalse(t, strings.Contains(logs.String(), "biteship_test.key"), "the key is never logged")
		})
	}
}

// The cart serves guests and users; checkout and orders need a user; the
// order queue needs staff.
func TestApp_ShopRoutes(t *testing.T) {
	h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
		app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}})).Handler()
	buyer, seller := bearer(t, user.RoleBuyer, "s1"), bearer(t, user.RoleSeller, "s1")
	tests := []struct {
		name, method, path, auth, body string
		status                         int
		code                           string
	}{
		{name: "a guest's empty cart", method: http.MethodGet, path: "/v1/cart", status: http.StatusOK},
		{name: "a user's empty cart", method: http.MethodGet, path: "/v1/cart", auth: buyer, status: http.StatusOK},
		{name: "a broken token on the cart", method: http.MethodGet, path: "/v1/cart", auth: "Bearer nope", status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "merge needs a user", method: http.MethodPost, path: "/v1/cart/merge", status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "merge needs the token", method: http.MethodPost, path: "/v1/cart/merge", auth: buyer, status: http.StatusBadRequest, code: "VALIDATION_FAILED"},
		{name: "checkout needs a user", method: http.MethodPost, path: "/v1/checkout", body: "{}", status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "checkout needs a key", method: http.MethodPost, path: "/v1/checkout", auth: buyer, body: "{}", status: http.StatusBadRequest, code: "IDEMPOTENCY_KEY_REQUIRED"},
		{name: "preview of an empty cart", method: http.MethodPost, path: "/v1/checkout/preview", auth: buyer, body: "{}", status: http.StatusConflict, code: "CART_EMPTY"},
		{name: "orders need a user", method: http.MethodGet, path: "/v1/orders", status: http.StatusUnauthorized, code: "UNAUTHORIZED"},
		{name: "a buyer's history", method: http.MethodGet, path: "/v1/orders", auth: buyer, status: http.StatusOK},
		{name: "the queue is not for buyers", method: http.MethodGet, path: "/v1/admin/orders", auth: buyer, status: http.StatusForbidden, code: "FORBIDDEN"},
		{name: "the seller's queue", method: http.MethodGet, path: "/v1/admin/orders", auth: seller, status: http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, code := call(t, h, tt.method, tt.path, tt.auth, tt.body)
			testx.AssertEqual(t, rec.Code, tt.status, "body %s", rec.Body.String())
			testx.AssertEqual(t, code, tt.code)
		})
	}
}

// The one-shot jobs open the database like serve does, and stop without it.
func TestRun_JobsNeedTheDatabase(t *testing.T) {
	for _, job := range []string{"expire-orders", "cleanup-idempotency-keys", "publish-events"} {
		t.Run(job, func(t *testing.T) {
			setEnv(t, map[string]string{"APP_ENV": "production", "DATABASE_URL": closedDatabaseURL(t), "BITESHIP_API_KEY": ""})
			var out syncBuffer
			err := app.Run(context.Background(), []string{job}, &out)
			if err == nil {
				t.Fatal("Run: want error, got nil")
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "err = %v", err)
			testx.AssertFalse(t, strings.Contains(err.Error(), "user:pass"), "error repeats the URL: %v", err)
			testx.AssertFalse(t, strings.Contains(out.String(), "api listening"), "a job never serves")
		})
	}
	t.Run("a job with an extra argument is unknown", func(t *testing.T) {
		setEnv(t, map[string]string{"APP_ENV": "production", "BITESHIP_API_KEY": ""})
		err := app.Run(context.Background(), []string{"expire-orders", "now"}, &syncBuffer{})
		testx.AssertError(t, err)
		testx.AssertContains(t, err.Error(), `unknown arguments ["expire-orders" "now"]`)
	})
}

// Without a Biteship key the fixed table prices shipping. That is allowed,
// but outside development it is easy to deploy by mistake, so it warns.
func TestApp_WarnsWithoutABiteshipKeyOutsideDevelopment(t *testing.T) {
	const warning = `"level":"WARN","msg":"BITESHIP_API_KEY is empty: shipping fees come from the fixed rate table, not from the couriers"`
	tests := []struct {
		name, env, key string
		warns          bool
	}{
		{name: "production without a key", env: config.EnvProduction, warns: true},
		{name: "staging without a key", env: config.EnvStaging, warns: true},
		{name: "development without a key", env: config.EnvDevelopment, warns: false},
		{name: "production with a key", env: config.EnvProduction, key: "biteship_test.key", warns: false}, // #nosec G101 -- a test value
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			cfg := testConfig(tt.env)
			cfg.Shipping = config.Shipping{BiteshipAPIKey: tt.key, OriginPostalCode: "40115"}
			app.New(cfg, logx.New(logx.WithOutput(&logs), logx.WithFormat("json")), (&fakeDB{}).open(t), testRedis(t))
			testx.AssertEqual(t, strings.Contains(logs.String(), warning), tt.warns, "logs: %s", logs.String())
		})
	}
}

// New wires the per-buyer checkout limits into the order routes, through
// the limiter it was given.
func TestApp_CheckoutRoutesAreLimitedPerBuyer(t *testing.T) {
	for path, limit := range map[string]string{
		"POST /v1/checkout/preview": "checkout-preview-user",
		"GET /v1/checkout/shipping-quotes?address_id=0190c8a0-0000-7000-8000-0000000000e1": "shipping-quotes-user",
		"POST /v1/checkout": "checkout-user",
	} {
		t.Run(limit, func(t *testing.T) {
			limiter := &refuseAll{}
			h := app.New(testConfig(config.EnvProduction), logx.Noop(), (&fakeDB{}).open(t), testRedis(t),
				app.WithRateLimiter(limiter), app.WithSessionRevocations(&memRevocations{revoked: map[string]bool{}})).Handler()
			method, target, _ := strings.Cut(path, " ")
			rec, code := call(t, h, method, target, bearer(t, user.RoleBuyer, "s1"), "{}")
			testx.AssertEqual(t, rec.Code, http.StatusTooManyRequests, "body %s", rec.Body.String())
			testx.AssertEqual(t, code, "RATE_LIMITED")
			testx.AssertEqual(t, strings.Join(limiter.seen, ","), limit)
		})
	}
}
