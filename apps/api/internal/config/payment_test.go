package config_test

import (
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// Distinctive sandbox-shaped keys, so a test can tell whether an error
// repeats them. None is real.
const (
	testMidtransServerKey = "SB-Mid-server-UTsrvKEY42"
	testMidtransClientKey = "SB-Mid-client-UTcliKEY42"
)

func TestLoad_PaymentDefaults(t *testing.T) {
	cfg, err := loadBab6(t, "production", nil)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.Payment, config.Payment{Provider: config.PaymentMidtrans, Timeout: 10 * time.Second})
	testx.AssertEqual(t, config.DefaultPaymentTimeout, 10*time.Second)
	testx.AssertEqual(t, config.PaymentMidtrans, "midtrans")
	testx.AssertEqual(t, config.PaymentFake, "fake")
}

func TestLoad_PaymentProvider(t *testing.T) {
	const refused = "APP_PAYMENT_PROVIDER: fake is a test double and is refused in production"
	tests := []struct {
		name, env, provider, wantErr string
	}{
		{name: "midtrans in production", env: "production", provider: "midtrans"},
		{name: "fake in development", env: "development", provider: "fake"},
		{name: "fake in staging", env: "staging", provider: "fake"},
		{name: "fake in production", env: "production", provider: "fake", wantErr: refused},
		{name: "unknown", env: "development", provider: "stripe", wantErr: `APP_PAYMENT_PROVIDER: must be midtrans or fake, got "stripe"`},
		{name: "case matters", env: "development", provider: "Fake", wantErr: `APP_PAYMENT_PROVIDER: must be midtrans or fake, got "Fake"`},
		{name: "unknown in production", env: "production", provider: "midtrans-prod", wantErr: `got "midtrans-prod"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadBab6(t, tt.env, map[string]string{"APP_PAYMENT_PROVIDER": tt.provider})
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Payment.Provider, tt.provider)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertEqual(t, cfg.Payment, config.Payment{}, "a refused config is the zero Config")
		})
	}
}

func TestLoad_MidtransIsProduction(t *testing.T) {
	tests := []struct {
		value, wantErr string
	}{
		{value: ""},
		{value: "false"},
		{value: " false "},
		{value: "true", wantErr: "MIDTRANS_IS_PRODUCTION: must be false: GoShop uses the Midtrans sandbox only"},
		{value: " true", wantErr: "MIDTRANS_IS_PRODUCTION: must be false: GoShop uses the Midtrans sandbox only"},
		{value: "yes", wantErr: "MIDTRANS_IS_PRODUCTION: must be false or empty"},
		{value: "1", wantErr: "MIDTRANS_IS_PRODUCTION: must be false or empty"},
		{value: "TRUE", wantErr: "MIDTRANS_IS_PRODUCTION: must be false or empty"},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			_, err := loadBab6(t, "development", map[string]string{
				"MIDTRANS_IS_PRODUCTION": tt.value,
				"MIDTRANS_SERVER_KEY":    testMidtransServerKey, "MIDTRANS_CLIENT_KEY": testMidtransClientKey,
			})
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestLoad_MidtransKeys(t *testing.T) {
	const (
		serverShape = "MIDTRANS_SERVER_KEY: must be a sandbox server key (SB-Mid-server-…): GoShop uses the Midtrans sandbox only"
		clientShape = "MIDTRANS_CLIENT_KEY: is required with MIDTRANS_SERVER_KEY and must be a sandbox client key (SB-Mid-client-…)"
		serverFirst = "MIDTRANS_SERVER_KEY: is required when MIDTRANS_CLIENT_KEY is set"
	)
	tests := []struct {
		name, server, client, wantErr string
	}{
		{name: "neither: payments off", server: "", client: ""},
		{name: "sandbox pair", server: testMidtransServerKey, client: testMidtransClientKey},
		{name: "production server key", server: "Mid-server-PRODsecret9", client: testMidtransClientKey, wantErr: serverShape},
		{name: "server key in the client slot", server: testMidtransClientKey, client: testMidtransClientKey, wantErr: serverShape},
		{name: "lower-case prefix", server: "sb-mid-server-UNITTESTlower", client: testMidtransClientKey, wantErr: serverShape},
		{name: "client key missing", server: testMidtransServerKey, client: "", wantErr: clientShape},
		{name: "production client key", server: testMidtransServerKey, client: "Mid-client-PRODpublic9", wantErr: clientShape},
		{name: "server key as client key", server: testMidtransServerKey, client: testMidtransServerKey, wantErr: clientShape},
		{name: "client key without server key", server: "", client: testMidtransClientKey, wantErr: serverFirst},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadBab6(t, "production", map[string]string{
				"MIDTRANS_SERVER_KEY": tt.server, "MIDTRANS_CLIENT_KEY": tt.client,
			})
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Payment.MidtransServerKey, tt.server)
				testx.AssertEqual(t, cfg.Payment.MidtransClientKey, tt.client)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
			assertNoSecret(t, err, tt.server, tt.client)
		})
	}
}

func TestLoad_MidtransKeysAreTrimmed(t *testing.T) {
	cfg, err := loadBab6(t, "production", map[string]string{
		"MIDTRANS_SERVER_KEY": "  " + testMidtransServerKey + "\n", "MIDTRANS_CLIENT_KEY": " " + testMidtransClientKey,
	})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.Payment.MidtransServerKey, testMidtransServerKey)
	testx.AssertEqual(t, cfg.Payment.MidtransClientKey, testMidtransClientKey)
}

// No payment error repeats a key, even when every rule fails at once.
func TestLoad_PaymentErrorsNeverRepeatAKey(t *testing.T) {
	for _, vars := range []map[string]string{
		{"MIDTRANS_SERVER_KEY": "Mid-server-LIVEsecret1", "MIDTRANS_CLIENT_KEY": "Mid-client-LIVEpublic1", "MIDTRANS_IS_PRODUCTION": "true"},
		{"MIDTRANS_SERVER_KEY": testMidtransServerKey, "MIDTRANS_CLIENT_KEY": "Mid-client-LIVEpublic1", "MIDTRANS_IS_PRODUCTION": "yes"},
		{"MIDTRANS_CLIENT_KEY": "SB-Mid-client-ORPHANpub7", "APP_PAYMENT_PROVIDER": "fake"},
	} {
		_, err := loadBab6(t, "production", vars)
		testx.AssertError(t, err)
		assertNoSecret(t, err, vars["MIDTRANS_SERVER_KEY"], vars["MIDTRANS_CLIENT_KEY"])
		// The distinctive middle of each key, in case only a part leaks.
		testx.AssertFalse(t, strings.Contains(err.Error(), "LIVE"), "error repeats a key: %v", err)
		testx.AssertFalse(t, strings.Contains(err.Error(), "ORPHAN"), "error repeats a key: %v", err)
	}
}

func TestLoad_PaymentTimeout(t *testing.T) {
	const shape = `APP_PAYMENT_TIMEOUT: must be a duration between 1s and 30s, such as "15s", got `
	tests := []struct {
		value   string
		want    time.Duration
		wantErr string
	}{
		{value: "1s", want: time.Second},
		{value: "30s", want: 30 * time.Second},
		{value: "2500ms", want: 2500 * time.Millisecond},
		{value: "999ms", wantErr: shape + `"999ms"`},
		{value: "31s", wantErr: shape + `"31s"`},
		{value: "0s", wantErr: shape + `"0s"`},
		{value: "10", wantErr: shape + `"10"`},
		{value: "-5s", wantErr: shape + `"-5s"`},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			cfg, err := loadBab6(t, "production", map[string]string{"APP_PAYMENT_TIMEOUT": tt.value})
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Payment.Timeout, tt.want)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

// assertNoSecret fails when err repeats any non-empty secret.
func assertNoSecret(t *testing.T, err error, secrets ...string) {
	t.Helper()
	for _, s := range secrets {
		if s != "" && strings.Contains(err.Error(), s) {
			t.Errorf("error repeats a secret %q: %v", s, err)
		}
	}
}
