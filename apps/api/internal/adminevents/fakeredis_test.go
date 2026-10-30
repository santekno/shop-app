package adminevents_test

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

	"github.com/redis/go-redis/v9"
)

// pubsubRedis is a tiny in-process server that speaks the RESP2 pub/sub
// commands go-redis uses: SUBSCRIBE, UNSUBSCRIBE and PING; HELLO is
// refused like an old Redis, so go-redis falls back to RESP2, and anything
// else answers +OK. The test publishes with publish and cuts every
// subscriber's connection with drop.
type pubsubRedis struct {
	ln net.Listener

	mu              sync.Mutex
	subscribers     []net.Conn
	refuseSubscribe bool

	// subscribed receives the channel of each SUBSCRIBE it confirms.
	subscribed chan string
}

func newPubsubRedis(t *testing.T) *pubsubRedis {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	f := &pubsubRedis{ln: ln, subscribed: make(chan string, 16)}
	go f.serve()
	t.Cleanup(func() {
		_ = ln.Close()
		f.drop()
	})
	return f
}

// client is a go-redis client on f, closed when the test ends.
func (f *pubsubRedis) client(t *testing.T) *redis.Client {
	t.Helper()
	c := redis.NewClient(&redis.Options{Addr: f.ln.Addr().String(), MaxRetries: -1})
	t.Cleanup(func() { _ = c.Close() })
	return c
}

func (f *pubsubRedis) serve() {
	for {
		conn, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.handle(conn)
	}
}

func (f *pubsubRedis) handle(conn net.Conn) {
	r := bufio.NewReader(conn)
	for {
		args, err := readCommand(r)
		if err != nil {
			_ = conn.Close()
			return
		}
		f.mu.Lock()
		reply := f.reply(conn, args)
		_, err = io.WriteString(conn, reply)
		f.mu.Unlock()
		if err != nil {
			return
		}
		if strings.EqualFold(args[0], "SUBSCRIBE") && !strings.HasPrefix(reply, "-") {
			f.subscribed <- args[1]
		}
	}
}

// reply answers args; f.mu is held.
func (f *pubsubRedis) reply(conn net.Conn, args []string) string {
	switch strings.ToUpper(args[0]) {
	case "HELLO":
		return "-ERR unknown command 'HELLO'\r\n"
	case "SUBSCRIBE":
		if f.refuseSubscribe {
			return "-ERR subscriptions are off\r\n"
		}
		f.subscribers = append(f.subscribers, conn)
		return array(bulk("subscribe"), bulk(args[1]), ":1\r\n")
	case "UNSUBSCRIBE":
		return array(bulk("unsubscribe"), bulk(args[1]), ":0\r\n")
	case "PING":
		return array(bulk("pong"), bulk(""))
	default:
		return "+OK\r\n"
	}
}

// publish sends payload on channel to every subscriber, and returns how
// many there were.
func (f *pubsubRedis) publish(channel, payload string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.subscribers {
		_, _ = io.WriteString(c, array(bulk("message"), bulk(channel), bulk(payload)))
	}
	return len(f.subscribers)
}

// drop cuts every subscriber's connection, as a Redis restart would.
func (f *pubsubRedis) drop() {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.subscribers {
		_ = c.Close()
	}
	f.subscribers = nil
}

// waitSubscribed waits for the next confirmed SUBSCRIBE.
func (f *pubsubRedis) waitSubscribed(t *testing.T) string {
	t.Helper()
	select {
	case ch := <-f.subscribed:
		return ch
	case <-time.After(5 * time.Second):
		t.Fatal("no SUBSCRIBE reached the fake Redis")
		return ""
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

func bulk(s string) string { return "$" + strconv.Itoa(len(s)) + "\r\n" + s + "\r\n" }

func array(items ...string) string {
	return "*" + strconv.Itoa(len(items)) + "\r\n" + strings.Join(items, "")
}
