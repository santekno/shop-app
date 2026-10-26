package config_test

import (
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

const testSMTPPassword = "UNITTEST-smtp-password-q9z8" //nolint:gosec // a test value, not a credential

func validSMTP(over map[string]string) map[string]string {
	vars := map[string]string{
		"SMTP_HOST": "smtp.example.com", "SMTP_FROM": "GoShop <no-reply@shop.example>",
		"SMTP_USERNAME": "goshop", "SMTP_PASSWORD": testSMTPPassword,
	}
	for k, v := range over {
		vars[k] = v
	}
	return vars
}

func TestLoad_SMTPOff(t *testing.T) {
	// Without SMTP_HOST nothing else is checked: emails go to the log.
	cfg, err := loadBab6(t, "production", map[string]string{"SMTP_PORT": "0", "SMTP_FROM": "nope", "SMTP_USERNAME": "only"})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.SMTP, config.SMTP{})
}

func TestLoad_SMTPValid(t *testing.T) {
	cfg, err := loadBab6(t, "production", validSMTP(map[string]string{
		"SMTP_HOST": " smtp.example.com ", "SMTP_USERNAME": " goshop ", "SMTP_FROM": " GoShop <no-reply@shop.example> ",
	}))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.SMTP, config.SMTP{
		Host: "smtp.example.com", Port: 587, Username: "goshop", Password: testSMTPPassword,
		From: "GoShop <no-reply@shop.example>",
	})

	// No login (a local relay), a bare address, port 465.
	cfg, err = loadBab6(t, "production", validSMTP(map[string]string{
		"SMTP_USERNAME": "", "SMTP_PASSWORD": "", "SMTP_FROM": "no-reply@shop.example", "SMTP_PORT": "465",
	}))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.SMTP.Port, 465)
	testx.AssertEqual(t, cfg.SMTP.From, "no-reply@shop.example")
	testx.AssertEqual(t, cfg.SMTP.Username, "")
}

func TestLoad_SMTPPasswordIsNotTrimmed(t *testing.T) {
	cfg, err := loadBab6(t, "production", validSMTP(map[string]string{"SMTP_PASSWORD": " pass word "}))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, cfg.SMTP.Password, " pass word ")
}

func TestLoad_SMTPPort(t *testing.T) {
	tests := []struct {
		value string
		want  int
		ok    bool
	}{
		{value: "", want: 587, ok: true},
		{value: "1", want: 1, ok: true},
		{value: "25", want: 25, ok: true},
		{value: "65535", want: 65535, ok: true},
		{value: "0"},
		{value: "65536"},
		{value: "-1"},
		{value: "smtp"},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			cfg, err := loadBab6(t, "production", validSMTP(map[string]string{"SMTP_PORT": tt.value}))
			if tt.ok {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.SMTP.Port, tt.want)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), `SMTP_PORT: must be a number between 1 and 65535, got "`+tt.value+`"`)
		})
	}
}

func TestLoad_SMTPFrom(t *testing.T) {
	const shape = "SMTP_FROM: is required with SMTP_HOST, e.g. GoShop <no-reply@shop.example>"
	for _, from := range []string{
		"",
		"GoShop",
		"no-reply",
		"GoShop <>",
		"a@b.c\r\nBcc: x@y.z",
		"GoShop <a@b.c>\r\nBcc: x@y.z",
		"a@b.c\nBcc: x@y.z",
		"a@b.c, x@y.z",
	} {
		t.Run(from, func(t *testing.T) {
			_, err := loadBab6(t, "production", validSMTP(map[string]string{"SMTP_FROM": from}))
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), shape)
		})
	}
}

func TestLoad_SMTPLogin(t *testing.T) {
	const shape = "SMTP_USERNAME, SMTP_PASSWORD: set both or neither"
	for name, over := range map[string]map[string]string{
		"username only":       {"SMTP_PASSWORD": ""},
		"password only":       {"SMTP_USERNAME": ""},
		"blank username only": {"SMTP_USERNAME": "  "},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := loadBab6(t, "production", validSMTP(over))
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), shape)
			testx.AssertFalse(t, strings.Contains(err.Error(), testSMTPPassword), "error repeats the password: %v", err)
		})
	}
}

func TestLoad_SMTPErrorsNeverRepeatThePassword(t *testing.T) {
	_, err := loadBab6(t, "production", map[string]string{
		"SMTP_HOST": "smtp.example.com", "SMTP_PORT": "99999", "SMTP_FROM": testSMTPPassword,
		"SMTP_PASSWORD": testSMTPPassword,
	})
	testx.AssertError(t, err)
	for _, name := range []string{"SMTP_PORT:", "SMTP_FROM:", "SMTP_USERNAME, SMTP_PASSWORD:"} {
		testx.AssertContains(t, err.Error(), name)
	}
	testx.AssertFalse(t, strings.Contains(err.Error(), testSMTPPassword), "error repeats the password: %v", err)
}
