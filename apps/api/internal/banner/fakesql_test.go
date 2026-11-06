package banner

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
)

// fakeSQL is a database/sql driver for the unit tests of PostgresRepository
// (the pattern of internal/product/fakesql_test.go, trimmed to what the
// banner read needs). It opens no connection: every sqlc query is answered
// by its name (the "-- name: X" line sqlc puts first). The SQL itself runs
// against PostgreSQL in tests/integration.
type fakeSQL struct {
	mu      sync.Mutex
	answers map[string]fakeAnswer
	calls   []string
}

// fakeAnswer is what one query returns.
type fakeAnswer struct {
	rows [][]driver.Value
	err  error
}

func newFakeSQL() *fakeSQL { return &fakeSQL{answers: map[string]fakeAnswer{}} }

// on sets the answer for the statement called name.
func (f *fakeSQL) on(name string, a fakeAnswer) *fakeSQL {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.answers[name] = a
	return f
}

// open returns a *sql.DB on f, closed when the test ends.
func (f *fakeSQL) open(t *testing.T) *sql.DB {
	t.Helper()
	db := sql.OpenDB(fakeConnector{f})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// names lists every statement run, in order.
func (f *fakeSQL) names() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

func (f *fakeSQL) answer(query string) fakeAnswer {
	name := query
	if rest, ok := strings.CutPrefix(query, "-- name: "); ok {
		name, _, _ = strings.Cut(rest, " ")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, name)
	return f.answers[name]
}

type fakeConnector struct{ f *fakeSQL }

func (c fakeConnector) Connect(context.Context) (driver.Conn, error) { return &fakeConn{f: c.f}, nil }
func (c fakeConnector) Driver() driver.Driver                        { return fakeDriver{} }

type fakeDriver struct{}

func (fakeDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("fakeDriver: use sql.OpenDB with a fakeConnector")
}

type fakeConn struct{ f *fakeSQL }

func (c *fakeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("fakeConn: Prepare is not supported")
}
func (c *fakeConn) Close() error              { return nil }
func (c *fakeConn) Begin() (driver.Tx, error) { return nil, errors.New("fakeConn: no transactions") }

func (c *fakeConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	a := c.f.answer(query)
	if a.err != nil {
		return nil, a.err
	}
	return &fakeRows{rows: a.rows}, nil
}

type fakeRows struct{ rows [][]driver.Value }

func (r *fakeRows) Columns() []string {
	n := 6
	if len(r.rows) > 0 {
		n = len(r.rows[0])
	}
	cols := make([]string, n)
	for i := range cols {
		cols[i] = "c"
	}
	return cols
}

func (r *fakeRows) Close() error { return nil }

func (r *fakeRows) Next(dest []driver.Value) error {
	if len(r.rows) == 0 {
		return io.EOF
	}
	copy(dest, r.rows[0])
	r.rows = r.rows[1:]
	return nil
}
