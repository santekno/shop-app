package worker

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
)

// respServer is a tiny loopback server speaking enough RESP2 for Run's
// `dead-tasks` path, which opens its own Redis client from REDIS_URL
// (redisconn.Open pings first): PING, SISMEMBER (the queue exists) and
// Asynq's Lua scripts (an empty archive). HELLO is refused, as an old
// Redis would, so go-redis falls back to RESP2. No Redis is needed.
type respServer struct {
	ln net.Listener

	mu       sync.Mutex
	commands []string
	// refuse answers every command but HELLO with an error: Redis
	// "unreachable" at once, without go-redis's dial retries.
	refuse bool
}

func newRESPServer(t *testing.T) *respServer {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &respServer{ln: ln}
	go s.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return s
}

func (s *respServer) url() string { return "redis://" + s.ln.Addr().String() + "/0" }

func (s *respServer) serve() {
	for {
		conn, err := s.ln.Accept()
		if err != nil {
			return
		}
		go s.handle(conn)
	}
}

func (s *respServer) handle(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	r := bufio.NewReader(conn)
	for {
		args, err := readRESPCommand(r)
		if err != nil {
			return
		}
		if _, err := io.WriteString(conn, s.reply(args)); err != nil {
			return
		}
	}
}

func readRESPCommand(r *bufio.Reader) ([]string, error) {
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

func (s *respServer) reply(args []string) string {
	if len(args) == 0 {
		return "-ERR empty command\r\n"
	}
	cmd := strings.ToUpper(args[0])
	s.mu.Lock()
	s.commands = append(s.commands, cmd)
	refuse := s.refuse
	s.mu.Unlock()
	if refuse && cmd != "HELLO" {
		return "-ERR refused\r\n"
	}
	switch cmd {
	case "HELLO":
		return "-ERR unknown command 'HELLO'\r\n"
	case "PING":
		return "+PONG\r\n"
	case "SISMEMBER":
		return ":1\r\n"
	case "EVALSHA", "EVAL":
		return "*0\r\n"
	default:
		return "+OK\r\n" // CLIENT SETINFO and friends
	}
}

// sent reports whether a command called name reached the server.
func (s *respServer) sent(name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.commands {
		if c == name {
			return true
		}
	}
	return false
}
