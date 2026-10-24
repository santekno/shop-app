package report

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

// fakeSQL is a database/sql driver for the unit tests of Service (the
// pattern of internal/order/fakesql_test.go, trimmed to what the report
// needs). It opens no connection: every sqlc query is answered by its name
// (the "-- name: X" line sqlc puts first), so a test scripts what the
// database says and then checks what the service asked. The SQL itself
// runs against PostgreSQL in tests/integration.
//
// A query without an answer returns no rows.
type fakeSQL struct {
	mu      sync.Mutex
	answers map[string][]fakeAnswer
	calls   []fakeCall
	queries map[string]string // the SQL of each statement name that ran
}

// fakeAnswer is what one query returns. Several answers for the same name
// are used in order; the last one repeats.
type fakeAnswer struct {
	rows [][]driver.Value
	err  error
}

// fakeCall is one statement the service ran: its sqlc name and arguments.
type fakeCall struct {
	name string
	args []driver.Value
}

// sqlOf is the SQL text of the statement called name that ran, with its
// whitespace collapsed; "" if none ran. The report's rules (what counts as
// a sale, where the ranking happens) live in the SQL, so a test that only
// follows statement names would not see them go.
func (f *fakeSQL) sqlOf(name string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return strings.Join(strings.Fields(f.queries[name]), " ")
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
		return fakeAnswer{}
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
	return nil, errors.New("fakeSQLConn: the report runs no transaction")
}

func (c *fakeSQLConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.f.mu.Lock()
	if c.f.queries == nil {
		c.f.queries = map[string]string{}
	}
	c.f.queries[queryName(query)] = query
	c.f.mu.Unlock()
	a := c.f.record(queryName(query), args)
	if a.err != nil {
		return nil, a.err
	}
	return &fakeSQLRows{rows: a.rows}, nil
}

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

// manyRows is an answer of several rows.
func manyRows(rows ...[]driver.Value) fakeAnswer { return fakeAnswer{rows: rows} }

// failWith is an answer that fails with err.
func failWith(err error) fakeAnswer { return fakeAnswer{err: err} }
