package mail

// A loopback SMTP server for the SMTPMailer tests (Bab 6 artikel 08): it
// speaks just enough SMTP for net/smtp, records what the client said, and
// answers each verb as a test scripts it.

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeSMTP struct {
	ln       net.Listener
	accepted atomic.Int32

	// greeting replaces "220 fake ESMTP"; extensions are advertised after
	// EHLO ("STARTTLS", "AUTH PLAIN"); replies replaces the reply to a verb
	// ("MAIL", "RCPT", "DATA", ".", "QUIT", "STARTTLS", "AUTH"); silent
	// sends no greeting at all.
	greeting   string
	extensions []string
	replies    map[string]string
	silent     bool

	mu         sync.Mutex
	transcript []string
	data       string
}

// newFakeSMTP starts a server on 127.0.0.1; change it before the first
// connection.
func newFakeSMTP(t *testing.T, change func(s *fakeSMTP)) *fakeSMTP {
	t.Helper()
	ln, err := (&net.ListenConfig{}).Listen(t.Context(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &fakeSMTP{ln: ln, replies: map[string]string{}}
	if change != nil {
		change(s)
	}
	var wg sync.WaitGroup
	t.Cleanup(func() {
		_ = ln.Close()
		wg.Wait()
	})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			s.accepted.Add(1)
			wg.Add(1)
			go func() {
				defer wg.Done()
				s.serve(conn)
			}()
		}
	}()
	return s
}

func (s *fakeSMTP) port() int { return s.ln.Addr().(*net.TCPAddr).Port }

func (s *fakeSMTP) reply(verb, fallback string) string {
	if r, ok := s.replies[verb]; ok {
		return r
	}
	return fallback
}

func (s *fakeSMTP) record(line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.transcript = append(s.transcript, line)
}

// said returns the client's lines, in order (the message itself excluded).
func (s *fakeSMTP) said() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.transcript...)
}

// message returns the DATA the client sent, dot-unstuffed, CRLF kept.
func (s *fakeSMTP) message() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data
}

func (s *fakeSMTP) serve(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	if s.silent {
		buf := make([]byte, 1)
		_, _ = conn.Read(buf) // until the client hangs up
		return
	}
	r := bufio.NewReader(conn)
	w := func(line string) { _, _ = fmt.Fprintf(conn, "%s\r\n", line) }
	greeting := s.greeting
	if greeting == "" {
		greeting = "220 fake ESMTP"
	}
	w(greeting)
	if !strings.HasPrefix(greeting, "220") {
		return
	}
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		s.record(line)
		verb, _, _ := strings.Cut(strings.ToUpper(line), " ")
		verb, _, _ = strings.Cut(verb, ":")
		switch verb {
		case "EHLO":
			lines := append([]string{"fake"}, s.extensions...)
			for i, l := range lines {
				sep := "-"
				if i == len(lines)-1 {
					sep = " "
				}
				w("250" + sep + l)
			}
		case "HELO", "RSET", "NOOP":
			w("250 ok")
		case "STARTTLS":
			w(s.reply("STARTTLS", "454 4.7.0 TLS not available"))
		case "AUTH":
			w(s.reply("AUTH", "235 2.7.0 authenticated"))
		case "MAIL":
			w(s.reply("MAIL", "250 2.1.0 ok"))
		case "RCPT":
			w(s.reply("RCPT", "250 2.1.5 ok"))
		case "DATA":
			reply := s.reply("DATA", "354 end with .")
			w(reply)
			if !strings.HasPrefix(reply, "354") {
				continue
			}
			var data []string
			for {
				l, err := r.ReadString('\n')
				if err != nil {
					return
				}
				l = strings.TrimSuffix(l, "\r\n")
				if l == "." {
					break
				}
				data = append(data, strings.TrimPrefix(l, "."))
			}
			s.mu.Lock()
			s.data = strings.Join(data, "\r\n") + "\r\n"
			s.mu.Unlock()
			w(s.reply(".", "250 2.0.0 queued"))
		case "QUIT":
			w(s.reply("QUIT", "221 2.0.0 bye"))
			return
		default:
			w("502 5.5.2 command not recognized")
		}
	}
}
