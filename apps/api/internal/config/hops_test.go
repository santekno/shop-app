package config_test

import (
	"strconv"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// APP_TRUSTED_PROXY_HOPS decides which X-Forwarded-For entry the per-IP
// rate limits trust, so outside development it must be set on purpose: a
// forgotten value would either trust a forged header or count every client
// as the proxy.
func TestLoad_TrustedProxyHopsRequiredOutsideDevelopment(t *testing.T) {
	for _, env := range []string{config.EnvStaging, config.EnvProduction} {
		t.Run(env+" unset", func(t *testing.T) {
			setEnv(t, map[string]string{"APP_ENV": env})
			unsetEnv(t, "APP_TRUSTED_PROXY_HOPS")
			_, err := config.Load()
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), "APP_TRUSTED_PROXY_HOPS: is required outside development")
		})
		t.Run(env+" empty", func(t *testing.T) {
			_, err := loadWith(t, env, map[string]string{"APP_TRUSTED_PROXY_HOPS": ""})
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), "APP_TRUSTED_PROXY_HOPS: is required outside development")
		})
	}
}

func TestLoad_TrustedProxyHopsOptionalInDevelopment(t *testing.T) {
	setEnv(t, map[string]string{"APP_ENV": config.EnvDevelopment})
	unsetEnv(t, "APP_TRUSTED_PROXY_HOPS")
	cfg, err := config.Load()
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.TrustedProxyHops, 0, "no proxy in front of make up")
}

func TestLoad_TrustedProxyHopsRange(t *testing.T) {
	for _, env := range []string{config.EnvDevelopment, config.EnvProduction} {
		for _, n := range []int{0, 1, 3, 5} {
			cfg, err := loadWith(t, env, map[string]string{"APP_TRUSTED_PROXY_HOPS": strconv.Itoa(n)})
			testx.AssertNoError(t, err, "%s %d", env, n)
			testx.AssertEqual(t, cfg.TrustedProxyHops, n, "%s: the set value is read", env)
		}
		for _, bad := range []string{"-1", "6", "1.5", "one"} {
			_, err := loadWith(t, env, map[string]string{"APP_TRUSTED_PROXY_HOPS": bad})
			testx.AssertError(t, err, "%s %q", env, bad)
			testx.AssertContains(t, err.Error(), `APP_TRUSTED_PROXY_HOPS: must be a number between 0 and 5, got "`+bad+`"`)
		}
	}
}
