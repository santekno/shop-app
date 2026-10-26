package notify

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/messagingx"

	"github.com/santekno/shop-app/apps/api/internal/order"
)

// TypeSellerPaidOrder is the seller's chat message about a newly paid
// order (order.paid).
const TypeSellerPaidOrder = "telegram:paid-order"

// telegramTimeout bounds one message: messagingx's own default is 65
// seconds, sized for long polling.
const telegramTimeout = 10 * time.Second

// Seller tells the store's staff about new paid orders in a chat (ADR
// 0007), through sdk messagingx: Telegram today, WhatsApp when the sdk has
// a provider for it (docs/sdk-gaps.md).
type Seller struct {
	chat   messagingx.Provider
	chatID string
	orders OrderReader
}

// NewTelegramSeller returns a Seller that writes to the Telegram chat
// chatID with the bot token (a secret: it is part of every Bot API URL).
func NewTelegramSeller(token, chatID string, orders OrderReader) *Seller {
	return NewSeller(messagingx.NewTelegram(token,
		messagingx.WithHTTPClient(&http.Client{Timeout: telegramTimeout})), chatID, orders)
}

// NewSeller returns a Seller on any messagingx provider, for tests.
func NewSeller(chat messagingx.Provider, chatID string, orders OrderReader) *Seller {
	return &Seller{chat: chat, chatID: chatID, orders: orders}
}

// PaidOrder handles TypeSellerPaidOrder.
func (s *Seller) PaidOrder(ctx context.Context, t *asynq.Task) error {
	ev, err := decodeEvent(t)
	if err != nil {
		return err
	}
	o, err := s.orders.GetAny(ctx, ev.AggregateID)
	if errors.Is(err, order.ErrNotFound) {
		return fmt.Errorf("%s: order %s: %w", t.Type(), ev.AggregateID, asynq.SkipRetry)
	}
	if err != nil {
		return fmt.Errorf("%s: %w", t.Type(), err)
	}
	if err := s.chat.Send(ctx, s.chatID, paidOrderText(o)); err != nil {
		return fmt.Errorf("%s: %s: %w", t.Type(), s.chat.Channel(), redact(err))
	}
	return nil
}

// paidOrderText is the message: what to pack, for whom, by which courier.
// No buyer contact details: a chat is not where personal data belongs.
func paidOrderText(o order.Order) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Pesanan baru dibayar: %s\n", o.Code)
	fmt.Fprintf(&b, "Total: %s\n", rupiah(o.Totals.Total))
	for _, it := range o.Items {
		fmt.Fprintf(&b, "- %s (%s) x%d [%s]\n", it.ProductName, it.VariantName, it.Quantity, it.SKU)
	}
	fmt.Fprintf(&b, "Kirim dengan %s %s ke %s", strings.ToUpper(o.Courier), o.CourierService, o.Address.City)
	return b.String()
}

// redact drops the request URL from a transport error: the Bot API puts
// the bot's token in every URL, and net/http repeats the URL in its
// errors, so the error would carry the token into the log and the
// dead-letter queue.
func redact(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return fmt.Errorf("%s request failed: %w", urlErr.Op, urlErr.Err)
	}
	return err
}
