package config_test

import (
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

const testBiteshipKey = "biteship_test.0123456789" // #nosec G101 -- a test value, not a credential

func TestLoad_ShippingDefaults(t *testing.T) {
	cfg, err := loadWith(t, "production", map[string]string{"BITESHIP_API_KEY": ""})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.Shipping, config.Shipping{Timeout: 5 * time.Second}, "no key: the static table, no origin needed")
	testx.AssertEqual(t, config.DefaultShippingTimeout, 5*time.Second)
}

func TestLoad_Shipping(t *testing.T) {
	tests := []struct {
		name    string
		vars    map[string]string
		want    config.Shipping
		wantErr string
	}{
		{
			name: "Biteship with an origin",
			vars: map[string]string{"BITESHIP_API_KEY": " " + testBiteshipKey + " ", "APP_SHIPPING_ORIGIN_POSTAL_CODE": " 40115 ", "APP_SHIPPING_TIMEOUT": "3s"},
			want: config.Shipping{BiteshipAPIKey: testBiteshipKey, OriginPostalCode: "40115", Timeout: 3 * time.Second},
		},
		{
			name: "an origin without a key is allowed (static ignores it)",
			vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_ORIGIN_POSTAL_CODE": "40115"},
			want: config.Shipping{OriginPostalCode: "40115", Timeout: 5 * time.Second},
		},
		{
			name:    "a key without an origin",
			vars:    map[string]string{"BITESHIP_API_KEY": testBiteshipKey},
			wantErr: "APP_SHIPPING_ORIGIN_POSTAL_CODE: is required when BITESHIP_API_KEY is set",
		},
		{name: "four digits", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_ORIGIN_POSTAL_CODE": "4011"},
			wantErr: `APP_SHIPPING_ORIGIN_POSTAL_CODE: must be a 5-digit Indonesian postal code such as 40111, got "4011"`},
		{name: "a leading zero", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_ORIGIN_POSTAL_CODE": "01234"},
			wantErr: `got "01234"`},
		{name: "letters", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_ORIGIN_POSTAL_CODE": "4O115"},
			wantErr: `got "4O115"`},
		{name: "six digits", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_ORIGIN_POSTAL_CODE": "401150"},
			wantErr: `got "401150"`},
		{name: "timeout at the minimum", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_TIMEOUT": "1s"},
			want: config.Shipping{Timeout: time.Second}},
		{name: "timeout at the maximum", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_TIMEOUT": "15s"},
			want: config.Shipping{Timeout: 15 * time.Second}},
		{name: "timeout too short", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_TIMEOUT": "999ms"},
			wantErr: `APP_SHIPPING_TIMEOUT: must be a duration between 1s and 15s, such as "15s", got "999ms"`},
		{name: "timeout too long", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_TIMEOUT": "16s"},
			wantErr: `APP_SHIPPING_TIMEOUT: must be a duration between 1s and 15s`},
		{name: "timeout not a duration", vars: map[string]string{"BITESHIP_API_KEY": "", "APP_SHIPPING_TIMEOUT": "5"},
			wantErr: `APP_SHIPPING_TIMEOUT: must be a duration`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadWith(t, "production", tt.vars)
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Shipping, tt.want)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertFalse(t, strings.Contains(err.Error(), testBiteshipKey), "the key is never repeated: %v", err)
		})
	}
}

// Every shipping problem is reported at once.
func TestLoad_ShippingReportsEveryProblem(t *testing.T) {
	_, err := loadWith(t, "production", map[string]string{
		"BITESHIP_API_KEY": "", "APP_SHIPPING_ORIGIN_POSTAL_CODE": "abc", "APP_SHIPPING_TIMEOUT": "1h",
	})
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "APP_SHIPPING_ORIGIN_POSTAL_CODE:")
	testx.AssertContains(t, err.Error(), "APP_SHIPPING_TIMEOUT:")
}

func TestLoad_PaymentTTL(t *testing.T) {
	cfg, err := loadWith(t, "production", map[string]string{"BITESHIP_API_KEY": ""})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.PaymentTTL, 24*time.Hour, "Midtrans' default")
	testx.AssertEqual(t, config.DefaultPaymentTTL, 24*time.Hour)

	for value, want := range map[string]time.Duration{"1m": time.Minute, "72h": 72 * time.Hour, "30m": 30 * time.Minute} {
		cfg, err := loadWith(t, "production", map[string]string{"BITESHIP_API_KEY": "", "APP_PAYMENT_TTL": value})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, cfg.PaymentTTL, want, "APP_PAYMENT_TTL=%s", value)
	}
	for _, bad := range []string{"59s", "73h", "1d", "-1h"} {
		_, err := loadWith(t, "production", map[string]string{"BITESHIP_API_KEY": "", "APP_PAYMENT_TTL": bad})
		testx.AssertError(t, err, "%q", bad)
		testx.AssertContains(t, err.Error(), `APP_PAYMENT_TTL: must be a duration between 1m0s and 72h0m0s, such as "15s", got "`+bad+`"`)
	}
}
