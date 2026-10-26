package fake

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"testing"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/testx"
)

// redisHook answers GET and SET in-process, so a go-redis client works
// without a Redis: it never calls the next hook, so no connection is made.
type redisHook struct {
	mu     sync.Mutex
	values map[string]string
	cmds   [][]any
	err    error // answer every command with this
}

func newRedis(t *testing.T) (*redis.Client, *redisHook) {
	t.Helper()
	h := &redisHook{values: map[string]string{}}
	c := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1})
	c.AddHook(h)
	t.Cleanup(func() { _ = c.Close() })
	return c, h
}

func (h *redisHook) DialHook(next redis.DialHook) redis.DialHook { return next }

func (h *redisHook) ProcessPipelineHook(redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(context.Context, []redis.Cmder) error { return errors.New("redisHook: no pipelines") }
}

func (h *redisHook) ProcessHook(redis.ProcessHook) redis.ProcessHook {
	return func(_ context.Context, cmd redis.Cmder) error {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.cmds = append(h.cmds, cmd.Args())
		if h.err != nil {
			cmd.SetErr(h.err)
			return h.err
		}
		args := cmd.Args()
		switch c := cmd.(type) {
		case *redis.StatusCmd: // SET
			h.values[fmt.Sprint(args[1])] = toString(args[2])
			c.SetVal("OK")
		case *redis.StringCmd: // GET
			v, ok := h.values[fmt.Sprint(args[1])]
			if !ok {
				c.SetErr(redis.Nil)
				return redis.Nil
			}
			c.SetVal(v)
		default:
			err := fmt.Errorf("redisHook: unexpected %v", args)
			cmd.SetErr(err)
			return err
		}
		return nil
	}
}

func toString(v any) string {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return fmt.Sprint(v)
}

func (h *redisHook) commands() [][]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([][]any(nil), h.cmds...)
}

func TestRedisStore_RoundTrip(t *testing.T) {
	c, h := newRedis(t)
	s := NewRedisStore(c)
	ctx := context.Background()
	want := Transaction{
		OrderID: "GS-1-ABC", Amount: 117000, Token: "fake-1", TransactionID: "tx-1",
		Status: "capture", FraudStatus: "challenge", PaymentType: "bank_transfer",
	}
	testx.AssertNoError(t, s.Put(ctx, want))

	got, ok, err := s.Get(ctx, "GS-1-ABC")
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, got, want)

	cmds := h.commands()
	testx.AssertEqual(t, len(cmds), 2)
	set := cmds[0]
	testx.AssertEqual(t, fmt.Sprint(set[0]), "set")
	testx.AssertEqual(t, fmt.Sprint(set[1]), "goshop:fake-payment:GS-1-ABC")
	testx.AssertContains(t, toString(set[2]), `"order_id":"GS-1-ABC"`)
	// A week: EX 604800 seconds (or PX in milliseconds).
	if len(set) != 5 {
		t.Fatalf("SET without an expiry: %v", set)
	}
	switch fmt.Sprint(set[3]) {
	case "ex":
		testx.AssertEqual(t, fmt.Sprint(set[4]), "604800")
	case "px":
		testx.AssertEqual(t, fmt.Sprint(set[4]), "604800000")
	default:
		t.Fatalf("SET expiry %v", set[3:])
	}
	testx.AssertEqual(t, fmt.Sprint(cmds[1][0]), "get")
	testx.AssertEqual(t, fmt.Sprint(cmds[1][1]), "goshop:fake-payment:GS-1-ABC")
}

func TestRedisStore_Missing(t *testing.T) {
	c, _ := newRedis(t)
	got, ok, err := NewRedisStore(c).Get(context.Background(), "GS-NONE")
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, ok)
	testx.AssertEqual(t, got, Transaction{})
}

func TestRedisStore_Errors(t *testing.T) {
	ctx := context.Background()
	t.Run("redis down", func(t *testing.T) {
		c, h := newRedis(t)
		h.err = &net.OpError{Op: "dial", Err: errors.New("connection refused")}
		s := NewRedisStore(c)

		err := s.Put(ctx, Transaction{OrderID: "GS-1"})
		testx.AssertError(t, err)
		testx.AssertContains(t, err.Error(), "fake: store transaction")
		testx.AssertContains(t, err.Error(), "connection refused")

		_, ok, err := s.Get(ctx, "GS-1")
		testx.AssertError(t, err)
		testx.AssertFalse(t, ok)
		testx.AssertContains(t, err.Error(), "fake: read transaction")
	})
	t.Run("corrupt value", func(t *testing.T) {
		c, h := newRedis(t)
		h.values["goshop:fake-payment:GS-1"] = "{not json"
		got, ok, err := NewRedisStore(c).Get(ctx, "GS-1")
		testx.AssertError(t, err)
		testx.AssertFalse(t, ok)
		testx.AssertContains(t, err.Error(), "fake: decode transaction")
		testx.AssertEqual(t, got, Transaction{})
	})
}

// The whole fake on Redis, as the API and the worker share it.
func TestGateway_OnRedisStore(t *testing.T) {
	c, _ := newRedis(t)
	g := New(NewRedisStore(c))
	ctx := context.Background()
	tx, err := g.CreateTransaction(ctx, txRequest("GS-7"))
	testx.AssertNoError(t, err)

	// Another process (a second gateway on the same Redis) sees it.
	other := New(NewRedisStore(c))
	n, err := other.Pay(ctx, "GS-7", "settlement", "")
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, g.VerifySignature(n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey))

	st, err := g.Status(ctx, "GS-7")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, st.TransactionStatus, "settlement")
	testx.AssertEqual(t, st.GrossAmount, "117000.00")
	testx.AssertTrue(t, tx.Token != "", "token")
}
