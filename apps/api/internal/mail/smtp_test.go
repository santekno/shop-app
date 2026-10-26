package mail

// Bab 6 artikel 08: SMTPMailer against a loopback SMTP server
// (fakesmtp_test.go).

import (
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"net/smtp"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

const testFrom = "GoShop <no-reply@goshop.example>"

var testMsg = Message{To: "budi@example.com", Subject: "Pembayaran ✓", Body: "Halo Budi,\nTotal: Rp117.000 ✓\n"}

// localMailer is a mailer for s, on 127.0.0.1 (a local server: no STARTTLS
// needed).
func localMailer(s *fakeSMTP, change func(cfg *SMTPConfig)) *SMTPMailer {
	cfg := SMTPConfig{Host: "127.0.0.1", Port: s.port(), From: testFrom, Timeout: 5 * time.Second}
	if change != nil {
		change(&cfg)
	}
	return NewSMTPMailer(cfg)
}

func TestSMTPMailer_Send(t *testing.T) {
	s := newFakeSMTP(t, nil)
	testx.AssertNoError(t, localMailer(s, nil).Send(t.Context(), testMsg))
	testx.AssertEqual(t, strings.Join(s.said(), " | "),
		"EHLO localhost | MAIL FROM:<no-reply@goshop.example> | RCPT TO:<budi@example.com> | DATA | QUIT")

	msg, err := netmail.ReadMessage(strings.NewReader(s.message()))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, msg.Header.Get("From"), testFrom)
	testx.AssertEqual(t, msg.Header.Get("To"), "budi@example.com")
	testx.AssertEqual(t, msg.Header.Get("Subject"), "=?utf-8?q?Pembayaran_=E2=9C=93?=", "Q-encoded")
	subject, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, subject, "Pembayaran ✓")
	date, err := msg.Header.Date()
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, time.Since(date) < time.Minute && time.Since(date) > -time.Minute, "date = %v", date)
	testx.AssertTrue(t, regexp.MustCompile(`^<[0-9a-f]{8}-[0-9a-f-]{27}@goshop\.example>$`).MatchString(msg.Header.Get("Message-ID")),
		"Message-ID = %q", msg.Header.Get("Message-ID"))
	testx.AssertEqual(t, msg.Header.Get("MIME-Version"), "1.0")
	testx.AssertEqual(t, msg.Header.Get("Content-Type"), "text/plain; charset=UTF-8")
	testx.AssertEqual(t, msg.Header.Get("Content-Transfer-Encoding"), "quoted-printable")
	testx.AssertContains(t, s.message(), "Total: Rp117.000 =E2=9C=93\r\n")
	body, err := io.ReadAll(quotedprintable.NewReader(msg.Body))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, string(body), "Halo Budi,\r\nTotal: Rp117.000 ✓\r\n")
}

// Each message gets its own Message-ID.
func TestSMTPMailer_Send_MessageIDIsUnique(t *testing.T) {
	s1, s2 := newFakeSMTP(t, nil), newFakeSMTP(t, nil)
	testx.AssertNoError(t, localMailer(s1, nil).Send(t.Context(), testMsg))
	testx.AssertNoError(t, localMailer(s2, nil).Send(t.Context(), testMsg))
	id := func(s *fakeSMTP) string {
		m, err := netmail.ReadMessage(strings.NewReader(s.message()))
		testx.AssertNoError(t, err)
		return m.Header.Get("Message-ID")
	}
	testx.AssertNotEqual(t, id(s1), id(s2))
}

// A line break in a header would let the value add headers of its own
// (a Bcc to anyone): refused before any connection.
func TestSMTPMailer_HeaderInjection(t *testing.T) {
	tests := map[string]struct {
		msg  Message
		from string
	}{
		"To with CRLF":    {msg: Message{To: "budi@example.com\r\nBcc: eve@example.com", Subject: "s"}, from: testFrom},
		"To with LF":      {msg: Message{To: "budi@example.com\nBcc: eve@example.com", Subject: "s"}, from: testFrom},
		"Subject with CR": {msg: Message{To: "budi@example.com", Subject: "Halo\rBcc: eve@example.com"}, from: testFrom},
		"Subject with LF": {msg: Message{To: "budi@example.com", Subject: "Halo\nBcc: eve@example.com"}, from: testFrom},
		"From with LF":    {msg: Message{To: "budi@example.com", Subject: "s"}, from: "GoShop <no-reply@goshop.example>\nBcc: eve@example.com"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			s := newFakeSMTP(t, nil)
			err := localMailer(s, func(cfg *SMTPConfig) { cfg.From = tt.from }).Send(t.Context(), tt.msg)
			testx.AssertTrue(t, errors.Is(err, ErrHeaderInjection), "err = %v", err)
			testx.AssertEqual(t, s.accepted.Load(), int32(0), "no connection is made")
		})
	}
}

// The server offers STARTTLS: the mailer upgrades before anything else
// (here the server fails the upgrade, so nothing is sent in clear text).
func TestSMTPMailer_StartTLSWhenOffered(t *testing.T) {
	s := newFakeSMTP(t, func(s *fakeSMTP) { s.extensions = []string{"STARTTLS", "AUTH PLAIN"} })
	err := localMailer(s, func(cfg *SMTPConfig) { cfg.Username, cfg.Password = "goshop", "s3cr3t-pass" }).Send(t.Context(), testMsg)
	testx.AssertError(t, err)
	testx.AssertEqual(t, err.Error(), `mail: starttls: 454 "4.7.0 TLS not available"`)
	testx.AssertEqual(t, strings.Join(s.said(), " | "), "EHLO localhost | STARTTLS", "no AUTH, no MAIL in clear text")
}

// secure is tested on its own for a host that is not this machine: the
// test cannot reach a remote server, so the client is on a loopback
// connection that claims to be smtp.example.com.
func TestSMTPMailer_Secure(t *testing.T) {
	client := func(t *testing.T, s *fakeSMTP, host string) *smtp.Client {
		t.Helper()
		conn, err := (&net.Dialer{}).DialContext(t.Context(), "tcp", s.ln.Addr().String())
		testx.AssertNoError(t, err)
		c, err := smtp.NewClient(conn, host)
		testx.AssertNoError(t, err)
		t.Cleanup(func() { _ = c.Close() })
		return c
	}
	t.Run("a remote server without STARTTLS is refused", func(t *testing.T) {
		s := newFakeSMTP(t, nil)
		m := NewSMTPMailer(SMTPConfig{Host: "smtp.example.com", Port: 587, From: testFrom})
		err := m.secure(client(t, s, "smtp.example.com"))
		testx.AssertError(t, err)
		testx.AssertEqual(t, err.Error(), "mail: the SMTP server offers no STARTTLS; refusing to send in clear text")
	})
	for _, host := range []string{"localhost", "127.0.0.1", "::1"} {
		t.Run("a local server without STARTTLS: "+host, func(t *testing.T) {
			s := newFakeSMTP(t, nil)
			m := NewSMTPMailer(SMTPConfig{Host: host, Port: 1025, From: testFrom})
			testx.AssertNoError(t, m.secure(client(t, s, host)))
		})
	}
	t.Run("a remote server with STARTTLS: upgraded", func(t *testing.T) {
		s := newFakeSMTP(t, func(s *fakeSMTP) { s.extensions = []string{"STARTTLS"} })
		m := NewSMTPMailer(SMTPConfig{Host: "smtp.example.com", Port: 587, From: testFrom})
		err := m.secure(client(t, s, "smtp.example.com"))
		testx.AssertEqual(t, err.Error(), `mail: starttls: 454 "4.7.0 TLS not available"`)
		testx.AssertEqual(t, s.said()[len(s.said())-1], "STARTTLS")
	})
	t.Run("port 465 is TLS already", func(t *testing.T) {
		m := NewSMTPMailer(SMTPConfig{Host: "smtp.example.com", Port: 465, From: testFrom})
		testx.AssertNoError(t, m.secure(nil), "no command on the connection")
	})
}

func TestSMTPMailer_TLSConfig(t *testing.T) {
	c := NewSMTPMailer(SMTPConfig{Host: "smtp.example.com"}).tlsConfig()
	testx.AssertEqual(t, c.ServerName, "smtp.example.com")
	testx.AssertEqual(t, c.MinVersion, uint16(0x0303), "TLS 1.2 at least")
	testx.AssertFalse(t, c.InsecureSkipVerify)
}

func TestSMTPMailer_Auth(t *testing.T) {
	const password = "s3cr3t-pass"
	withAuth := func(cfg *SMTPConfig) { cfg.Username, cfg.Password = "goshop", password }

	t.Run("PLAIN with the credentials, then the message", func(t *testing.T) {
		s := newFakeSMTP(t, func(s *fakeSMTP) { s.extensions = []string{"AUTH PLAIN"} })
		testx.AssertNoError(t, localMailer(s, withAuth).Send(t.Context(), testMsg))
		said := s.said()
		testx.AssertEqual(t, len(said), 6, "transcript %v", said)
		testx.AssertEqual(t, said[1], "AUTH PLAIN "+base64.StdEncoding.EncodeToString([]byte("\x00goshop\x00"+password)))
		testx.AssertEqual(t, said[2], "MAIL FROM:<no-reply@goshop.example>")
	})
	t.Run("no username: no AUTH", func(t *testing.T) {
		s := newFakeSMTP(t, func(s *fakeSMTP) { s.extensions = []string{"AUTH PLAIN"} })
		testx.AssertNoError(t, localMailer(s, nil).Send(t.Context(), testMsg))
		for _, line := range s.said() {
			testx.AssertFalse(t, strings.HasPrefix(line, "AUTH"), "transcript %v", s.said())
		}
	})
	t.Run("rejected: an error without the password", func(t *testing.T) {
		s := newFakeSMTP(t, func(s *fakeSMTP) {
			s.extensions = []string{"AUTH PLAIN"}
			s.replies["AUTH"] = "535 5.7.8 authentication failed"
		})
		err := localMailer(s, withAuth).Send(t.Context(), testMsg)
		testx.AssertError(t, err)
		testx.AssertEqual(t, err.Error(), `mail: authenticate: 535 "5.7.8 authentication failed"`)
		testx.AssertFalse(t, strings.Contains(err.Error(), password), "the password leaks")
		testx.AssertFalse(t, strings.Contains(err.Error(), base64.StdEncoding.EncodeToString([]byte("\x00goshop\x00"+password))))
		for _, line := range s.said() {
			testx.AssertFalse(t, strings.HasPrefix(line, "MAIL"), "sent after a failed AUTH")
		}
	})
}

func TestSMTPMailer_ServerErrors(t *testing.T) {
	tests := []struct {
		verb, reply, want string
	}{
		{"MAIL", "550 5.7.1 sender rejected", `mail: MAIL FROM: 550 "5.7.1 sender rejected"`},
		{"RCPT", "550 5.1.1 no such user", `mail: RCPT TO: 550 "5.1.1 no such user"`},
		{"DATA", "554 5.3.0 no thanks", `mail: DATA: 554 "5.3.0 no thanks"`},
		{".", "552 5.3.4 message too big", `mail: send message: 552 "5.3.4 message too big"`},
		{"QUIT", "500 5.0.0 nope", `mail: quit: 500 "5.0.0 nope"`},
	}
	for _, tt := range tests {
		t.Run(tt.verb, func(t *testing.T) {
			s := newFakeSMTP(t, func(s *fakeSMTP) { s.replies[tt.verb] = tt.reply })
			err := localMailer(s, nil).Send(t.Context(), testMsg)
			testx.AssertError(t, err)
			testx.AssertEqual(t, err.Error(), tt.want)
		})
	}
}

func TestSMTPMailer_SenderWithoutAddress(t *testing.T) {
	s := newFakeSMTP(t, nil)
	err := localMailer(s, func(cfg *SMTPConfig) { cfg.From = "GoShop" }).Send(t.Context(), testMsg)
	testx.AssertError(t, err)
	testx.AssertEqual(t, err.Error(), `mail: sender "GoShop" has no address`)
	testx.AssertEqual(t, strings.Join(s.said(), " | "), "EHLO localhost", "no MAIL without a sender address")
}

func TestSMTPMailer_Dial(t *testing.T) {
	t.Run("connection refused", func(t *testing.T) {
		ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
		testx.AssertNoError(t, err)
		port := ln.Addr().(*net.TCPAddr).Port
		testx.AssertNoError(t, ln.Close())
		m := NewSMTPMailer(SMTPConfig{Host: "127.0.0.1", Port: port, From: testFrom, Timeout: 5 * time.Second})
		err = m.Send(t.Context(), testMsg)
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "mail: connect to 127.0.0.1:"+strconv.Itoa(port)+": "), "err = %v", err)
	})
	t.Run("the server refuses the session", func(t *testing.T) {
		s := newFakeSMTP(t, func(s *fakeSMTP) { s.greeting = "554 5.3.2 busy" })
		err := localMailer(s, nil).Send(t.Context(), testMsg)
		testx.AssertError(t, err)
		testx.AssertEqual(t, err.Error(), "mail: greet 127.0.0.1:"+strconv.Itoa(s.port())+`: 554 "5.3.2 busy"`)
	})
	t.Run("a server that never answers: the timeout ends the send", func(t *testing.T) {
		s := newFakeSMTP(t, func(s *fakeSMTP) { s.silent = true })
		start := time.Now()
		err := localMailer(s, func(cfg *SMTPConfig) { cfg.Timeout = 200 * time.Millisecond }).Send(t.Context(), testMsg)
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "mail: greet "), "err = %v", err)
		var netErr net.Error
		testx.AssertTrue(t, errors.As(err, &netErr) && netErr.Timeout(), "a timeout: %v", err)
		testx.AssertTrue(t, time.Since(start) < 3*time.Second, "took %v", time.Since(start))
	})
}

func TestNewSMTPMailer_Timeout(t *testing.T) {
	tests := []struct {
		in, want time.Duration
	}{
		{0, 30 * time.Second},
		{-time.Second, 30 * time.Second},
		{5 * time.Second, 5 * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.in.String(), func(t *testing.T) {
			testx.AssertEqual(t, NewSMTPMailer(SMTPConfig{Timeout: tt.in}).cfg.Timeout, tt.want)
		})
	}
}

func TestCompose(t *testing.T) {
	m := NewSMTPMailer(SMTPConfig{From: testFrom})
	out := string(m.compose(Message{To: "budi@example.com", Subject: "Halo", Body: "baris satu\nbaris dua\n"}))
	testx.AssertEqual(t, strings.Count(out, "\n"), strings.Count(out, "\r\n"), "every line ends in CRLF: %q", out)
	_, body, ok := strings.Cut(out, "\r\n\r\n")
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, body, "baris satu\r\nbaris dua\r\n")
	testx.AssertContains(t, out, "Subject: Halo\r\n", "plain ASCII is left as it is")

	t.Run("a From without a domain: Message-ID on goshop", func(t *testing.T) {
		out := string(NewSMTPMailer(SMTPConfig{From: "GoShop"}).compose(Message{To: "a@b.c"}))
		testx.AssertTrue(t, regexp.MustCompile(`\r\nMessage-ID: <[0-9a-f-]{36}@goshop>\r\n`).MatchString(out), "out = %q", out)
	})
}

func TestEnvelopeAddress(t *testing.T) {
	tests := []struct {
		from, want, err string
	}{
		{from: "GoShop <no-reply@goshop.example>", want: "no-reply@goshop.example"},
		{from: "no-reply@goshop.example", want: "no-reply@goshop.example"},
		{from: `"Toko, Bagus" <toko@example.com>`, want: "toko@example.com"},
		{from: "GoShop", err: `mail: sender "GoShop" has no address`},
		{from: "<>", err: `mail: sender "" has no address`},
		{from: "", err: `mail: sender "" has no address`},
	}
	for _, tt := range tests {
		t.Run(tt.from, func(t *testing.T) {
			got, err := envelopeAddress(tt.from)
			if tt.err != "" {
				testx.AssertError(t, err)
				testx.AssertEqual(t, err.Error(), tt.err)
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, got, tt.want)
		})
	}
}

func TestIsLocal(t *testing.T) {
	tests := map[string]bool{
		"localhost":        true,
		"127.0.0.1":        true,
		"127.0.0.53":       true,
		"::1":              true,
		"10.0.0.1":         false,
		"192.168.1.10":     false,
		"example.com":      false,
		"localhost.evil":   false,
		"smtp.example.com": false,
		"":                 false,
	}
	for host, want := range tests {
		t.Run(host, func(t *testing.T) {
			testx.AssertEqual(t, isLocal(host), want)
		})
	}
}
