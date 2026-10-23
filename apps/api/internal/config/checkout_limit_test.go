package config_test

import (
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

func TestLoad_CheckoutLimitPerMinute(t *testing.T) {
	cfg, err := loadWith(t, "production", nil)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.CheckoutLimitPerMinute, 30, "unset is the default")
	testx.AssertEqual(t, config.DefaultCheckoutLimitPerMinute, 30)

	for value, want := range map[string]int{"1": 1, "60": 60, "100000": 100_000} {
		cfg, err := loadWith(t, "production", map[string]string{"APP_CHECKOUT_LIMIT_PER_MINUTE": value})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, cfg.CheckoutLimitPerMinute, want, "APP_CHECKOUT_LIMIT_PER_MINUTE=%s", value)
	}
	for _, bad := range []string{"0", "-1", "100001", "ten", "1.5"} {
		_, err := loadWith(t, "production", map[string]string{"APP_CHECKOUT_LIMIT_PER_MINUTE": bad})
		testx.AssertError(t, err, "%q", bad)
		testx.AssertContains(t, err.Error(), `APP_CHECKOUT_LIMIT_PER_MINUTE: must be a number between 1 and 100000, got "`+bad+`"`)
	}
}
