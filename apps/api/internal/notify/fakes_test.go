package notify

// Shared fakes of the notify tests (first needed by Bab 6 artikel 08).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

var errBoom = errors.New("boom")

// fakeOrders answers GetAny with o (or err) and records the IDs asked.
type fakeOrders struct {
	o   order.Order
	err error
	ids []string
}

func (f *fakeOrders) GetAny(_ context.Context, id string) (order.Order, error) {
	f.ids = append(f.ids, id)
	if f.err != nil {
		return order.Order{}, f.err
	}
	return f.o, nil
}

// fakeUsers answers Get with u (or err) and records the IDs asked.
type fakeUsers struct {
	u   user.User
	err error
	ids []string
}

func (f *fakeUsers) Get(_ context.Context, id string) (user.User, error) {
	f.ids = append(f.ids, id)
	if f.err != nil {
		return user.User{}, f.err
	}
	return f.u, nil
}

// recordingMailer records every message and fails with err.
type recordingMailer struct {
	mu   sync.Mutex
	sent []mail.Message
	err  error
}

func (m *recordingMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.sent = append(m.sent, msg)
	return nil
}

func ptr[T any](v T) *T { return &v }

// testOrder is a realistic paid order: two lines, a voucher, JNE REG.
func testOrder() order.Order {
	return order.Order{
		ID:             "0190c8a0-0000-7000-8000-0000000000aa",
		Code:           "GS-20261024-ABC123",
		UserID:         "0190c8a0-0000-7000-8000-0000000000bb",
		Status:         order.StatusPaid,
		Courier:        "jne",
		CourierService: "REG",
		Totals:         order.Totals{Subtotal: 125000, Discount: 20000, ShippingFee: 12000, Total: 117000},
		Address: order.ShippingAddress{
			Recipient: "Siti Aminah", Phone: "+6281234567890", Street: "Jl. Merdeka No. 10",
			City: "Bandung", Province: "Jawa Barat", PostalCode: "40111",
		},
		Items: []order.Item{
			{ProductName: "Kaos Polos", VariantName: "Hitam / L", SKU: "KAOS-HTM-L", UnitPrice: 50000, Quantity: 2, LineTotal: 100000},
			{ProductName: "Topi Rajut", VariantName: "Abu", SKU: "TOPI-ABU", UnitPrice: 25000, Quantity: 1, LineTotal: 25000},
		},
		PaymentExpiresAt: time.Date(2026, 10, 24, 3, 0, 0, 0, time.UTC),
		PaidAt:           ptr(time.Date(2026, 10, 23, 17, 30, 0, 0, time.UTC)),
		TrackingNumber:   ptr("JNE0012345678"),
	}
}

func testBuyer() user.User {
	return user.User{ID: "0190c8a0-0000-7000-8000-0000000000bb", Name: "Budi Santoso", Email: "budi@example.com"}
}

// testEvent is the outbox event an order task is made from.
func testEvent(eventType string) outbox.Event {
	return outbox.Event{
		ID: "0190c8a0-0000-7000-8000-0000000000ee", AggregateType: "order",
		AggregateID: "0190c8a0-0000-7000-8000-0000000000aa", Type: eventType,
		Payload: json.RawMessage(`{"code":"GS-20261024-ABC123"}`), CreatedAt: time.Date(2026, 10, 24, 1, 2, 3, 0, time.UTC),
	}
}

// eventTask is the task taskType of testEvent.
func eventTask(t *testing.T, taskType string) *asynq.Task {
	t.Helper()
	task, err := NewEventTask(taskType, testEvent("order.paid"))
	if err != nil {
		t.Fatalf("NewEventTask: %v", err)
	}
	return task
}

// badPayloads are event task payloads that never decode.
var badPayloads = map[string][]byte{
	"not JSON":             []byte(`not json`),
	"missing event_id":     []byte(`{"aggregate_id":"o-1"}`),
	"missing aggregate_id": []byte(`{"event_id":"e-1"}`),
}

// logCtx is a context whose logx logger writes JSON lines into the
// returned buffer.
func logCtx() (context.Context, *bytes.Buffer) {
	var buf bytes.Buffer
	l := logx.New(logx.WithOutput(&buf), logx.WithFormat("json"), logx.WithLevel("debug"))
	return logx.WithContextLogger(context.Background(), l), &buf
}

// logLines decodes every JSON log line of buf.
func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, s := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if s == "" {
			continue
		}
		var line map[string]any
		if err := json.Unmarshal([]byte(s), &line); err != nil {
			t.Fatalf("decode log line %q: %v", s, err)
		}
		out = append(out, line)
	}
	return out
}
