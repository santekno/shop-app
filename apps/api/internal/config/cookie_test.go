package config_test

import (
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// APP_AUTH_COOKIE_SECURE (Bab 10, ADR 0008): the web session cookie
// carries Secure unless the variable is false, which only development
// accepts. Without Secure the refresh token can travel over plain HTTP.
func TestLoad_AuthCookieSecure(t *testing.T) {
	const refused = "APP_AUTH_COOKIE_SECURE: false is allowed in development only; remove it or set true"
	tests := []struct {
		name    string
		env     string
		value   *string
		want    bool
		wantErr string
	}{
		{name: "unset in production", env: config.EnvProduction, want: true},
		{name: "unset in development", env: config.EnvDevelopment, want: true},
		{name: "empty", env: config.EnvProduction, value: ptr(""), want: true},
		{name: "true in production", env: config.EnvProduction, value: ptr("true"), want: true},
		{name: "true in development", env: config.EnvDevelopment, value: ptr("true"), want: true},
		{name: "false in development", env: config.EnvDevelopment, value: ptr("false"), want: false},
		{name: "false in staging", env: config.EnvStaging, value: ptr("false"), wantErr: refused},
		{name: "false in production", env: config.EnvProduction, value: ptr("false"), wantErr: refused},
		{name: "maybe", env: config.EnvDevelopment, value: ptr("maybe"),
			wantErr: `APP_AUTH_COOKIE_SECURE: must be true or false, got "maybe"`},
		{name: "maybe in production", env: config.EnvProduction, value: ptr("maybe"),
			wantErr: `APP_AUTH_COOKIE_SECURE: must be true or false, got "maybe"`},
		{name: "0 is not false", env: config.EnvDevelopment, value: ptr("0"),
			wantErr: `APP_AUTH_COOKIE_SECURE: must be true or false, got "0"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vars := map[string]string{}
			if tt.value != nil {
				vars["APP_AUTH_COOKIE_SECURE"] = *tt.value
			}
			cfg, err := loadWith(t, tt.env, vars)
			if tt.wantErr != "" {
				testx.AssertError(t, err)
				testx.AssertContains(t, err.Error(), tt.wantErr)
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, cfg.Auth.CookieSecure, tt.want)
		})
	}
}
