package notify

// Bab 6 artikel 09: the seller's Telegram message about a paid order.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/messagingx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/order"
)

const botToken = "bot123456:SECRET"

// fakeChat is a messagingx.Provider that records what it sends and fails
// with err.
type fakeChat struct {
	chatIDs []string
	texts   []string
	err     error
}

func (f *fakeChat) Channel() string { return "telegram" }

func (f *fakeChat) Poll(context.Context, int64) ([]messagingx.Update, int64, error) {
	return nil, 0, errors.New("fakeChat: Poll is not used")
}

func (f *fakeChat) Send(_ context.Context, chatID, text string) error {
	if f.err != nil {
		return f.err
	}
	f.chatIDs = append(f.chatIDs, chatID)
	f.texts = append(f.texts, text)
	return nil
}

// tokenURLError is the error net/http returns for a failed Bot API call:
// the URL, with the token, in its text.
func tokenURLError() error {
	return &url.Error{Op: "Post", URL: "https://api.telegram.org/bot" + botToken + "/sendMessage", Err: errBoom}
}

func TestRedact(t *testing.T) {
	t.Run("a transport error loses its URL", func(t *testing.T) {
		in := tokenURLError()
		testx.AssertContains(t, in.Error(), "SECRET", "the input carries the token")
		err := redact(in)
		testx.AssertEqual(t, err.Error(), "Post request failed: boom")
		testx.AssertFalse(t, strings.Contains(err.Error(), "SECRET"), "token leaks: %v", err)
		testx.AssertFalse(t, strings.Contains(err.Error(), "123456"), "token leaks: %v", err)
		testx.AssertTrue(t, errors.Is(err, errBoom), "the cause is kept")
	})
	t.Run("a wrapped transport error too", func(t *testing.T) {
		err := redact(fmt.Errorf("messagingx: %w", tokenURLError()))
		testx.AssertEqual(t, err.Error(), "Post request failed: boom")
	})
	t.Run("any other error passes through", func(t *testing.T) {
		in := errors.New("messagingx: telegram error: Bad Request: chat not found")
		testx.AssertTrue(t, errors.Is(redact(in), in))
		testx.AssertEqual(t, redact(in).Error(), in.Error())
	})
}

func TestPaidOrderText(t *testing.T) {
	text := paidOrderText(testOrder())
	testx.AssertEqual(t, text, "Pesanan baru dibayar: GS-20261024-ABC123\n"+
		"Total: Rp117.000\n"+
		"- Kaos Polos (Hitam / L) x2 [KAOS-HTM-L]\n"+
		"- Topi Rajut (Abu) x1 [TOPI-ABU]\n"+
		"Kirim dengan JNE REG ke Bandung")
	// A chat is not where personal data belongs.
	for _, secret := range []string{"budi@example.com", "Budi", "+6281234567890", "Siti Aminah", "Jl. Merdeka", "40111"} {
		testx.AssertFalse(t, strings.Contains(text, secret), "%q is in the chat message", secret)
	}
}

func TestSeller_PaidOrder(t *testing.T) {
	t.Run("sends the order to the chat", func(t *testing.T) {
		chat, orders := &fakeChat{}, &fakeOrders{o: testOrder()}
		err := NewSeller(chat, "-100123", orders).PaidOrder(t.Context(), eventTask(t, TypeSellerPaidOrder))
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(orders.ids, ","), testEvent("").AggregateID)
		testx.AssertEqual(t, strings.Join(chat.chatIDs, ","), "-100123")
		testx.AssertEqual(t, len(chat.texts), 1)
		testx.AssertEqual(t, chat.texts[0], paidOrderText(testOrder()))
	})
	for name, payload := range badPayloads {
		t.Run("bad payload: "+name, func(t *testing.T) {
			chat, orders := &fakeChat{}, &fakeOrders{o: testOrder()}
			err := NewSeller(chat, "-100123", orders).PaidOrder(t.Context(), asynq.NewTask(TypeSellerPaidOrder, payload))
			testx.AssertTrue(t, errors.Is(err, asynq.SkipRetry), "err = %v", err)
			testx.AssertEqual(t, len(orders.ids), 0)
			testx.AssertEqual(t, len(chat.texts), 0)
		})
	}
	t.Run("order not found: no retry", func(t *testing.T) {
		chat := &fakeChat{}
		err := NewSeller(chat, "-100123", &fakeOrders{err: order.ErrNotFound}).PaidOrder(t.Context(), eventTask(t, TypeSellerPaidOrder))
		testx.AssertTrue(t, errors.Is(err, asynq.SkipRetry), "err = %v", err)
		testx.AssertEqual(t, len(chat.texts), 0)
	})
	t.Run("order lookup fails: retried", func(t *testing.T) {
		chat := &fakeChat{}
		err := NewSeller(chat, "-100123", &fakeOrders{err: errBoom}).PaidOrder(t.Context(), eventTask(t, TypeSellerPaidOrder))
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertFalse(t, errors.Is(err, asynq.SkipRetry))
		testx.AssertEqual(t, err.Error(), "telegram:paid-order: boom")
		testx.AssertEqual(t, len(chat.texts), 0)
	})
	t.Run("the chat fails: retried, without the token", func(t *testing.T) {
		chat := &fakeChat{err: tokenURLError()}
		err := NewSeller(chat, "-100123", &fakeOrders{o: testOrder()}).PaidOrder(t.Context(), eventTask(t, TypeSellerPaidOrder))
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertFalse(t, errors.Is(err, asynq.SkipRetry))
		testx.AssertEqual(t, err.Error(), "telegram:paid-order: telegram: Post request failed: boom")
		testx.AssertFalse(t, strings.Contains(err.Error(), "SECRET"), "token leaks: %v", err)
	})
}

// The real messagingx Telegram provider against a Bot API that hangs up:
// net/http's error names the URL, token included, and PaidOrder must not
// pass it on.
func TestSeller_PaidOrder_RealTelegramErrorHasNoToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Error("no hijacker")
			return
		}
		conn, _, err := hj.Hijack()
		if err == nil {
			_ = conn.Close()
		}
	}))
	defer srv.Close()
	chat := messagingx.NewTelegram(botToken, messagingx.WithBaseURL(srv.URL), messagingx.WithHTTPClient(srv.Client()))

	// What the provider returns on its own carries the token...
	raw := chat.Send(t.Context(), "-100123", "x")
	var urlErr *url.Error
	testx.AssertTrue(t, errors.As(raw, &urlErr), "a transport error: %v", raw)
	testx.AssertContains(t, raw.Error(), botToken)

	// ...what PaidOrder returns does not.
	err := NewSeller(chat, "-100123", &fakeOrders{o: testOrder()}).PaidOrder(t.Context(), eventTask(t, TypeSellerPaidOrder))
	testx.AssertError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "telegram:paid-order: telegram: Post request failed: "), "err = %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), "SECRET"), "token leaks: %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), "123456"), "token leaks: %v", err)
}

// NewTelegramSeller talks to the real Bot API host; a context cancelled
// before the call fails inside net/http before any connection, with the
// URL in the error, so the token redaction is checked without a network.
func TestNewTelegramSeller_ErrorHasNoToken(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	s := NewTelegramSeller(botToken, "-100123", &fakeOrders{o: testOrder()})
	testx.AssertEqual(t, s.chatID, "-100123")
	testx.AssertEqual(t, s.chat.Channel(), "telegram")
	err := s.PaidOrder(ctx, eventTask(t, TypeSellerPaidOrder))
	testx.AssertTrue(t, errors.Is(err, context.Canceled), "err = %v", err)
	testx.AssertEqual(t, err.Error(), "telegram:paid-order: telegram: Post request failed: context canceled")
	testx.AssertFalse(t, strings.Contains(err.Error(), "SECRET"), "token leaks: %v", err)
}
