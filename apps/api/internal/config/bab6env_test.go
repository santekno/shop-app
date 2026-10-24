package config_test

import (
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// bab6Vars are the Bab 6 variables without the APP_ prefix, which setEnv
// does not clear: a value on the developer's machine must not leak in.
var bab6Vars = []string{
	"MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY", "MIDTRANS_IS_PRODUCTION",
	"S3_ENDPOINT", "S3_PRESIGN_ENDPOINT", "S3_PUBLIC_URL", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY",
	"SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM",
	"TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
}

// loadBab6 is loadWith with every Bab 6 variable cleared first.
func loadBab6(t *testing.T, env string, vars map[string]string) (config.Config, error) {
	t.Helper()
	for _, name := range bab6Vars {
		unsetEnv(t, name)
	}
	return loadWith(t, env, vars)
}
