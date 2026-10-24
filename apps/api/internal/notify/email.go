package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// OrderReader reads any order; *order.PostgresRepository is one.
type OrderReader interface {
	GetAny(ctx context.Context, id string) (order.Order, error)
}

// UserReader reads an account; *user.PostgresRepository is one. A deleted
// account is user.ErrNotFound.
type UserReader interface {
	Get(ctx context.Context, id string) (user.User, error)
}

// Emails sends the worker's emails.
type Emails struct {
	mailer mail.Mailer
	orders OrderReader
	users  UserReader
}

// NewEmails returns the email handlers.
func NewEmails(mailer mail.Mailer, orders OrderReader, users UserReader) *Emails {
	return &Emails{mailer: mailer, orders: orders, users: users}
}

// SendQueued handles TypeSendEmail: a message the API queued.
func (e *Emails) SendQueued(ctx context.Context, t *asynq.Task) error {
	var m mail.Message
	if err := json.Unmarshal(t.Payload(), &m); err != nil || m.To == "" {
		return fmt.Errorf("%s: bad payload: %w", t.Type(), asynq.SkipRetry)
	}
	if err := e.mailer.Send(ctx, m); err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}

// OrderConfirmation handles TypeOrderConfirmationEmail (order.created).
func (e *Emails) OrderConfirmation(ctx context.Context, t *asynq.Task) error {
	return e.sendOrderEmail(ctx, t, orderConfirmation)
}

// PaymentReceived handles TypePaymentReceivedEmail (order.paid).
func (e *Emails) PaymentReceived(ctx context.Context, t *asynq.Task) error {
	return e.sendOrderEmail(ctx, t, paymentReceived)
}

// OrderShipped handles TypeOrderShippedEmail (order.shipped).
func (e *Emails) OrderShipped(ctx context.Context, t *asynq.Task) error {
	return e.sendOrderEmail(ctx, t, orderShipped)
}

// sendOrderEmail emails the buyer of the event's order with tmpl, from
// the order as it is now. An order that does not exist is a permanent
// failure; a deleted account gets no email.
func (e *Emails) sendOrderEmail(ctx context.Context, t *asynq.Task, tmpl *template.Template) error {
	ev, err := decodeEvent(t)
	if err != nil {
		return err
	}
	o, err := e.orders.GetAny(ctx, ev.AggregateID)
	if errors.Is(err, order.ErrNotFound) {
		return fmt.Errorf("%s: order %s: %w", t.Type(), ev.AggregateID, asynq.SkipRetry)
	}
	if err != nil {
		return fmt.Errorf("%s: %w", t.Type(), err)
	}
	buyer, err := e.users.Get(ctx, o.UserID)
	if errors.Is(err, user.ErrNotFound) {
		logx.FromContext(ctx).Info("no email: the buyer's account was deleted", "order_id", o.ID, "task", t.Type())
		return nil
	}
	if err != nil {
		return fmt.Errorf("%s: %w", t.Type(), err)
	}
	m, err := render(tmpl, buyer, o)
	if err != nil {
		return fmt.Errorf("%s: %w", t.Type(), err)
	}
	if err := e.mailer.Send(ctx, m); err != nil {
		return fmt.Errorf("%s: %w", t.Type(), err)
	}
	return nil
}

// emailData is what the templates see. Nothing secret: no token, no link
// that logs anyone in.
type emailData struct {
	Name  string
	Order order.Order
	// AwaitingPayment is whether the order still waits for payment. An
	// email is rendered when it is sent, possibly hours after its event,
	// so the order confirmation asks for payment only while it is due.
	AwaitingPayment bool
}

// render executes tmpl's "subject" and "body" for buyer and o.
func render(tmpl *template.Template, buyer user.User, o order.Order) (mail.Message, error) {
	data := emailData{Name: buyer.Name, Order: o, AwaitingPayment: o.Status == order.StatusPendingPayment}
	var subject, body strings.Builder
	if err := tmpl.ExecuteTemplate(&subject, "subject", data); err != nil {
		return mail.Message{}, fmt.Errorf("render subject: %w", err)
	}
	if err := tmpl.ExecuteTemplate(&body, "body", data); err != nil {
		return mail.Message{}, fmt.Errorf("render body: %w", err)
	}
	return mail.Message{To: buyer.Email, Subject: strings.TrimSpace(subject.String()), Body: body.String()}, nil
}

// wib is Western Indonesia Time, the zone of every time in an email.
var wib = time.FixedZone("WIB", 7*60*60)

var funcs = template.FuncMap{
	// rupiah writes 117000 as Rp117.000.
	"rupiah": func(amount int64) string {
		s := strconv.FormatInt(amount, 10)
		var b strings.Builder
		for i, r := range s {
			if i > 0 && (len(s)-i)%3 == 0 {
				b.WriteByte('.')
			}
			b.WriteRune(r)
		}
		return "Rp" + b.String()
	},
	"wib":   func(t time.Time) string { return t.In(wib).Format("02-01-2006 15:04") + " WIB" },
	"upper": strings.ToUpper,
}

// The templates, in Indonesian like the storefront.
var (
	orderConfirmation = template.Must(template.New("order-confirmation").Funcs(funcs).Parse(`
{{define "subject"}}Pesanan {{.Order.Code}} diterima{{end}}
{{define "body"}}Halo {{.Name}},

Terima kasih, pesanan {{.Order.Code}} sudah kami terima.
{{range .Order.Items}}
- {{.ProductName}} ({{.VariantName}}) x{{.Quantity}}: {{rupiah .LineTotal}}{{end}}

Subtotal: {{rupiah .Order.Totals.Subtotal}}{{if .Order.Totals.Discount}}
Diskon: -{{rupiah .Order.Totals.Discount}}{{end}}
Ongkos kirim ({{upper .Order.Courier}} {{.Order.CourierService}}): {{rupiah .Order.Totals.ShippingFee}}
Total: {{rupiah .Order.Totals.Total}}
{{if .AwaitingPayment}}
Selesaikan pembayaran sebelum {{wib .Order.PaymentExpiresAt}} dari halaman pesanan di aplikasi GoShop. Lewat dari itu, pesanan dibatalkan otomatis.
{{end}}
Salam,
GoShop
{{end}}`))

	paymentReceived = template.Must(template.New("payment-received").Funcs(funcs).Parse(`
{{define "subject"}}Pembayaran pesanan {{.Order.Code}} diterima{{end}}
{{define "body"}}Halo {{.Name}},

Pembayaran {{rupiah .Order.Totals.Total}} untuk pesanan {{.Order.Code}} sudah kami terima{{if .Order.PaidAt}} pada {{wib .Order.PaidAt.UTC}}{{end}}. Pesananmu segera kami siapkan dan kirim ke:

{{.Order.Address.Recipient}}
{{.Order.Address.Street}}, {{.Order.Address.City}}, {{.Order.Address.Province}} {{.Order.Address.PostalCode}}

Salam,
GoShop
{{end}}`))

	orderShipped = template.Must(template.New("order-shipped").Funcs(funcs).Parse(`
{{define "subject"}}Pesanan {{.Order.Code}} dikirim{{end}}
{{define "body"}}Halo {{.Name}},

Pesanan {{.Order.Code}} sudah kami serahkan ke kurir {{upper .Order.Courier}} {{.Order.CourierService}}.{{if .Order.TrackingNumber}}
Nomor resi: {{.Order.TrackingNumber}}{{end}}

Setelah paket sampai, konfirmasi penerimaan dari halaman pesanan di aplikasi GoShop.

Salam,
GoShop
{{end}}`))
)
