package mail_test

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/mail"
)

var msg = mail.Message{
	To:      "budi@example.com",
	Subject: "Verifikasi email akun GoShop kamu",
	Body:    "token: 0190c8a0-0000-7000-8000-000000000001.c2VjcmV0",
}

func send(t *testing.T, showBody bool) map[string]any {
	t.Helper()
	var buf bytes.Buffer
	logger := logx.New(logx.WithOutput(&buf), logx.WithFormat("json"), logx.WithLevel("debug"))
	err := mail.NewLogMailer(logger, showBody).Send(context.Background(), msg)
	testx.AssertNoError(t, err, "LogMailer never fails")
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	testx.AssertEqual(t, len(lines), 1, "one log line: %s", buf.String())
	var line map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &line); err != nil {
		t.Fatalf("decode %q: %v", lines[0], err)
	}
	return line
}

// In development the whole message is logged, so a developer can copy the
// token from the API's output.
func TestLogMailer_ShowBody(t *testing.T) {
	line := send(t, true)
	testx.AssertEqual(t, line["level"], any("INFO"))
	testx.AssertEqual(t, line["msg"], any("email (development: logged, not sent)"))
	testx.AssertEqual(t, line["to"], any(msg.To))
	testx.AssertEqual(t, line["subject"], any(msg.Subject))
	testx.AssertEqual(t, line["body"], any(msg.Body))
}

// Anywhere else a body with a token, or an address, must never reach the
// log: only the subject, at WARN, because nothing was sent.
func TestLogMailer_HidesBodyAndRecipient(t *testing.T) {
	line := send(t, false)
	testx.AssertEqual(t, line["level"], any("WARN"))
	testx.AssertEqual(t, line["msg"], any("email not sent: SMTP_HOST is not set"))
	testx.AssertEqual(t, line["subject"], any(msg.Subject))
	for _, key := range []string{"to", "body"} {
		_, present := line[key]
		testx.AssertFalse(t, present, "%s is logged", key)
	}
	raw, _ := json.Marshal(line)
	testx.AssertFalse(t, strings.Contains(string(raw), "budi@example.com"), "the address leaks")
	testx.AssertFalse(t, strings.Contains(string(raw), "c2VjcmV0"), "the token leaks")
}
