package app_test

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeRedis is a tiny in-process server that speaks enough RESP2 for the
// adapters: PING, GET, SET (with PX/EX/NX), DEL, INCR, EXPIRE and PTTL,
// plus SUBSCRIBE (confirmed, nothing is ever delivered) and PUBLISH
// (recorded, nobody listening) for the admin feed.
// It listens on loopback so go-redis talks to it exactly as to Redis, but
// no Redis is needed. Everything else (HELLO, CLIENT ...) answers like an
// old Redis would, so go-redis falls back to RESP2.
type fakeRedis struct {
	ln net.Listener

	mu       sync.Mutex
	values   map[string]string
	ttls     map[string]time.Duration
	commands []string
	fail     bool // answer every data command with -ERR boom (unused here)
}

func newFakeRedis(t *testing.T) *fakeRedis {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	f := &fakeRedis{ln: ln, values: map[string]string{}, ttls: map[string]time.Duration{}}
	go f.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return f
}

func (f *fakeRedis) addr() string { return f.ln.Addr().String() }

func (f *fakeRedis) serve() {
	for {
		conn, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.handle(conn)
	}
}

func (f *fakeRedis) handle(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	r := bufio.NewReader(conn)
	for {
		args, err := readCommand(r)
		if err != nil {
			return
		}
		if _, err := io.WriteString(conn, f.reply(args)); err != nil {
			return
		}
	}
}

func readCommand(r *bufio.Reader) ([]string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("read command: %w", err)
	}
	n, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "*")))
	if err != nil {
		return nil, fmt.Errorf("bad array header %q", line)
	}
	args := make([]string, 0, n)
	for range n {
		header, err := r.ReadString('\n')
		if err != nil {
			return nil, fmt.Errorf("read argument: %w", err)
		}
		size, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(header, "$")))
		if err != nil {
			return nil, fmt.Errorf("bad bulk header %q", header)
		}
		buf := make([]byte, size+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, fmt.Errorf("read argument: %w", err)
		}
		args = append(args, string(buf[:size]))
	}
	return args, nil
}

func (f *fakeRedis) reply(args []string) string {
	if len(args) == 0 {
		return "-ERR empty command\r\n"
	}
	cmd := strings.ToUpper(args[0])
	switch cmd {
	case "HELLO":
		return "-ERR unknown command 'HELLO'\r\n"
	case "SUBSCRIBE":
		return "*3\r\n" + bulk("subscribe") + bulk(args[1]) + ":1\r\n"
	case "PING", "GET", "SET", "DEL", "INCR", "EXPIRE", "PTTL", "SETNX", "PUBLISH":
	default:
		return "+OK\r\n" // CLIENT SETINFO and friends
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands = append(f.commands, strings.Join(append([]string{cmd}, args[1:]...), " "))
	if f.fail {
		return "-ERR boom\r\n"
	}
	switch cmd {
	case "PING":
		return "+PONG\r\n"
	case "PUBLISH":
		return ":0\r\n"
	case "GET":
		v, ok := f.values[args[1]]
		if !ok {
			return "$-1\r\n"
		}
		return bulk(v)
	case "SET":
		key, nx := args[1], false
		var ttl time.Duration
		for i := 3; i < len(args); i++ {
			switch strings.ToUpper(args[i]) {
			case "NX":
				nx = true
			case "PX":
				ms, _ := strconv.Atoi(args[i+1])
				ttl = time.Duration(ms) * time.Millisecond
				i++
			case "EX":
				s, _ := strconv.Atoi(args[i+1])
				ttl = time.Duration(s) * time.Second
				i++
			}
		}
		if _, exists := f.values[key]; nx && exists {
			return "$-1\r\n"
		}
		f.values[key], f.ttls[key] = args[2], ttl
		return "+OK\r\n"
	case "SETNX":
		if _, exists := f.values[args[1]]; exists {
			return ":0\r\n"
		}
		f.values[args[1]] = args[2]
		return ":1\r\n"
	case "DEL":
		n := 0
		for _, k := range args[1:] {
			if _, ok := f.values[k]; ok {
				delete(f.values, k)
				n++
			}
		}
		return ":" + strconv.Itoa(n) + "\r\n"
	case "INCR":
		n, _ := strconv.Atoi(f.values[args[1]])
		n++
		f.values[args[1]] = strconv.Itoa(n)
		return ":" + strconv.Itoa(n) + "\r\n"
	case "EXPIRE":
		s, _ := strconv.Atoi(args[2])
		f.ttls[args[1]] = time.Duration(s) * time.Second
		return ":1\r\n"
	default: // PTTL
		if _, ok := f.values[args[1]]; !ok {
			return ":-2\r\n"
		}
		return ":" + strconv.FormatInt(f.ttls[args[1]].Milliseconds(), 10) + "\r\n"
	}
}

func bulk(s string) string { return "$" + strconv.Itoa(len(s)) + "\r\n" + s + "\r\n" }
