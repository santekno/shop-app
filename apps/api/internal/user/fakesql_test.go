package user_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeSQL is a database/sql driver for the unit tests of user.PostgresRepository.
// It opens no connection: every sqlc query is answered by its name (the
// "-- name: X" line sqlc puts first), so a test scripts what the database
// says and then checks what the repository did with it. The SQL itself runs
// against PostgreSQL in tests/integration.
//
// A query without an answer returns no rows (sql.ErrNoRows for a :one
// query); an exec without one succeeds with one affected row.
type fakeSQL struct {
	mu      sync.Mutex
	answers map[string][]fakeAnswer
	calls   []fakeCall
}

// fakeAnswer is what one query or exec returns. Several answers for the same
// name are used in order; the last one repeats.
type fakeAnswer struct {
	rows     [][]driver.Value
	err      error
	affected int64
}

// fakeCall is one statement the repository ran: its sqlc name (or BEGIN,
// COMMIT, ROLLBACK) and its arguments.
type fakeCall struct {
	name string
	args []driver.Value
}

func newFakeSQL() *fakeSQL { return &fakeSQL{answers: map[string][]fakeAnswer{}} }

// on queues answer for the statement called name.
func (f *fakeSQL) on(name string, answer fakeAnswer) *fakeSQL {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.answers[name] = append(f.answers[name], answer)
	return f
}

// open returns a *sql.DB on f, closed when the test ends.
func (f *fakeSQL) open(t *testing.T) *sql.DB {
	t.Helper()
	db := sql.OpenDB(fakeSQLConnector{f})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// names lists every statement run, in order.
func (f *fakeSQL) names() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.calls))
	for _, c := range f.calls {
		out = append(out, c.name)
	}
	return out
}

// call returns the first statement called name.
func (f *fakeSQL) call(name string) (fakeCall, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.calls {
		if c.name == name {
			return c, true
		}
	}
	return fakeCall{}, false
}

func (f *fakeSQL) record(name string, args []driver.NamedValue) fakeAnswer {
	f.mu.Lock()
	defer f.mu.Unlock()
	values := make([]driver.Value, 0, len(args))
	for _, a := range args {
		values = append(values, a.Value)
	}
	f.calls = append(f.calls, fakeCall{name: name, args: values})
	queue := f.answers[name]
	if len(queue) == 0 {
		return fakeAnswer{affected: 1}
	}
	a := queue[0]
	if len(queue) > 1 {
		f.answers[name] = queue[1:]
	}
	return a
}

// queryName is the sqlc name of query.
func queryName(query string) string {
	rest, ok := strings.CutPrefix(query, "-- name: ")
	if !ok {
		return query
	}
	name, _, _ := strings.Cut(rest, " ")
	return name
}

type fakeSQLConnector struct{ f *fakeSQL }

func (c fakeSQLConnector) Connect(context.Context) (driver.Conn, error) {
	return &fakeSQLConn{f: c.f}, nil
}
func (c fakeSQLConnector) Driver() driver.Driver { return fakeSQLDriver{} }

type fakeSQLDriver struct{}

func (fakeSQLDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("fakeSQLDriver: use sql.OpenDB with a fakeSQLConnector")
}

type fakeSQLConn struct{ f *fakeSQL }

func (c *fakeSQLConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("fakeSQLConn: Prepare is not supported")
}
func (c *fakeSQLConn) Close() error { return nil }
func (c *fakeSQLConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *fakeSQLConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	if a := c.f.record("BEGIN", nil); a.err != nil {
		return nil, a.err
	}
	return fakeSQLTx{f: c.f}, nil
}

func (c *fakeSQLConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	a := c.f.record(queryName(query), args)
	if a.err != nil {
		return nil, a.err
	}
	return driver.RowsAffected(a.affected), nil
}

func (c *fakeSQLConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	a := c.f.record(queryName(query), args)
	if a.err != nil {
		return nil, a.err
	}
	return &fakeSQLRows{rows: a.rows}, nil
}

type fakeSQLTx struct{ f *fakeSQL }

func (tx fakeSQLTx) Commit() error   { return tx.f.record("COMMIT", nil).err }
func (tx fakeSQLTx) Rollback() error { return tx.f.record("ROLLBACK", nil).err }

type fakeSQLRows struct{ rows [][]driver.Value }

func (r *fakeSQLRows) Columns() []string {
	n := 1
	if len(r.rows) > 0 {
		n = len(r.rows[0])
	}
	cols := make([]string, n)
	for i := range cols {
		cols[i] = "c"
	}
	return cols
}

func (r *fakeSQLRows) Close() error { return nil }

func (r *fakeSQLRows) Next(dest []driver.Value) error {
	if len(r.rows) == 0 {
		return io.EOF
	}
	copy(dest, r.rows[0])
	r.rows = r.rows[1:]
	return nil
}

// rows is a one-row answer.
func rows(values ...driver.Value) fakeAnswer {
	return fakeAnswer{rows: [][]driver.Value{values}}
}

// failWith is an answer that fails with err.
func failWith(err error) fakeAnswer { return fakeAnswer{err: err} }

// testTime is the creation time of the rows in these tests.
var testTime = time.Date(2026, 10, 23, 8, 0, 0, 0, time.UTC)
