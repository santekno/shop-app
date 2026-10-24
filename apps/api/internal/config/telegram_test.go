package config_test

import (
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

const testBotToken = "123456:UNITTEST-telegram-bot-token-ab12"

func TestLoad_Telegram(t *testing.T) {
	const pair = "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: set both (seller notifications on) or neither (off)"
	tests := []struct {
		name, token, chat string
		want              config.Telegram
		wantErr           bool
	}{
		{name: "off"},
		{name: "both", token: testBotToken, chat: "-1001234567890",
			want: config.Telegram{BotToken: testBotToken, ChatID: "-1001234567890"}},
		{name: "both trimmed", token: "  " + testBotToken + "\n", chat: " -100123 ",
			want: config.Telegram{BotToken: testBotToken, ChatID: "-100123"}},
		{name: "token only", token: testBotToken, wantErr: true},
		{name: "chat only", chat: "-100123", wantErr: true},
		{name: "blank token with chat", token: "   ", chat: "-100123", wantErr: true},
		{name: "token with blank chat", token: testBotToken, chat: " ", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadBab6(t, "production", map[string]string{
				"TELEGRAM_BOT_TOKEN": tt.token, "TELEGRAM_CHAT_ID": tt.chat,
			})
			if !tt.wantErr {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Telegram, tt.want)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), pair)
			testx.AssertFalse(t, strings.Contains(err.Error(), "UNITTEST-telegram"), "error repeats the token: %v", err)
		})
	}
}
