package config_test

import (
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// loadWith loads the configuration for env with vars over the test
// defaults.
func loadWith(t *testing.T, env string, vars map[string]string) (config.Config, error) {
	t.Helper()
	all := map[string]string{"APP_ENV": env}
	for k, v := range vars {
		all[k] = v
	}
	setEnv(t, all)
	return config.Load()
}

func TestLoad_JWTSecret(t *testing.T) {
	thirtyTwo := strings.Repeat("k", 32)
	tests := []struct {
		name    string
		env     string
		value   string
		wantErr string
	}{
		{name: "32 bytes", env: "production", value: thirtyTwo},
		{name: "missing", env: "production", value: "", wantErr: "JWT_SECRET: is required; generate one with: openssl rand -base64 48"},
		{name: "missing in development too", env: "development", value: "", wantErr: "JWT_SECRET: is required"},
		{name: "31 bytes", env: "production", value: thirtyTwo[:31], wantErr: "JWT_SECRET: must be at least 32 bytes, got 31"},
		// Bytes, not characters: 11 three-byte runes are 33 bytes.
		{name: "counted in bytes", env: "production", value: strings.Repeat("鍵", 11)},
		{name: "placeholder in production", env: "production", value: config.JWTSecretPlaceholder,
			wantErr: "JWT_SECRET: is the placeholder from .env.example, which is allowed in development only"},
		{name: "placeholder in staging", env: "staging", value: config.JWTSecretPlaceholder, wantErr: "is the placeholder"},
		{name: "anything still saying change-me", env: "production", value: "CHANGE-ME-" + thirtyTwo, wantErr: "is the placeholder"},
		{name: "placeholder in development", env: "development", value: config.JWTSecretPlaceholder},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadWith(t, tt.env, map[string]string{"JWT_SECRET": tt.value})
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, string(cfg.Auth.JWTSecret), tt.value)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
			if tt.value != "" {
				testx.AssertFalse(t, strings.Contains(err.Error(), tt.value), "the secret is repeated: %v", err)
			}
		})
	}
	testx.AssertEqual(t, config.MinJWTSecretBytes, 32)
}

func TestLoad_TokenTTLs(t *testing.T) {
	tests := []struct {
		name        string
		vars        map[string]string
		wantAccess  time.Duration
		wantRefresh time.Duration
		wantErr     string
	}{
		{name: "defaults", wantAccess: 15 * time.Minute, wantRefresh: 720 * time.Hour},
		{name: "lowest", vars: map[string]string{"APP_ACCESS_TOKEN_TTL": "1m", "APP_REFRESH_TOKEN_TTL": "1h"},
			wantAccess: time.Minute, wantRefresh: time.Hour},
		{name: "highest", vars: map[string]string{"APP_ACCESS_TOKEN_TTL": "1h", "APP_REFRESH_TOKEN_TTL": "2160h"},
			wantAccess: time.Hour, wantRefresh: 2160 * time.Hour},
		{name: "access below 1m", vars: map[string]string{"APP_ACCESS_TOKEN_TTL": "59s"},
			wantErr: `APP_ACCESS_TOKEN_TTL: must be a duration between 1m0s and 1h0m0s, such as "15s", got "59s"`},
		{name: "access above 1h", vars: map[string]string{"APP_ACCESS_TOKEN_TTL": "61m"}, wantErr: "APP_ACCESS_TOKEN_TTL: must be a duration between"},
		{name: "access not a duration", vars: map[string]string{"APP_ACCESS_TOKEN_TTL": "15"}, wantErr: `got "15"`},
		{name: "refresh below 1h", vars: map[string]string{"APP_REFRESH_TOKEN_TTL": "59m"},
			wantErr: `APP_REFRESH_TOKEN_TTL: must be a duration between 1h0m0s and 2160h0m0s`},
		{name: "refresh above 90 days", vars: map[string]string{"APP_REFRESH_TOKEN_TTL": "2161h"}, wantErr: "APP_REFRESH_TOKEN_TTL: must be a duration between"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadWith(t, "production", tt.vars)
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Auth.AccessTokenTTL, tt.wantAccess)
				testx.AssertEqual(t, cfg.Auth.RefreshTokenTTL, tt.wantRefresh)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

// The Bab 4 variables are reported together with every other bad one.
