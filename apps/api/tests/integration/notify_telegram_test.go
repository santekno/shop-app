//go:build integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/messagingx"

	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// testBotToken is a made-up bot token; the tests check it never reaches a
// log line or a dead task's error.
const testBotToken = "123456789:AAH-integration-tests-only-bot-token" //nolint:gosec // a made-up test token

// fakeTelegram is the Bot API's sendMessage at the HTTP boundary.
type fakeTelegram struct {
	srv *httptest.Server
	mu  sync.Mutex
	// messages are the texts received, by chat.
	messages []map[string]string
	// refuse makes it answer ok:false, as for a chat the bot left.
	refuse bool
}

func newFakeTelegram(t *testing.T) *fakeTelegram {
	t.Helper()
	f := &fakeTelegram{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/bot"+testBotToken+"/sendMessage" || r.Method != http.MethodPost {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"ok":false,"description":"Not Found"}`)
			return
		}
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.refuse {
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, `{"ok":false,"description":"Forbidden: bot was kicked from the group chat"}`)
			return
		}
		f.messages = append(f.messages, body)
		_, _ = io.WriteString(w, `{"ok":true,"result":{"message_id":1}}`)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// sent is a copy of the messages received.
func (f *fakeTelegram) sent() []map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]string(nil), f.messages...)
}

// sellerOn is the worker's paid-order handler writing to the Bot API at
// baseURL, to chat -1001234567890.
func sellerOn(sh *shop, baseURL string) asynq.HandlerFunc {
	chat := messagingx.NewTelegram(testBotToken, messagingx.WithBaseURL(baseURL),
		messagingx.WithHTTPClient(&http.Client{Timeout: 5 * time.Second}))
	return notify.NewSeller(chat, "-1001234567890", order.NewPostgresRepository(sh.db)).PaidOrder
}

// TestTelegram_SellerHearsOfPaidOrders: order.paid becomes two tasks, the
// buyer's email and the seller's Telegram message, each delivered once:
// the message names the order, the total, the lines and where to send
// them, and nothing about how to reach the buyer.
func TestTelegram_SellerHearsOfPaidOrders(t *testing.T) {
	tg := newFakeTelegram(t)
	smtp := startFakeSMTP(t)
	ps := newPayShop(t, nil)
	w := startWorker(t, ps.shop, workerOpts{deps: workerDepsFor(ps), mailer: smtp.mailer(), seller: sellerOn(ps.shop, tg.srv.URL)})
	p := ps.product(t, "kaos-telegram", variant("TG-L", "L", 60000, 10))
	b := ps.buyer(t, "telegram")
	o, _, poid := ps.paid(t, b, line{p.Variants["TG-L"], 1})
	assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "paid", "settlement")

	w.run(t, worker.TypePublishEvents)
	eventually(t, 30*time.Second, func() bool { return len(tg.sent()) == 1 }, "the seller got %d messages", len(tg.sent()))
	waitMails(t, smtp, b.Email, 2)
	msg := tg.sent()[0]
	if msg["chat_id"] != "-1001234567890" || !strings.Contains(msg["text"], "Pesanan baru dibayar: "+o.Code) ||
		!strings.Contains(msg["text"], "Total: "+rupiahText(o.Totals.Total.Amount)) || !strings.Contains(msg["text"], "[TG-L]") ||
		!strings.Contains(msg["text"], "Kirim dengan JNE REG ke "+o.Shipping.Address.City) {
		t.Errorf("seller message %v", msg)
	}
	if strings.Contains(msg["text"], b.Email) || strings.Contains(msg["text"], o.Shipping.Address.Phone) ||
		strings.Contains(msg["text"], o.Shipping.Address.Street) {
		t.Errorf("the seller message carries the buyer's contact details: %q", msg["text"])
	}

	mustExec(t, ps.db, `UPDATE outbox_events SET published_at = NULL`)
	w.run(t, worker.TypePublishEvents)
	waitIdle(t, w)
	if len(tg.sent()) != 1 || len(smtp.sent(b.Email)) != 2 {
		t.Errorf("after publishing again: %d messages and %d emails, want 1 and 2", len(tg.sent()), len(smtp.sent(b.Email)))
	}
}

// TestTelegram_TokenNeverLeaks: the bot token is part of every Bot API
// URL, and net/http repeats the URL in its errors. When Telegram cannot
// be reached, the task retries its 5 times and lands in the dead-letter
// queue, and neither its error nor any log line carries the token; a
// refusal from Telegram (the bot was kicked) is reported by its
// description, also without the token.
func TestTelegram_TokenNeverLeaks(t *testing.T) {
	for _, tc := range []struct {
		name    string
		baseURL func(t *testing.T) string
		want    string
	}{
		{name: "unreachable", baseURL: func(t *testing.T) string { return "http://" + closedAddr(t) }, want: "request failed"},
		{name: "refused", baseURL: func(t *testing.T) string {
			tg := newFakeTelegram(t)
			tg.mu.Lock()
			tg.refuse = true
			tg.mu.Unlock()
			return tg.srv.URL
		}, want: "bot was kicked"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ps := newPayShop(t, nil)
			w := startWorker(t, ps.shop, workerOpts{deps: workerDepsFor(ps), seller: sellerOn(ps.shop, tc.baseURL(t))})
			p := ps.product(t, "kaos-bocor", variant("BC-M", "M", 60000, 10))
			b := ps.buyer(t, "bocor")
			_, _, poid := ps.paid(t, b, line{p.Variants["BC-M"], 1})
			assertOutcome(t, ps.gatewaySays(t, poid, "settlement", ""), "paid", "settlement")
			w.run(t, worker.TypePublishEvents)

			var dead []*asynq.TaskInfo
			eventually(t, 60*time.Second, func() bool { dead = w.archived(t); return len(dead) == 1 },
				"the Telegram task did not reach the dead-letter queue; logs:\n%s", w.logs.String())
			if dead[0].Type != notify.TypeSellerPaidOrder || dead[0].Retried != 5 || dead[0].MaxRetry != 5 {
				t.Errorf("dead task %s after %d of %d retries, want %s after 5", dead[0].Type, dead[0].Retried, dead[0].MaxRetry, notify.TypeSellerPaidOrder)
			}
			if strings.Contains(dead[0].LastErr, testBotToken) || strings.Contains(dead[0].LastErr, "AAH-") || !strings.Contains(dead[0].LastErr, tc.want) {
				t.Errorf("dead task error %q, want %q without the token", dead[0].LastErr, tc.want)
			}
			if strings.Contains(w.logs.String(), testBotToken) || strings.Contains(w.logs.String(), "AAH-") {
				t.Errorf("the worker logged the bot token:\n%s", w.logs.String())
			}
			if n := ps.count(t, `SELECT count(*) FROM event_deliveries WHERE consumer = $1`, notify.TypeSellerPaidOrder); n != 0 {
				t.Errorf("a failed message was recorded as delivered")
			}
		})
	}
}
