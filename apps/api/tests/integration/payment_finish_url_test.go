//go:build integration

package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
)

// TestPay_SnapFinishFromAppWebURL (Bab 11 artikel 04): APP_WEB_URL, read by
// the real configuration (a trailing slash dropped), becomes Snap's
// callbacks.finish, <storefront>/pembayaran/selesai, in the request the
// Midtrans client sends at the HTTP boundary; nothing else about the
// transaction changes. (Without APP_WEB_URL there is no callbacks key:
// TestPay_ThroughMidtransSnap.) app.PaymentGateway's own wiring of
// FinishURL is covered by the unit tests: its Midtrans client cannot be
// pointed at a fake Snap.
func TestPay_SnapFinishFromAppWebURL(t *testing.T) {
	const webURL = "http://localhost:25173/"
	// config.Load as the server reads it; newShop then replaces the
	// placeholders with the test's own database and Redis.
	for k, v := range map[string]string{
		"APP_ENV": config.EnvDevelopment, "APP_WEB_URL": webURL, "JWT_SECRET": testJWTSecret,
		"DATABASE_URL": "postgres://goshop@localhost/unused?sslmode=disable", "REDIS_URL": "redis://localhost:1/0",
	} {
		t.Setenv(k, v)
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	const finish = "http://localhost:25173/pembayaran/selesai"
	if cfg.WebURL != "http://localhost:25173" || cfg.Payment.FinishURL != finish {
		t.Fatalf("APP_WEB_URL %q gave WebURL %q and FinishURL %q, want %q", webURL, cfg.WebURL, cfg.Payment.FinishURL, finish)
	}

	mt := newFakeMidtrans(t)
	gw := midtrans.New(sandboxServerKey, sandboxClientKey, 5*time.Second,
		midtrans.WithBaseURLs(mt.srv.URL, mt.srv.URL), midtrans.WithFinishURL(cfg.Payment.FinishURL))
	sh := newShop(t, map[string]string{"APP_WEB_URL": webURL}, app.WithPaymentGateway(gw))
	p := sh.product(t, "kaos-selesai", variant("SL-M", "M", 55000, 10))
	b := sh.buyer(t, "selesai")
	o := sh.order(t, b, line{p.Variants["SL-M"], 1})

	pay := assertPaymentSession(t, sh.pay(t, b.Token, o.ID), http.StatusCreated, "pay through Snap")
	reqs := mt.snapRequests()
	if len(reqs) != 1 {
		t.Fatalf("Snap got %d requests, want 1", len(reqs))
	}
	callbacks, _ := reqs[0]["callbacks"].(map[string]any)
	if len(callbacks) != 1 || callbacks["finish"] != finish {
		t.Errorf("Snap callbacks %v, want only finish %q", reqs[0]["callbacks"], finish)
	}
	details, _ := reqs[0]["transaction_details"].(map[string]any)
	if details["order_id"] != sh.providerOrderID(t, pay.ID) || len(reqs[0]) != 3 {
		t.Errorf("Snap request %v, want transaction_details, expiry and callbacks", reqs[0])
	}
	assertNoServerErrors(t, sh.server)
}
