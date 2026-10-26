package notify

// An asynq.Client on an in-process Redis: a go-redis hook answers every
// command without a network, records it, and lets a test script the
// answer of the enqueue script. First needed by Bab 6 artikel 08
// (QueueMailer); artikel 11 (QueuePublisher) uses it too.

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

// fakeRedis records every command; enqueue answers each EVALSHA in turn
// (the last one repeats; none: 1, enqueued).
type fakeRedis struct {
	mu      sync.Mutex
	cmds    [][]any
	enqueue []enqueueAnswer
}

type enqueueAnswer struct {
	n   int64
	err error
}

func (f *fakeRedis) DialHook(redis.DialHook) redis.DialHook {
	return func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("fakeRedis: no network")
	}
}

func (f *fakeRedis) ProcessHook(redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, cmd redis.Cmder) error {
		f.answer(cmd)
		return cmd.Err()
	}
}

func (f *fakeRedis) ProcessPipelineHook(redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(_ context.Context, cmds []redis.Cmder) error {
		for _, cmd := range cmds {
			f.answer(cmd)
		}
		return nil
	}
}

func (f *fakeRedis) answer(cmd redis.Cmder) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cmds = append(f.cmds, append([]any(nil), cmd.Args()...))
	switch c := cmd.(type) {
	case *redis.Cmd:
		if strings.EqualFold(cmd.Name(), "evalsha") && len(f.enqueue) > 0 {
			a := f.enqueue[0]
			if len(f.enqueue) > 1 {
				f.enqueue = f.enqueue[1:]
			}
			if a.err != nil {
				c.SetErr(a.err)
				return
			}
			c.SetVal(a.n)
			return
		}
		c.SetVal(int64(1))
	case *redis.IntCmd:
		c.SetVal(1)
	case *redis.StatusCmd:
		c.SetVal("OK")
	default:
		cmd.SetErr(fmt.Errorf("fakeRedis: unexpected %T %v", cmd, cmd.Args()))
	}
}

// enqueues returns every EVALSHA of the enqueue script.
func (f *fakeRedis) enqueues() []enqueueCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []enqueueCall
	for _, args := range f.cmds {
		if !strings.EqualFold(fmt.Sprint(args[0]), "evalsha") {
			continue
		}
		// evalsha <sha> <numkeys> <keys...> <argv...>
		nkeys := args[2].(int)
		keys := make([]string, 0, nkeys)
		for _, k := range args[3 : 3+nkeys] {
			keys = append(keys, fmt.Sprint(k))
		}
		out = append(out, enqueueCall{keys: keys, argv: args[3+nkeys:]})
	}
	return out
}

type enqueueCall struct {
	keys []string
	argv []any
}

// newFakeAsynq returns an asynq.Client on a fakeRedis.
func newFakeAsynq(t *testing.T, answers ...enqueueAnswer) (*asynq.Client, *fakeRedis) {
	t.Helper()
	f := &fakeRedis{enqueue: answers}
	rc := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	rc.AddHook(f)
	t.Cleanup(func() { _ = rc.Close() })
	return asynq.NewClientFromRedisClient(rc), f
}

// taskMessage is the part of asynq's TaskMessage protobuf the tests read.
type taskMessage struct {
	Type      string
	Payload   []byte
	ID        string
	Queue     string
	Retry     uint64
	Timeout   uint64
	Deadline  uint64
	Retention uint64
	fields    map[int]bool
}

// decodeTaskMessage decodes the enqueue script's ARGV[1] with a minimal
// protobuf walker (varint and length-delimited fields only).
func decodeTaskMessage(t *testing.T, raw any) taskMessage {
	t.Helper()
	var b []byte
	switch v := raw.(type) {
	case []byte:
		b = v
	case string:
		b = []byte(v)
	default:
		t.Fatalf("task message is %T", raw)
	}
	m := taskMessage{fields: map[int]bool{}}
	for len(b) > 0 {
		key, n := uvarint(t, b)
		b = b[n:]
		field, wire := int(key>>3), key&7
		m.fields[field] = true
		switch wire {
		case 0:
			v, n := uvarint(t, b)
			b = b[n:]
			switch field {
			case 5:
				m.Retry = v
			case 8:
				m.Timeout = v
			case 9:
				m.Deadline = v
			case 12:
				m.Retention = v
			}
		case 2:
			l, n := uvarint(t, b)
			b = b[n:]
			if uint64(len(b)) < l {
				t.Fatalf("truncated field %d", field)
			}
			data := b[:l]
			b = b[l:]
			switch field {
			case 1:
				m.Type = string(data)
			case 2:
				m.Payload = data
			case 3:
				m.ID = string(data)
			case 4:
				m.Queue = string(data)
			}
		default:
			t.Fatalf("unexpected wire type %d (field %d)", wire, field)
		}
	}
	return m
}

func uvarint(t *testing.T, b []byte) (uint64, int) {
	t.Helper()
	var v uint64
	for i, c := range b {
		if i == 10 {
			break
		}
		v |= uint64(c&0x7f) << (7 * i)
		if c < 0x80 {
			return v, i + 1
		}
	}
	t.Fatal("bad varint")
	return 0, 0
}
