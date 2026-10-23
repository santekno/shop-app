package config_test

import (
	"testing"

	"github.com/santekno/sdk/testx"
)

func TestLoad_GoogleClientID(t *testing.T) {
	tests := []struct {
		name    string
		env     string
		value   string
		want    string
		wantErr string
	}{
		{name: "set", env: "production", value: testGoogleClientID, want: testGoogleClientID},
		{name: "trimmed", env: "production", value: "  " + testGoogleClientID + " ", want: testGoogleClientID},
		{name: "required in production", env: "production", value: "", wantErr: "GOOGLE_CLIENT_ID: is required outside development"},
		{name: "required in staging", env: "staging", value: "  ", wantErr: "GOOGLE_CLIENT_ID: is required outside development"},
		{name: "optional in development", env: "development", value: "", want: ""},
		{name: "not a Google client id", env: "production", value: "goshop-test",
			wantErr: `GOOGLE_CLIENT_ID: must end with .apps.googleusercontent.com, got "goshop-test"`},
		{name: "checked in development too", env: "development", value: "123.example.com", wantErr: "must end with .apps.googleusercontent.com"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadWith(t, tt.env, map[string]string{"GOOGLE_CLIENT_ID": tt.value})
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Auth.GoogleClientID, tt.want)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}
