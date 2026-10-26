package app

import (
	"bufio"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
)

func TestPaymentGateway(t *testing.T) {
	t.Run("fake provider", func(t *testing.T) {
		logger, logs := jsonLogger()
		g := PaymentGateway(config.Payment{Provider: config.PaymentFake}, logger, nil)
		gw, ok := g.(*fake.Gateway)
		testx.AssertTrue(t, ok, "gateway %T", g)
		testx.AssertEqual(t, gw.Name(), "fake")
		testx.AssertEqual(t, gw.ClientKey(), fake.ClientKey)
		testx.AssertContains(t, logs.String(), `"level":"WARN","msg":"payments go to the fake gateway (APP_PAYMENT_PROVIDER=fake): no money moves"`)
	})
	t.Run("fake provider wins over a Midtrans key", func(t *testing.T) {
		logger, _ := jsonLogger()
		g := PaymentGateway(config.Payment{
			Provider: config.PaymentFake, MidtransServerKey: "SB-Mid-server-test", MidtransClientKey: "SB-Mid-client-test",
		}, logger, nil)
		testx.AssertEqual(t, g.Name(), "fake")
	})
	t.Run("no server key: payments off", func(t *testing.T) {
		logger, logs := jsonLogger()
		g := PaymentGateway(config.Payment{Provider: config.PaymentMidtrans}, logger, nil)
		testx.AssertTrue(t, g == nil, "gateway %T, want nil", g)
		testx.AssertEqual(t, logs.Len(), 0)
	})
	t.Run("midtrans", func(t *testing.T) {
		logger, logs := jsonLogger()
		g := PaymentGateway(config.Payment{
			Provider: config.PaymentMidtrans, MidtransServerKey: "SB-Mid-server-test", MidtransClientKey: "SB-Mid-client-test",
			Timeout: time.Second,
		}, logger, nil)
		gw, ok := g.(*midtrans.Client)
		testx.AssertTrue(t, ok, "gateway %T", g)
		testx.AssertEqual(t, gw.Name(), "midtrans")
		testx.AssertEqual(t, gw.ClientKey(), "SB-Mid-client-test")
		testx.AssertFalse(t, strings.Contains(logs.String(), "SB-Mid-server-test"), "the server key is never logged")
	})
}

func TestReconcilePayments(t *testing.T) {
	midtransOn := config.Payment{
		Provider: config.PaymentMidtrans, MidtransServerKey: "SB-Mid-server-test", MidtransClientKey: "SB-Mid-client-test", Timeout: time.Second,
	}
	t.Run("payments off: nothing to do", func(t *testing.T) {
		logger, logs := jsonLogger()
		db := &recordingDB{}
		err := reconcilePayments(config.Config{})(context.Background(), db.open(t), logger)
		testx.AssertNoError(t, err)
		testx.AssertContains(t, logs.String(), `"level":"WARN","msg":"payments are off: MIDTRANS_SERVER_KEY is not set; nothing to reconcile"`)
		testx.AssertEqual(t, len(db.queries()), 0, "the database is not asked")
	})
	t.Run("nothing open", func(t *testing.T) {
		logger, logs := jsonLogger()
		db := &recordingDB{}
		err := reconcilePayments(config.Config{Payment: midtransOn})(context.Background(), db.open(t), logger)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(db.queries(), ","), "ListPaymentsToReconcile")
		testx.AssertContains(t, logs.String(), `"msg":"reconciled payments","checked":0,"changed":0,"failed":0`)
	})
	t.Run("the database fails", func(t *testing.T) {
		logger, logs := jsonLogger()
		errDown := errors.New("database down")
		err := reconcilePayments(config.Config{Payment: midtransOn})(context.Background(), (&recordingDB{err: errDown}).open(t), logger)
		testx.AssertTrue(t, errors.Is(err, errDown), "err = %v", err)
		testx.AssertContains(t, logs.String(), `"msg":"reconciled payments"`)
	})
	t.Run("fake provider opens Redis for its transactions", func(t *testing.T) {
		logger, logs := jsonLogger()
		srv := newPongServer(t)
		cfg := config.Config{Payment: config.Payment{Provider: config.PaymentFake}, RedisURL: srv.url()}
		err := reconcilePayments(cfg)(context.Background(), (&recordingDB{}).open(t), logger)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, srv.pinged(), "Redis was opened")
		testx.AssertContains(t, logs.String(), `"msg":"redis closed"`)
		testx.AssertContains(t, logs.String(), `"msg":"reconciled payments"`)
	})
	t.Run("fake provider without Redis", func(t *testing.T) {
		logger, _ := jsonLogger()
		srv := newPongServer(t)
		srv.mu.Lock()
		srv.refuse = true
		srv.mu.Unlock()
		cfg := config.Config{Payment: config.Payment{Provider: config.PaymentFake}, RedisURL: srv.url()}
		err := reconcilePayments(cfg)(context.Background(), (&recordingDB{}).open(t), logger)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open redis: "), "err = %v", err)
	})
}

// recordingDB is a database whose queries return no rows (or one row of
// row, when set) and whose execs change no rows; it records each sqlc
// statement's name and arguments. err fails every statement.
type recordingDB struct {
	err error
	row []driver.Value

	mu    sync.Mutex
	names []string
	args  [][]driver.Value
}

func (d *recordingDB) open(t *testing.T) *sql.DB {
	t.Helper()
	db := sql.OpenDB(recordingConnector{d})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func (d *recordingDB) record(query string, args []driver.NamedValue) {
	d.mu.Lock()
	defer d.mu.Unlock()
	name := query
	if rest, ok := strings.CutPrefix(query, "-- name: "); ok {
		name, _, _ = strings.Cut(rest, " ")
	}
	values := make([]driver.Value, 0, len(args))
	for _, a := range args {
		values = append(values, a.Value)
	}
	d.names = append(d.names, name)
	d.args = append(d.args, values)
}

func (d *recordingDB) queries() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.names...)
}

type recordingConnector struct{ d *recordingDB }

func (c recordingConnector) Connect(context.Context) (driver.Conn, error) {
	return recordingConn(c), nil
}
func (c recordingConnector) Driver() driver.Driver { return nil }

type recordingConn struct{ d *recordingDB }

func (recordingConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("no prepare") }
func (recordingConn) Close() error                        { return nil }
func (recordingConn) Begin() (driver.Tx, error)           { return nil, errors.New("no transactions") }
func (recordingConn) CheckNamedValue(*driver.NamedValue) error {
	return nil
}

func (c recordingConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.d.record(query, args)
	if c.d.err != nil {
		return nil, c.d.err
	}
	return &recordingRows{row: c.d.row}, nil
}

func (c recordingConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	c.d.record(query, args)
	if c.d.err != nil {
		return nil, c.d.err
	}
	return driver.RowsAffected(0), nil
}

type recordingRows struct {
	row  []driver.Value
	done bool
}

func (r *recordingRows) Columns() []string {
	if len(r.row) == 0 {
		return []string{"c"}
	}
	return make([]string, len(r.row))
}
func (r *recordingRows) Close() error { return nil }
func (r *recordingRows) Next(dest []driver.Value) error {
	if r.done || len(r.row) == 0 {
		return io.EOF
	}
	r.done = true
	copy(dest, r.row)
	return nil
}

// pongServer is the least of Redis that redisconn.Open needs: it refuses
// HELLO (so go-redis speaks RESP2) and answers PONG or OK to the rest.
type pongServer struct {
	ln net.Listener

	mu    sync.Mutex
	pings int
	// refuse answers PING with an error: Redis "unreachable" at once.
	refuse bool
}

func newPongServer(t *testing.T) *pongServer {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &pongServer{ln: ln}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go s.handle(conn)
		}
	}()
	t.Cleanup(func() { _ = ln.Close() })
	return s
}

func (s *pongServer) url() string { return "redis://" + s.ln.Addr().String() + "/0" }

func (s *pongServer) pinged() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pings > 0
}

func (s *pongServer) handle(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	r := bufio.NewReader(conn)
	for {
		header, err := r.ReadString('\n')
		if err != nil {
			return
		}
		var args []string
		var n int
		if _, err := fmt.Sscanf(strings.TrimSpace(header), "*%d", &n); err != nil || n < 1 {
			return
		}
		for range n {
			if _, err := r.ReadString('\n'); err != nil { // $len
				return
			}
			arg, err := r.ReadString('\n')
			if err != nil {
				return
			}
			args = append(args, strings.TrimSpace(arg))
		}
		reply := "+OK\r\n"
		switch strings.ToUpper(args[0]) {
		case "HELLO":
			reply = "-ERR unknown command 'HELLO'\r\n"
		case "PING":
			s.mu.Lock()
			s.pings++
			refuse := s.refuse
			s.mu.Unlock()
			reply = "+PONG\r\n"
			if refuse {
				reply = "-ERR refused\r\n"
			}
		}
		if _, err := io.WriteString(conn, reply); err != nil {
			return
		}
	}
}

// closedPort is a loopback port nothing listens on.
func closedPort(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	_ = ln.Close()
	return port
}
