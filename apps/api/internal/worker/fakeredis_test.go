package worker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// fakeRedis is a go-redis client whose hook answers every command in the
// test's own process: nothing is dialled, no Redis is needed. Asynq's
// server, scheduler, client and inspector all accept such a client
// (asynq.New…FromRedisClient), so the worker's Asynq wiring runs against
// it unchanged.
//
// Every command gets a benign answer (PING: PONG, SISMEMBER: true, a Lua
// script: 1, a read: nil), except Asynq's dequeue script, which hands out
// the messages queued with enqueue, one per call, and then says the queue
// is empty. A test steers any other command with answer.
type fakeRedis struct {
	mu       sync.Mutex
	calls    [][]any
	messages [][]byte
	// answer, when set and returning true, has answered cmd itself.
	answer func(cmd redis.Cmder) bool
}

// newFakeRedis returns a client on f, closed when the test ends.
func newFakeRedis(t *testing.T, f *fakeRedis) *redis.Client {
	t.Helper()
	c := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1})
	c.AddHook(f)
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// enqueue queues an encoded task message for Asynq's dequeue script.
func (f *fakeRedis) enqueue(msg []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.messages = append(f.messages, msg)
}

// DialHook refuses every connection: only PubSub dials (the server's
// cancellation channel), and it retries on its own.
func (f *fakeRedis) DialHook(redis.DialHook) redis.DialHook {
	return func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("fake redis: no network")
	}
}

func (f *fakeRedis) ProcessHook(redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, cmd redis.Cmder) error {
		f.handle(cmd)
		return cmd.Err()
	}
}

func (f *fakeRedis) ProcessPipelineHook(redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(_ context.Context, cmds []redis.Cmder) error {
		var first error
		for _, cmd := range cmds {
			f.handle(cmd)
			if err := cmd.Err(); err != nil && first == nil {
				first = err
			}
		}
		return first
	}
}

func (f *fakeRedis) handle(cmd redis.Cmder) {
	f.mu.Lock()
	f.calls = append(f.calls, cmd.Args())
	answer := f.answer
	f.mu.Unlock()
	if answer != nil && answer(cmd) {
		return
	}
	name := strings.ToLower(cmd.Name())
	if name == "evalsha" || name == "eval" {
		if c, ok := cmd.(*redis.Cmd); ok {
			f.script(c)
			return
		}
	}
	switch c := cmd.(type) {
	case *redis.StatusCmd:
		if name == "ping" {
			c.SetVal("PONG")
		} else {
			c.SetVal("OK")
		}
	case *redis.IntCmd:
		c.SetVal(0)
	case *redis.BoolCmd:
		c.SetVal(true)
	case *redis.StringSliceCmd:
		c.SetVal(nil)
	case *redis.Cmd:
		c.SetVal(int64(1))
	default:
		cmd.SetErr(redis.Nil)
	}
}

// script answers a Lua script: the dequeue script pops a queued message,
// every other script succeeds with 1.
func (f *fakeRedis) script(c *redis.Cmd) {
	keys, _ := scriptKeysArgs(c.Args())
	if len(keys) == 4 && strings.HasSuffix(keys[0], ":pending") && strings.HasSuffix(keys[2], ":active") {
		f.mu.Lock()
		defer f.mu.Unlock()
		if len(f.messages) == 0 {
			c.SetErr(redis.Nil)
			return
		}
		c.SetVal(string(f.messages[0]))
		f.messages = f.messages[1:]
		return
	}
	c.SetVal(int64(1))
}

// scriptKeysArgs splits an EVALSHA/EVAL command's arguments into its keys
// and its ARGV.
func scriptKeysArgs(args []any) (keys []string, argv []any) {
	if len(args) < 3 {
		return nil, nil
	}
	n, ok := args[2].(int)
	if !ok || len(args) < 3+n {
		return nil, nil
	}
	for _, k := range args[3 : 3+n] {
		keys = append(keys, fmt.Sprint(k))
	}
	return keys, args[3+n:]
}

// scripts returns the keys and ARGV of every Lua script run whose first
// key is key.
func (f *fakeRedis) scripts(key string) [][]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out [][]any
	for _, args := range f.calls {
		name := strings.ToLower(fmt.Sprint(args[0]))
		if name != "evalsha" && name != "eval" {
			continue
		}
		if keys, argv := scriptKeysArgs(args); len(keys) > 0 && keys[0] == key {
			out = append(out, argv)
		}
	}
	return out
}

// isScript reports whether cmd runs a Lua script whose first key is key
// and that has n keys.
func isScript(cmd redis.Cmder, key string, n int) bool {
	name := strings.ToLower(cmd.Name())
	if name != "evalsha" && name != "eval" {
		return false
	}
	keys, _ := scriptKeysArgs(cmd.Args())
	return len(keys) == n && keys[0] == key
}

// taskMessage is Asynq's TaskMessage (asynq/internal/proto/asynq.proto),
// encoded by hand: the test needs no protobuf dependency.
type taskMessage struct {
	Type         string // 1
	Payload      []byte // 2
	ID           string // 3
	Queue        string // 4
	Retry        int64  // 5
	Retried      int64  // 6
	ErrorMsg     string // 7
	Timeout      int64  // 8
	LastFailedAt int64  // 11
}

//nolint:gosec // field numbers and small test values: no overflow
func (m taskMessage) encode() []byte {
	var b []byte
	str := func(field int, s []byte) {
		if len(s) == 0 {
			return
		}
		b = appendVarint(b, uint64(field<<3|2))
		b = appendVarint(b, uint64(len(s)))
		b = append(b, s...)
	}
	num := func(field int, v int64) {
		if v == 0 {
			return
		}
		b = appendVarint(b, uint64(field<<3))
		b = appendVarint(b, uint64(v))
	}
	str(1, []byte(m.Type))
	str(2, m.Payload)
	str(3, []byte(m.ID))
	str(4, []byte(m.Queue))
	num(5, m.Retry)
	num(6, m.Retried)
	str(7, []byte(m.ErrorMsg))
	num(8, m.Timeout)
	num(11, m.LastFailedAt)
	return b
}

// protoField is one field of an encoded protobuf message: a varint
// (wire type 0) or length-delimited bytes (wire type 2).
type protoField struct {
	num   int
	value uint64
	data  []byte
}

// protoFields walks an encoded protobuf message.
//
//nolint:gosec // lengths of a test message: no overflow
func protoFields(b []byte) ([]protoField, error) {
	var out []protoField
	for len(b) > 0 {
		key, n := readVarint(b)
		if n == 0 {
			return nil, errors.New("bad field key")
		}
		b = b[n:]
		f := protoField{num: int(key >> 3)}
		switch key & 7 {
		case 0:
			v, n := readVarint(b)
			if n == 0 {
				return nil, errors.New("bad varint")
			}
			f.value, b = v, b[n:]
		case 2:
			size, n := readVarint(b)
			if n == 0 || uint64(len(b)-n) < size {
				return nil, errors.New("bad length")
			}
			f.data, b = b[n:n+int(size)], b[n+int(size):]
		default:
			return nil, fmt.Errorf("unexpected wire type %d", key&7)
		}
		out = append(out, f)
	}
	return out, nil
}

// schedulerEntry is the part of Asynq's SchedulerEntry the tests read:
// what the scheduler's heartbeat writes for each registered job.
type schedulerEntry struct {
	Spec string   // 2
	Type string   // 3
	Opts []string // 5
}

func decodeSchedulerEntry(b []byte) (schedulerEntry, error) {
	var e schedulerEntry
	fields, err := protoFields(b)
	if err != nil {
		return e, err
	}
	for _, f := range fields {
		switch f.num {
		case 2:
			e.Spec = string(f.data)
		case 3:
			e.Type = string(f.data)
		case 5:
			e.Opts = append(e.Opts, string(f.data))
		}
	}
	return e, nil
}

func appendVarint(b []byte, v uint64) []byte {
	for v >= 0x80 {
		b = append(b, byte(v)|0x80)
		v >>= 7
	}
	return append(b, byte(v))
}

func readVarint(b []byte) (uint64, int) {
	var v uint64
	for i, c := range b {
		if i == 10 {
			return 0, 0
		}
		v |= uint64(c&0x7f) << (7 * i)
		if c < 0x80 {
			return v, i + 1
		}
	}
	return 0, 0
}

// waitFor polls cond until it holds, or fails the test after 5 seconds.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// secretPayload is a task payload that must never reach a log line.
//
//nolint:gosec // a test value, not a credential
const secretPayload = `{"to":"buyer@example.com","token":"vrf-7f3a9c2e"}`

// syncBuffer is a bytes.Buffer safe to read while goroutines write logs
// to it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n, _ := b.buf.Write(p) // bytes.Buffer.Write never fails
	return n, nil
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
