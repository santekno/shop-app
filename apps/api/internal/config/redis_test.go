package config_test

import (
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

func TestLoad_RedisURL(t *testing.T) {
	const shapeErr = "REDIS_URL: must be a URL like redis://host:6379/0 (rediss:// for TLS)"
	tests := []struct {
		name    string
		value   string
		wantErr string
	}{
		{name: "redis", value: "redis://localhost:6379/0"},
		{name: "rediss (TLS)", value: "rediss://user:pass@cache.internal:6380"}, //nolint:gosec // a test value, not a credential
		{name: "missing", value: "", wantErr: "REDIS_URL: is required, e.g. redis://localhost:6379/0"},
		{name: "another scheme", value: "http://user:pass@cache:6379", wantErr: shapeErr}, //nolint:gosec // a test value, not a credential
		{name: "no host", value: "redis:///0", wantErr: shapeErr},
		{name: "not a URL", value: "redis://user:pass@cache:6379/%zz", wantErr: shapeErr}, //nolint:gosec // a test value, not a credential
		{name: "host and port only", value: "localhost:6379", wantErr: shapeErr},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadWith(t, "production", map[string]string{"REDIS_URL": tt.value})
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.RedisURL, tt.value)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertFalse(t, strings.Contains(err.Error(), "pass"), "the URL (with its password) is repeated: %v", err)
		})
	}
}

func TestLoad_TrustedProxyHops(t *testing.T) {
	for _, ok := range []string{"0", "1", "5"} {
		cfg, err := loadWith(t, "production", map[string]string{"APP_TRUSTED_PROXY_HOPS": ok})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, cfg.TrustedProxyHops, int(ok[0]-'0'))
	}
	for _, bad := range []string{"-1", "6", "one"} {
		_, err := loadWith(t, "production", map[string]string{"APP_TRUSTED_PROXY_HOPS": bad})
		testx.AssertError(t, err, "%q", bad)
		testx.AssertContains(t, err.Error(), `APP_TRUSTED_PROXY_HOPS: must be a number between 0 and 5, got "`+bad+`"`)
	}
}

func TestLoad_ReportsEveryInvalidAuthVariable(t *testing.T) {
	_, err := loadWith(t, "production", map[string]string{
		"JWT_SECRET": "short", "APP_ACCESS_TOKEN_TTL": "1s", "APP_REFRESH_TOKEN_TTL": "1m",
		"GOOGLE_CLIENT_ID": "", "REDIS_URL": "", "APP_TRUSTED_PROXY_HOPS": "9",
	})
	testx.AssertError(t, err)
	for _, name := range []string{"JWT_SECRET:", "APP_ACCESS_TOKEN_TTL:", "APP_REFRESH_TOKEN_TTL:",
		"GOOGLE_CLIENT_ID:", "REDIS_URL:", "APP_TRUSTED_PROXY_HOPS:"} {
		testx.AssertContains(t, err.Error(), name)
	}
}
