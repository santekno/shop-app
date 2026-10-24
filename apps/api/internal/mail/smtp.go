package mail

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/santekno/sdk/uuidx"
)

// SMTPConfig is an SMTP server to send through.
type SMTPConfig struct {
	Host string
	// Port is 587 (STARTTLS) or 465 (TLS from the first byte), usually.
	Port     int
	Username string
	// Password is a secret: never logged, never in an error.
	Password string
	// From is the sender, e.g. "GoShop <no-reply@goshop.example>".
	From string
	// Timeout bounds one whole send.
	Timeout time.Duration
}

// SMTPMailer sends email through an SMTP server (ADR 0007). It requires
// TLS (STARTTLS, or port 465) except to a server on this machine, such as
// a local Mailpit, so a password never crosses a network in clear text.
type SMTPMailer struct {
	cfg SMTPConfig
}

// NewSMTPMailer returns a mailer for cfg; a zero Timeout means 30 seconds.
func NewSMTPMailer(cfg SMTPConfig) *SMTPMailer {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	return &SMTPMailer{cfg: cfg}
}

// ErrHeaderInjection means a recipient, sender or subject holds a line
// break, which would let it add headers of its own.
var ErrHeaderInjection = errors.New("mail: line break in a header")

// Send implements Mailer.
func (m *SMTPMailer) Send(ctx context.Context, msg Message) error {
	for _, h := range []string{msg.To, msg.Subject, m.cfg.From} {
		if strings.ContainsAny(h, "\r\n") {
			return ErrHeaderInjection
		}
	}
	ctx, cancel := context.WithTimeout(ctx, m.cfg.Timeout)
	defer cancel()
	c, err := m.dial(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = c.Close() }()
	if err := m.secure(c); err != nil {
		return err
	}
	if m.cfg.Username != "" {
		// PlainAuth itself refuses to send the password without TLS,
		// except to localhost.
		if err := c.Auth(smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)); err != nil {
			return fmt.Errorf("mail: authenticate: %w", err)
		}
	}
	return m.deliver(c, msg)
}

// dial connects, with TLS from the first byte on port 465.
func (m *SMTPMailer) dial(ctx context.Context) (*smtp.Client, error) {
	addr := net.JoinHostPort(m.cfg.Host, strconv.Itoa(m.cfg.Port))
	var conn net.Conn
	var err error
	if m.cfg.Port == 465 {
		conn, err = (&tls.Dialer{Config: m.tlsConfig()}).DialContext(ctx, "tcp", addr)
	} else {
		conn, err = (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return nil, fmt.Errorf("mail: connect to %s: %w", addr, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline) // net/smtp takes no context
	}
	c, err := smtp.NewClient(conn, m.cfg.Host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("mail: greet %s: %w", addr, err)
	}
	return c, nil
}

// secure upgrades the connection with STARTTLS, which is required except
// on port 465 (already TLS) and to a server on this machine.
func (m *SMTPMailer) secure(c *smtp.Client) error {
	if m.cfg.Port == 465 {
		return nil
	}
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(m.tlsConfig()); err != nil {
			return fmt.Errorf("mail: starttls: %w", err)
		}
		return nil
	}
	if isLocal(m.cfg.Host) {
		return nil
	}
	return errors.New("mail: the SMTP server offers no STARTTLS; refusing to send in clear text")
}

func (m *SMTPMailer) tlsConfig() *tls.Config {
	return &tls.Config{ServerName: m.cfg.Host, MinVersion: tls.VersionTLS12}
}

// deliver sends one message on an open session.
func (m *SMTPMailer) deliver(c *smtp.Client, msg Message) error {
	from, err := envelopeAddress(m.cfg.From)
	if err != nil {
		return err
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("mail: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(msg.To); err != nil {
		return fmt.Errorf("mail: RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err := w.Write(m.compose(msg)); err != nil {
		_ = w.Close()
		return fmt.Errorf("mail: write message: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: send message: %w", err)
	}
	if err := c.Quit(); err != nil {
		return fmt.Errorf("mail: quit: %w", err)
	}
	return nil
}

// compose is the message as RFC 5322 text: plain UTF-8, quoted-printable,
// the subject encoded so it may hold any character.
func (m *SMTPMailer) compose(msg Message) []byte {
	var b bytes.Buffer
	host := "goshop"
	if at := strings.LastIndex(m.cfg.From, "@"); at >= 0 {
		host = strings.Trim(m.cfg.From[at+1:], "> ")
	}
	fmt.Fprintf(&b, "From: %s\r\n", m.cfg.From)
	fmt.Fprintf(&b, "To: %s\r\n", msg.To)
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", msg.Subject))
	fmt.Fprintf(&b, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	fmt.Fprintf(&b, "Message-ID: <%s@%s>\r\n", uuidx.NewV7(), host)
	b.WriteString("MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n")
	qp := quotedprintable.NewWriter(&b)
	_, _ = qp.Write([]byte(strings.ReplaceAll(msg.Body, "\n", "\r\n")))
	_ = qp.Close()
	return b.Bytes()
}

// envelopeAddress is the bare address of a From such as
// "GoShop <no-reply@goshop.example>".
func envelopeAddress(from string) (string, error) {
	if i, j := strings.LastIndex(from, "<"), strings.LastIndex(from, ">"); i >= 0 && j > i {
		from = from[i+1 : j]
	}
	if !strings.Contains(from, "@") {
		return "", fmt.Errorf("mail: sender %q has no address", from)
	}
	return from, nil
}

func isLocal(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
