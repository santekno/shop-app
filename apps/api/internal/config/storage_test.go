package config_test

import (
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

const testS3Secret = "UNITTEST-s3-secret-key-do-not-print-7f3a" //nolint:gosec // a test value, not a credential

// validStorage is a working S3_* set, the Docker Compose shape.
func validStorage(over map[string]string) map[string]string {
	vars := map[string]string{
		"S3_ENDPOINT": "http://storage:8333", "S3_PRESIGN_ENDPOINT": "http://localhost:8333",
		"S3_BUCKET": "goshop-images", "S3_ACCESS_KEY": "goshop", "S3_SECRET_KEY": testS3Secret,
	}
	for k, v := range over {
		vars[k] = v
	}
	return vars
}

func TestLoad_StorageOff(t *testing.T) {
	// Without S3_ENDPOINT nothing else is read or checked.
	cfg, err := loadBab6(t, "production", map[string]string{
		"S3_BUCKET": "NOT A BUCKET", "S3_ACCESS_KEY": "a", "S3_PUBLIC_URL": "ftp://x", "S3_REGION": "eu-west-1",
	})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.Storage, config.Storage{})
}

func TestLoad_StorageValid(t *testing.T) {
	cfg, err := loadBab6(t, "production", validStorage(map[string]string{
		"S3_PUBLIC_URL": " https://images.example.com/goshop/ ", "S3_BUCKET": " goshop-images ",
	}))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.Storage, config.Storage{
		Endpoint: "http://storage:8333", PresignEndpoint: "http://localhost:8333",
		PublicURL: "https://images.example.com/goshop", Region: "us-east-1", Bucket: "goshop-images",
		AccessKey: "goshop", SecretKey: testS3Secret,
	})

	cfg, err = loadBab6(t, "production", validStorage(map[string]string{"S3_REGION": "auto", "S3_PRESIGN_ENDPOINT": ""}))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.Storage.Region, "auto")
	testx.AssertEqual(t, cfg.Storage.PresignEndpoint, "")
}

func TestLoad_StorageEndpoints(t *testing.T) {
	const tail = ": must be an endpoint like http://localhost:8333 (scheme and host, no path)"
	tests := []struct{ value, wantErr string }{
		{value: "http://localhost:8333"},
		{value: "https://s3.ap-southeast-3.amazonaws.com"},
		{value: "http://localhost:8333/"},
		{value: "http://localhost:8333/goshop-images", wantErr: tail},
		{value: "http://localhost:8333?region=x", wantErr: tail},
		{value: "http://goshop:" + testS3Secret + "@localhost:8333", wantErr: tail},
		{value: "localhost:8333", wantErr: tail},
		{value: "ftp://localhost:8333", wantErr: tail},
		{value: "http://", wantErr: tail},
		{value: "http://local host", wantErr: tail},
	}
	for _, name := range []string{"S3_ENDPOINT", "S3_PRESIGN_ENDPOINT"} {
		for _, tt := range tests {
			t.Run(name+" "+tt.value, func(t *testing.T) {
				cfg, err := loadBab6(t, "production", validStorage(map[string]string{name: tt.value}))
				if tt.wantErr == "" {
					testx.AssertNoError(t, err)
					testx.AssertTrue(t, cfg.Storage.Endpoint == tt.value || cfg.Storage.PresignEndpoint == tt.value)
					return
				}
				testx.AssertError(t, err)
				testx.AssertContains(t, err.Error(), name+tt.wantErr)
				testx.AssertFalse(t, strings.Contains(err.Error(), testS3Secret), "error repeats the secret: %v", err)
			})
		}
	}
}

func TestLoad_StoragePublicURL(t *testing.T) {
	const shape = "S3_PUBLIC_URL: must be an http(s) URL like https://images.example.com"
	tests := []struct{ value, want, wantErr string }{
		{value: "https://images.example.com", want: "https://images.example.com"},
		{value: "https://images.example.com///", want: "https://images.example.com"},
		{value: "http://localhost:8333/goshop-images/", want: "http://localhost:8333/goshop-images"},
		{value: "images.example.com", wantErr: shape},
		{value: "ftp://images.example.com", wantErr: shape},
		{value: "https://user:pass@images.example.com", wantErr: shape}, //nolint:gosec // a test value, not a credential
		{value: "https://", wantErr: shape},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			cfg, err := loadBab6(t, "production", validStorage(map[string]string{"S3_PUBLIC_URL": tt.value}))
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Storage.PublicURL, tt.want)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestLoad_StorageBucket(t *testing.T) {
	const prefix = "S3_BUCKET: is required with S3_ENDPOINT and must be a bucket name (3-63 lower-case letters, digits, dots, hyphens), got "
	tests := []struct {
		value string
		ok    bool
	}{
		{value: "abc", ok: true},
		{value: "goshop-images", ok: true},
		{value: "images.example.com", ok: true},
		{value: "0goshop9", ok: true},
		{value: strings.Repeat("a", 63), ok: true},
		{value: strings.Repeat("a", 64)},
		{value: "ab"},
		{value: ""},
		{value: "GoShop"},
		{value: "-goshop"},
		{value: "goshop-"},
		{value: ".goshop"},
		{value: "go_shop"},
		{value: "go shop"},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			cfg, err := loadBab6(t, "production", validStorage(map[string]string{"S3_BUCKET": tt.value}))
			if tt.ok {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Storage.Bucket, tt.value)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), prefix+`"`+tt.value+`"`)
		})
	}
}

func TestLoad_StorageKeys(t *testing.T) {
	const shape = "S3_ACCESS_KEY, S3_SECRET_KEY: are required with S3_ENDPOINT"
	for name, over := range map[string]map[string]string{
		"no access key": {"S3_ACCESS_KEY": ""},
		"no secret key": {"S3_SECRET_KEY": ""},
		"neither":       {"S3_ACCESS_KEY": "", "S3_SECRET_KEY": ""},
		"blank access":  {"S3_ACCESS_KEY": "   "},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := loadBab6(t, "production", validStorage(over))
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), shape)
			testx.AssertFalse(t, strings.Contains(err.Error(), testS3Secret), "error repeats the secret: %v", err)
		})
	}
}

// Every storage rule failing at once: each is reported, the secret never.
func TestLoad_StorageErrorsNeverRepeatTheSecret(t *testing.T) {
	_, err := loadBab6(t, "production", map[string]string{
		"S3_ENDPOINT": "http://localhost:8333/x", "S3_PRESIGN_ENDPOINT": "nope", "S3_PUBLIC_URL": "nope",
		"S3_BUCKET": "X", "S3_ACCESS_KEY": "", "S3_SECRET_KEY": testS3Secret,
	})
	testx.AssertError(t, err)
	for _, name := range []string{"S3_ENDPOINT:", "S3_PRESIGN_ENDPOINT:", "S3_PUBLIC_URL:", "S3_BUCKET:", "S3_ACCESS_KEY, S3_SECRET_KEY:"} {
		testx.AssertContains(t, err.Error(), name)
	}
	testx.AssertFalse(t, strings.Contains(err.Error(), testS3Secret), "error repeats the secret: %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), "7f3a"), "error repeats part of the secret: %v", err)
}
