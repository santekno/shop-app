package notify

// Bab 6 artikel 08: the order emails (templates, rupiah, WIB times) and
// the worker's email handlers.

import (
	"errors"
	"strings"
	"testing"
	"text/template"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestRupiah(t *testing.T) {
	tests := []struct {
		in   int64
		want string
	}{
		{0, "Rp0"},
		{7, "Rp7"},
		{999, "Rp999"},
		{1000, "Rp1.000"},
		{12000, "Rp12.000"},
		{117000, "Rp117.000"},
		{1234567, "Rp1.234.567"},
		{1000000000, "Rp1.000.000.000"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			testx.AssertEqual(t, rupiah(tt.in), tt.want)
		})
	}
}

func TestWIB(t *testing.T) {
	wibFn := funcs["wib"].(func(time.Time) string)
	tests := []struct {
		in   time.Time
		want string
	}{
		{time.Date(2026, 10, 24, 3, 0, 0, 0, time.UTC), "24-10-2026 10:00 WIB"},
		{time.Date(2026, 10, 23, 17, 30, 0, 0, time.UTC), "24-10-2026 00:30 WIB"},
		{time.Date(2026, 12, 31, 23, 59, 0, 0, time.FixedZone("WIB", 7*3600)), "31-12-2026 23:59 WIB"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			testx.AssertEqual(t, wibFn(tt.in), tt.want)
		})
	}
}

func mustRender(t *testing.T, tmpl *template.Template, o order.Order) mail.Message {
	t.Helper()
	m, err := render(tmpl, testBuyer(), o)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, m.To, "budi@example.com", "the buyer's address")
	testx.AssertTrue(t, strings.HasPrefix(m.Body, "Halo Budi Santoso,\n"), "body = %q", m.Body)
	return m
}

// pendingOrder is testOrder before payment: what the order confirmation
// is usually rendered for.
func pendingOrder() order.Order {
	o := testOrder()
	o.Status = order.StatusPendingPayment
	o.PaidAt = nil
	o.TrackingNumber = nil
	return o
}

const (
	confirmationHead = "Halo Budi Santoso,\n\n" +
		"Terima kasih, pesanan GS-20261024-ABC123 sudah kami terima.\n\n" +
		"- Kaos Polos (Hitam / L) x2: Rp100.000\n" +
		"- Topi Rajut (Abu) x1: Rp25.000\n\n" +
		"Subtotal: Rp125.000\nDiskon: -Rp20.000\nOngkos kirim (JNE REG): Rp12.000\nTotal: Rp117.000\n"
	payBefore = "\nSelesaikan pembayaran sebelum 24-10-2026 10:00 WIB dari halaman pesanan di aplikasi GoShop. " +
		"Lewat dari itu, pesanan dibatalkan otomatis.\n"
	confirmationTail = "\nSalam,\nGoShop\n"
)

func TestRender_OrderConfirmation(t *testing.T) {
	m := mustRender(t, orderConfirmation, pendingOrder())
	testx.AssertEqual(t, m.Subject, "Pesanan GS-20261024-ABC123 diterima")
	testx.AssertEqual(t, m.Body, confirmationHead+payBefore+confirmationTail)

	t.Run("no discount line without a voucher", func(t *testing.T) {
		o := pendingOrder()
		o.Totals = order.Totals{Subtotal: 125000, ShippingFee: 12000, Total: 137000}
		m := mustRender(t, orderConfirmation, o)
		testx.AssertFalse(t, strings.Contains(m.Body, "Diskon"), "body = %q", m.Body)
		testx.AssertContains(t, m.Body, "Subtotal: Rp125.000\nOngkos kirim (JNE REG): Rp12.000\nTotal: Rp137.000\n")
	})
}

// The email is rendered when it is sent, possibly hours after checkout: it
// asks for payment only while the order still waits for it, and is
// otherwise the same email.
func TestRender_OrderConfirmationAsksForPaymentOnlyWhileDue(t *testing.T) {
	tests := []struct {
		status order.Status
		want   string
	}{
		{order.StatusPendingPayment, confirmationHead + payBefore + confirmationTail},
		{order.StatusPaid, confirmationHead + confirmationTail},
		{order.StatusCancelled, confirmationHead + confirmationTail},
		{order.StatusProcessing, confirmationHead + confirmationTail},
		{order.StatusShipped, confirmationHead + confirmationTail},
	}
	for _, tt := range tests {
		t.Run(string(tt.status), func(t *testing.T) {
			o := pendingOrder()
			o.Status = tt.status
			m := mustRender(t, orderConfirmation, o)
			testx.AssertEqual(t, m.Subject, "Pesanan GS-20261024-ABC123 diterima")
			testx.AssertEqual(t, m.Body, tt.want)
			testx.AssertEqual(t, strings.Contains(m.Body, "Selesaikan pembayaran"), tt.status == order.StatusPendingPayment,
				"body = %q", m.Body)
		})
	}

	t.Run("the deadline is shown in WIB", func(t *testing.T) {
		o := pendingOrder()
		o.PaymentExpiresAt = time.Date(2026, 10, 24, 17, 30, 0, 0, time.UTC)
		m := mustRender(t, orderConfirmation, o)
		testx.AssertContains(t, m.Body, "Selesaikan pembayaran sebelum 25-10-2026 00:30 WIB dari halaman pesanan")
	})
}

// Only the order confirmation depends on the order's status: the
// payment-received and order-shipped emails read the same whatever it is.
func TestRender_OtherEmailsIgnoreStatus(t *testing.T) {
	for name, tmpl := range map[string]*template.Template{"payment received": paymentReceived, "order shipped": orderShipped} {
		t.Run(name, func(t *testing.T) {
			want := mustRender(t, tmpl, testOrder())
			testx.AssertFalse(t, strings.Contains(want.Body, "Selesaikan pembayaran"), "body = %q", want.Body)
			for _, status := range []order.Status{order.StatusPendingPayment, order.StatusCancelled, order.StatusShipped} {
				o := testOrder()
				o.Status = status
				got := mustRender(t, tmpl, o)
				testx.AssertEqual(t, got.Subject, want.Subject, "status %s", status)
				testx.AssertEqual(t, got.Body, want.Body, "status %s", status)
			}
		})
	}
}

func TestRender_PaymentReceived(t *testing.T) {
	m := mustRender(t, paymentReceived, testOrder())
	testx.AssertEqual(t, m.Subject, "Pembayaran pesanan GS-20261024-ABC123 diterima")
	testx.AssertContains(t, m.Body,
		"Pembayaran Rp117.000 untuk pesanan GS-20261024-ABC123 sudah kami terima pada 24-10-2026 00:30 WIB. ")
	testx.AssertContains(t, m.Body, "Siti Aminah\nJl. Merdeka No. 10, Bandung, Jawa Barat 40111\n")

	t.Run("without PaidAt", func(t *testing.T) {
		o := testOrder()
		o.PaidAt = nil
		m := mustRender(t, paymentReceived, o)
		testx.AssertContains(t, m.Body, "untuk pesanan GS-20261024-ABC123 sudah kami terima. Pesananmu")
		testx.AssertFalse(t, strings.Contains(m.Body, " pada "), "body = %q", m.Body)
	})
}

func TestRender_OrderShipped(t *testing.T) {
	m := mustRender(t, orderShipped, testOrder())
	testx.AssertEqual(t, m.Subject, "Pesanan GS-20261024-ABC123 dikirim")
	testx.AssertContains(t, m.Body, "Pesanan GS-20261024-ABC123 sudah kami serahkan ke kurir JNE REG.\nNomor resi: JNE0012345678\n")

	t.Run("without a tracking number", func(t *testing.T) {
		o := testOrder()
		o.TrackingNumber = nil
		m := mustRender(t, orderShipped, o)
		testx.AssertContains(t, m.Body, "kurir JNE REG.\n\nSetelah paket sampai")
		testx.AssertFalse(t, strings.Contains(m.Body, "Nomor resi"), "body = %q", m.Body)
	})
}

// A template that fails to execute is an error, never a half-written email.
func TestRender_TemplateErrors(t *testing.T) {
	noSubject := template.Must(template.New("x").Parse(`{{define "body"}}b{{end}}`))
	_, err := render(noSubject, testBuyer(), testOrder())
	testx.AssertError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "render subject: "), "err = %v", err)

	noBody := template.Must(template.New("x").Parse(`{{define "subject"}}s{{end}}`))
	_, err = render(noBody, testBuyer(), testOrder())
	testx.AssertError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "render body: "), "err = %v", err)
}

func TestEmails_OrderHandlers(t *testing.T) {
	handlers := []struct {
		taskType string
		subject  string
		handle   func(e *Emails) asynq.HandlerFunc
	}{
		{TypeOrderConfirmationEmail, "Pesanan GS-20261024-ABC123 diterima", func(e *Emails) asynq.HandlerFunc { return e.OrderConfirmation }},
		{TypePaymentReceivedEmail, "Pembayaran pesanan GS-20261024-ABC123 diterima", func(e *Emails) asynq.HandlerFunc { return e.PaymentReceived }},
		{TypeOrderShippedEmail, "Pesanan GS-20261024-ABC123 dikirim", func(e *Emails) asynq.HandlerFunc { return e.OrderShipped }},
	}
	for _, h := range handlers {
		t.Run(h.taskType, func(t *testing.T) {
			t.Run("sends to the buyer", func(t *testing.T) {
				orders, users, mailer := &fakeOrders{o: testOrder()}, &fakeUsers{u: testBuyer()}, &recordingMailer{}
				err := h.handle(NewEmails(mailer, orders, users))(t.Context(), eventTask(t, h.taskType))
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, strings.Join(orders.ids, ","), testEvent("").AggregateID, "the event's order")
				testx.AssertEqual(t, strings.Join(users.ids, ","), testOrder().UserID, "the order's buyer")
				testx.AssertEqual(t, len(mailer.sent), 1)
				testx.AssertEqual(t, mailer.sent[0].To, "budi@example.com")
				testx.AssertEqual(t, mailer.sent[0].Subject, h.subject)
			})
			for name, payload := range badPayloads {
				t.Run("bad payload: "+name, func(t *testing.T) {
					orders, mailer := &fakeOrders{o: testOrder()}, &recordingMailer{}
					err := h.handle(NewEmails(mailer, orders, &fakeUsers{u: testBuyer()}))(t.Context(), asynq.NewTask(h.taskType, payload))
					testx.AssertTrue(t, errors.Is(err, asynq.SkipRetry), "err = %v", err)
					testx.AssertEqual(t, err.Error(), h.taskType+": bad payload: skip retry for the task")
					testx.AssertEqual(t, len(orders.ids), 0, "no lookup")
					testx.AssertEqual(t, len(mailer.sent), 0)
				})
			}
			t.Run("order not found: no retry", func(t *testing.T) {
				mailer := &recordingMailer{}
				err := h.handle(NewEmails(mailer, &fakeOrders{err: order.ErrNotFound}, &fakeUsers{u: testBuyer()}))(t.Context(), eventTask(t, h.taskType))
				testx.AssertTrue(t, errors.Is(err, asynq.SkipRetry), "err = %v", err)
				testx.AssertContains(t, err.Error(), "order "+testEvent("").AggregateID)
				testx.AssertEqual(t, len(mailer.sent), 0)
			})
			t.Run("order lookup fails: retried", func(t *testing.T) {
				mailer := &recordingMailer{}
				err := h.handle(NewEmails(mailer, &fakeOrders{err: errBoom}, &fakeUsers{u: testBuyer()}))(t.Context(), eventTask(t, h.taskType))
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertFalse(t, errors.Is(err, asynq.SkipRetry), "a database error is retried")
				testx.AssertEqual(t, err.Error(), h.taskType+": boom")
				testx.AssertEqual(t, len(mailer.sent), 0)
			})
			t.Run("deleted account: nothing sent, logged, done", func(t *testing.T) {
				ctx, logs := logCtx()
				mailer := &recordingMailer{}
				err := h.handle(NewEmails(mailer, &fakeOrders{o: testOrder()}, &fakeUsers{err: user.ErrNotFound}))(ctx, eventTask(t, h.taskType))
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, len(mailer.sent), 0)
				lines := logLines(t, logs)
				testx.AssertEqual(t, len(lines), 1)
				testx.AssertEqual(t, lines[0]["msg"], any("no email: the buyer's account was deleted"))
				testx.AssertEqual(t, lines[0]["order_id"], any(testOrder().ID))
				testx.AssertEqual(t, lines[0]["task"], any(h.taskType))
			})
			t.Run("user lookup fails: retried", func(t *testing.T) {
				mailer := &recordingMailer{}
				err := h.handle(NewEmails(mailer, &fakeOrders{o: testOrder()}, &fakeUsers{err: errBoom}))(t.Context(), eventTask(t, h.taskType))
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertFalse(t, errors.Is(err, asynq.SkipRetry))
				testx.AssertEqual(t, len(mailer.sent), 0)
			})
			t.Run("mailer fails: retried", func(t *testing.T) {
				err := h.handle(NewEmails(&recordingMailer{err: errBoom}, &fakeOrders{o: testOrder()}, &fakeUsers{u: testBuyer()}))(t.Context(), eventTask(t, h.taskType))
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertFalse(t, errors.Is(err, asynq.SkipRetry))
				testx.AssertEqual(t, err.Error(), h.taskType+": boom")
			})
		})
	}
}

func TestEmails_SendQueued(t *testing.T) {
	t.Run("sends the queued message as it is", func(t *testing.T) {
		mailer := &recordingMailer{}
		task := asynq.NewTask(TypeSendEmail, []byte(`{"To":"budi@example.com","Subject":"Verifikasi email","Body":"token: abc"}`))
		testx.AssertNoError(t, NewEmails(mailer, nil, nil).SendQueued(t.Context(), task))
		testx.AssertEqual(t, len(mailer.sent), 1)
		testx.AssertEqual(t, mailer.sent[0], mail.Message{To: "budi@example.com", Subject: "Verifikasi email", Body: "token: abc"})
	})
	for name, payload := range map[string]string{"not JSON": `nope`, "no recipient": `{"Subject":"x","Body":"y"}`} {
		t.Run(name, func(t *testing.T) {
			mailer := &recordingMailer{}
			err := NewEmails(mailer, nil, nil).SendQueued(t.Context(), asynq.NewTask(TypeSendEmail, []byte(payload)))
			testx.AssertTrue(t, errors.Is(err, asynq.SkipRetry), "err = %v", err)
			testx.AssertEqual(t, err.Error(), "email:send: bad payload: skip retry for the task")
			testx.AssertEqual(t, len(mailer.sent), 0)
		})
	}
	t.Run("mailer fails: retried", func(t *testing.T) {
		err := NewEmails(&recordingMailer{err: errBoom}, nil, nil).SendQueued(t.Context(),
			asynq.NewTask(TypeSendEmail, []byte(`{"To":"budi@example.com"}`)))
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertFalse(t, errors.Is(err, asynq.SkipRetry))
		testx.AssertEqual(t, err.Error(), "send email: boom")
	})
}

// The worker reads the order when it sends: an order paid between
// checkout and a retried send gets no request to pay.
func TestEmails_OrderConfirmationReadsTheStatusAtSend(t *testing.T) {
	tests := []struct {
		name   string
		order  order.Order
		wantIn bool
	}{
		{name: "still pending", order: pendingOrder(), wantIn: true},
		{name: "paid since", order: testOrder()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mailer := &recordingMailer{}
			e := NewEmails(mailer, &fakeOrders{o: tt.order}, &fakeUsers{u: testBuyer()})
			err := e.OrderConfirmation(t.Context(), eventTask(t, TypeOrderConfirmationEmail))
			testx.AssertNoError(t, err)
			if len(mailer.sent) != 1 {
				t.Fatalf("sent %d emails, want 1", len(mailer.sent))
			}
			testx.AssertEqual(t, strings.Contains(mailer.sent[0].Body, payBefore), tt.wantIn, "body = %q", mailer.sent[0].Body)
		})
	}
}
