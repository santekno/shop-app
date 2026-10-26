//go:build integration

package integration_test

import (
	"bufio"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	gomail "github.com/santekno/shop-app/apps/api/internal/mail"
)

// fakeSMTP is an SMTP server on 127.0.0.1 that keeps every message it is
// given: the worker's SMTPMailer talks to it exactly as it talks to a real
// one (no STARTTLS, which the mailer allows only to this machine). With
// failing set it answers DATA with a temporary error, as a mail server
// that is down for maintenance does.
type fakeSMTP struct {
	ln      net.Listener
	failing atomic.Bool

	mu   sync.Mutex
	msgs []sentMail
}

// sentMail is one message the fake SMTP server accepted.
type sentMail struct {
	From, To, Subject, Body string
}

// startFakeSMTP listens on a free port until the test ends.
func startFakeSMTP(t *testing.T) *fakeSMTP {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeSMTP{ln: ln}
	go f.accept()
	t.Cleanup(func() { _ = ln.Close() })
	return f
}

// port is the port it listens on.
func (f *fakeSMTP) port() int { return f.ln.Addr().(*net.TCPAddr).Port }

// mailer is the worker's SMTP mailer pointed at f.
func (f *fakeSMTP) mailer() gomail.Mailer {
	return gomail.NewSMTPMailer(gomail.SMTPConfig{Host: "127.0.0.1", Port: f.port(), From: "GoShop <no-reply@goshop.test>", Timeout: 5 * time.Second})
}

// sent returns the messages to address to, in the order they came.
func (f *fakeSMTP) sent(to string) []sentMail {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []sentMail
	for _, m := range f.msgs {
		if m.To == to {
			out = append(out, m)
		}
	}
	return out
}

// total is how many messages f accepted.
func (f *fakeSMTP) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.msgs)
}

func (f *fakeSMTP) accept() {
	for {
		conn, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.session(conn)
	}
}

// session speaks just enough SMTP for net/smtp: EHLO, MAIL, RCPT, DATA,
// RSET, NOOP, QUIT.
func (f *fakeSMTP) session(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	r := bufio.NewReader(conn)
	say := func(s string) { _, _ = io.WriteString(conn, s+"\r\n") }
	say("220 fake.goshop.test ESMTP")
	var from, to string
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.ToUpper(strings.TrimSpace(line))
		switch {
		case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
			say("250-fake.goshop.test")
			say("250 8BITMIME")
		case strings.HasPrefix(cmd, "MAIL FROM:"):
			from = angleAddr(line)
			say("250 OK")
		case strings.HasPrefix(cmd, "RCPT TO:"):
			to = angleAddr(line)
			say("250 OK")
		case cmd == "DATA":
			if f.failing.Load() {
				say("451 4.3.0 try again later")
				continue
			}
			say("354 end with .")
			var data strings.Builder
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if l == ".\r\n" {
					break
				}
				data.WriteString(strings.TrimPrefix(l, "."))
			}
			f.store(from, to, data.String())
			say("250 OK queued")
		case cmd == "RSET", cmd == "NOOP":
			say("250 OK")
		case cmd == "QUIT":
			say("221 bye")
			return
		default:
			say("502 not implemented")
		}
	}
}

// angleAddr is the address between < and > of a MAIL or RCPT line,
// which may carry parameters after it (BODY=8BITMIME).
func angleAddr(line string) string {
	i, j := strings.Index(line, "<"), strings.Index(line, ">")
	if i < 0 || j < i {
		return ""
	}
	return line[i+1 : j]
}

// store decodes a message (subject and quoted-printable body) and keeps it.
func (f *fakeSMTP) store(from, to, raw string) {
	m := sentMail{From: from, To: to}
	if msg, err := mail.ReadMessage(strings.NewReader(raw)); err == nil {
		m.Subject, _ = new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
		body, _ := io.ReadAll(quotedprintable.NewReader(msg.Body))
		m.Body = strings.ReplaceAll(string(body), "\r\n", "\n")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.msgs = append(f.msgs, m)
}
