package app

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

func TestShippingProvider(t *testing.T) {
	p := shippingProvider(config.Shipping{Timeout: time.Second})
	testx.AssertEqual(t, p.Name(), "static", "no BITESHIP_API_KEY: the fixed table")
	_, isStatic := p.(shipping.Static)
	testx.AssertTrue(t, isStatic)

	p = shippingProvider(config.Shipping{BiteshipAPIKey: "biteship_test.key", OriginPostalCode: "40115", Timeout: time.Second}) // #nosec G101 -- a test value
	testx.AssertEqual(t, p.Name(), "biteship")
	_, isBiteship := p.(*shipping.Biteship)
	testx.AssertTrue(t, isBiteship)
}

func TestRateLimits(t *testing.T) {
	before := len(auth.Limits)
	limits := rateLimits(config.Config{CheckoutLimitPerMinute: 7})
	checkout := order.NewLimits(7).All()
	testx.AssertEqual(t, len(limits), before+1+len(checkout)+len(payment.Limits))
	for i, l := range auth.Limits {
		testx.AssertEqual(t, limits[i], l)
	}
	testx.AssertEqual(t, limits[before], cart.LimitGuestCartPerIP)
	for i, l := range checkout {
		testx.AssertEqual(t, limits[before+1+i], l, "the checkout limits at APP_CHECKOUT_LIMIT_PER_MINUTE")
		testx.AssertEqual(t, l.Max, 7)
	}
	names := map[string]bool{}
	for _, l := range limits {
		testx.AssertFalse(t, names[l.Name], "duplicate limit %q would share a Redis counter", l.Name)
		names[l.Name] = true
	}
	testx.AssertEqual(t, len(auth.Limits), before, "auth.Limits itself is not changed")
	testx.AssertEqual(t, len(rateLimits(config.Config{})), len(limits), "the same answer every time")
	testx.AssertEqual(t, rateLimits(config.Config{})[before+1].Max, order.DefaultLimitPerMinute, "unset is the default")
}

// jobDB is a database whose queries return no rows, whose execs change no
// rows, and which cannot begin a transaction; err fails every statement.
type jobDB struct{ err error }

func (d *jobDB) open(t *testing.T) *sql.DB {
	t.Helper()
	db := sql.OpenDB(jobConnector{d})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

type jobConnector struct{ d *jobDB }

func (c jobConnector) Connect(context.Context) (driver.Conn, error) { return jobConn(c), nil }
func (c jobConnector) Driver() driver.Driver                        { return nil }

type jobConn struct{ d *jobDB }

func (jobConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("no prepare") }
func (jobConn) Close() error                        { return nil }
func (jobConn) Begin() (driver.Tx, error)           { return nil, errors.New("no transactions") }

func (c jobConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	if c.d.err != nil {
		return nil, c.d.err
	}
	return jobRows{}, nil
}

func (c jobConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	if c.d.err != nil {
		return nil, c.d.err
	}
	return driver.RowsAffected(0), nil
}

func (jobConn) CheckNamedValue(*driver.NamedValue) error { return nil }

type jobRows struct{}

func (jobRows) Columns() []string         { return []string{"id"} }
func (jobRows) Close() error              { return nil }
func (jobRows) Next([]driver.Value) error { return io.EOF }

func jsonLogger() (logx.Logger, *bytes.Buffer) {
	var logs bytes.Buffer
	return logx.New(logx.WithOutput(&logs), logx.WithFormat("json")), &logs
}

func TestJobs(t *testing.T) {
	errDown := errors.New("database down")
	tests := []struct {
		name string
		job  func(context.Context, *sql.DB, logx.Logger) error
		log  string
	}{
		{name: "expire-orders", job: expireOrders, log: `"msg":"expired unpaid orders","cancelled":0`},
		{name: "cleanup-idempotency-keys", job: cleanupIdempotencyKeys, log: `"msg":"deleted expired idempotency keys","deleted":0`},
	}
	for _, tt := range tests {
		t.Run(tt.name+" with nothing to do", func(t *testing.T) {
			logger, logs := jsonLogger()
			testx.AssertNoError(t, tt.job(context.Background(), (&jobDB{}).open(t), logger))
			testx.AssertContains(t, logs.String(), tt.log)
		})
		t.Run(tt.name+" when the database fails", func(t *testing.T) {
			logger, logs := jsonLogger()
			err := tt.job(context.Background(), (&jobDB{err: errDown}).open(t), logger)
			testx.AssertTrue(t, errors.Is(err, errDown), "err = %v", err)
			testx.AssertContains(t, logs.String(), tt.log, "what was done is logged even on failure")
		})
	}
	t.Run("publish-events without a transaction", func(t *testing.T) {
		logger, logs := jsonLogger()
		err := publishEvents(outbox.LogPublisher{Logger: logger})(context.Background(), (&jobDB{}).open(t), logger)
		testx.AssertError(t, err)
		testx.AssertContains(t, logs.String(), `"msg":"published domain events","published":0`)
	})
}
