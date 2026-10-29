package config_test

import (
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// Bab 11 artikel-04: APP_WEB_URL, the storefront's origin, and the Snap
// finish redirect built from it.
func TestLoad_WebURL(t *testing.T) {
	const (
		shapeErr = "APP_WEB_URL: must be the storefront's origin, such as https://shop.example.com (scheme and host, no path)"
		httpsErr = "APP_WEB_URL: must be an https origin such as https://shop.example.com (http only for localhost in development)"
		devOnly  = "APP_WEB_URL: http://localhost is allowed in development only; use an https origin"
	)
	tests := []struct {
		name, env, value string
		want             string // WebURL; FinishURL is want + /pembayaran/selesai
		wantErr          string
	}{
		{name: "empty leaves redirects to the dashboard", env: "production", value: "", want: ""},
		{name: "only spaces", env: "production", value: "   ", want: ""},
		{name: "https origin", env: "production", value: "https://shop.example.com", want: "https://shop.example.com"},
		{name: "https with a port", env: "staging", value: "https://shop.example.com:8443", want: "https://shop.example.com:8443"},
		{name: "trailing slash dropped", env: "production", value: "https://shop.example.com/", want: "https://shop.example.com"},
		{name: "spaces trimmed", env: "production", value: " https://shop.example.com ", want: "https://shop.example.com"},
		{name: "localhost in development", env: "development", value: "http://localhost:5173", want: "http://localhost:5173"},
		{name: "127.0.0.1 in development", env: "development", value: "http://127.0.0.1:5173", want: "http://127.0.0.1:5173"},
		{name: "IPv6 loopback in development", env: "development", value: "http://[::1]:5173", want: "http://[::1]:5173"},
		{name: "localhost outside development", env: "production", value: "http://localhost:5173", wantErr: devOnly},
		{name: "localhost in staging", env: "staging", value: "http://localhost:5173", wantErr: devOnly},
		{name: "plain http elsewhere, even in development", env: "development", value: "http://shop.example.com", wantErr: httpsErr},
		{name: "a lookalike of localhost", env: "development", value: "http://localhost.example.com", wantErr: httpsErr},
		{name: "another scheme", env: "development", value: "ftp://shop.example.com", wantErr: httpsErr},
		{name: "path", env: "production", value: "https://shop.example.com/toko", wantErr: shapeErr},
		{name: "the finish path itself", env: "production", value: "https://shop.example.com/pembayaran/selesai", wantErr: shapeErr},
		{name: "query", env: "production", value: "https://shop.example.com?ref=1", wantErr: shapeErr},
		{name: "empty query", env: "production", value: "https://shop.example.com?", wantErr: shapeErr},
		{name: "fragment", env: "production", value: "https://shop.example.com#top", wantErr: shapeErr},
		{name: "empty fragment", env: "production", value: "https://shop.example.com#", wantErr: shapeErr},
		{name: "userinfo", env: "production", value: "https://user@shop.example.com", wantErr: shapeErr},
		{name: "no scheme", env: "production", value: "shop.example.com", wantErr: shapeErr},
		{name: "no host", env: "production", value: "https://", wantErr: shapeErr},
		{name: "unparsable", env: "development", value: "http://[::1", wantErr: shapeErr},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadBab6(t, tt.env, map[string]string{"APP_WEB_URL": tt.value})
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("Load: want error %q, got nil (WebURL %q)", tt.wantErr, cfg.WebURL)
				}
				testx.AssertContains(t, err.Error(), tt.wantErr)
				testx.AssertEqual(t, cfg.WebURL, "", "a refused config is the zero Config")
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, cfg.WebURL, tt.want)
			wantFinish := ""
			if tt.want != "" {
				wantFinish = tt.want + "/pembayaran/selesai"
			}
			testx.AssertEqual(t, cfg.Payment.FinishURL, wantFinish)
		})
	}
}

func TestPaymentFinishPath(t *testing.T) {
	// The storefront's page (apps/web, app/pembayaran/selesai): the two
	// must move together.
	testx.AssertEqual(t, config.PaymentFinishPath, "/pembayaran/selesai")
}
