package outbox

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// fakeSQL is a database/sql driver for the unit tests of PostgresRepository
// (the pattern of internal/auth/fakesql_test.go).
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
	txs     int // transactions begun so far
}

// fakeAnswer is what one query or exec returns. Several answers for the same
// name are used in order; the last one repeats.
type fakeAnswer struct {
	rows     [][]driver.Value
	err      error
	affected int64
}

// fakeCall is one statement the repository ran: its sqlc name (or BEGIN,
// COMMIT, ROLLBACK), its arguments, and the transaction it ran in (1 for
// the first BEGIN, 2 for the next; 0 outside any transaction).
type fakeCall struct {
	name string
	args []driver.Value
	tx   int
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

// ran reports whether a statement called name ran.
func (f *fakeSQL) ran(name string) bool {
	_, ok := f.call(name)
	return ok
}

func (f *fakeSQL) record(name string, args []driver.NamedValue) fakeAnswer {
	return f.recordIn(0, name, args)
}

// recordIn records a statement run in transaction tx (0: none).
func (f *fakeSQL) recordIn(tx int, name string, args []driver.NamedValue) fakeAnswer {
	f.mu.Lock()
	defer f.mu.Unlock()
	values := make([]driver.Value, 0, len(args))
	for _, a := range args {
		values = append(values, a.Value)
	}
	if name == "BEGIN" {
		f.txs++
		tx = f.txs
	}
	f.calls = append(f.calls, fakeCall{name: name, args: values, tx: tx})
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

// fakeSQLConn is one connection; tx is its open transaction (0: none).
type fakeSQLConn struct {
	f  *fakeSQL
	tx int
}

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
	c.f.mu.Lock()
	c.tx = c.f.txs
	c.f.mu.Unlock()
	return fakeSQLTx{c: c}, nil
}

func (c *fakeSQLConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	a := c.f.recordIn(c.tx, queryName(query), args)
	if a.err != nil {
		return nil, a.err
	}
	return driver.RowsAffected(a.affected), nil
}

func (c *fakeSQLConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	a := c.f.recordIn(c.tx, queryName(query), args)
	if a.err != nil {
		return nil, a.err
	}
	return &fakeSQLRows{rows: a.rows}, nil
}

type fakeSQLTx struct{ c *fakeSQLConn }

func (tx fakeSQLTx) Commit() error   { return tx.end("COMMIT") }
func (tx fakeSQLTx) Rollback() error { return tx.end("ROLLBACK") }

func (tx fakeSQLTx) end(name string) error {
	err := tx.c.f.recordIn(tx.c.tx, name, nil).err
	tx.c.tx = 0
	return err
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

// failWith is an answer that fails with err.
func failWith(err error) fakeAnswer { return fakeAnswer{err: err} }

// calledAll returns every statement called name, in order.
func (f *fakeSQL) calledAll(name string) []fakeCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []fakeCall
	for _, c := range f.calls {
		if c.name == name {
			out = append(out, c)
		}
	}
	return out
}

// assertLockedFirst checks that lock is the first statement after BEGIN
// and that it and every later statement ran in that same transaction
// (the helper of internal/auth/session_repository_test.go).
func assertLockedFirst(t *testing.T, db *fakeSQL, lock string) {
	t.Helper()
	db.mu.Lock()
	calls := append([]fakeCall(nil), db.calls...)
	db.mu.Unlock()
	if len(calls) < 2 || calls[0].name != "BEGIN" || calls[1].name != lock {
		t.Fatalf("want BEGIN then %s first, got %v", lock, db.names())
	}
	tx := calls[0].tx
	if tx == 0 {
		t.Fatal("BEGIN opened no transaction")
	}
	for _, c := range calls {
		if c.tx != tx {
			t.Fatalf("%s ran outside the transaction of %s: %v", c.name, lock, db.names())
		}
	}
}

// assertArgs checks the arguments of a statement, in order.
func assertArgs(t *testing.T, got, want []driver.Value, msg ...any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args %v, want %v %v", got, want, msg)
	}
}

// pqArray is how pq.Array sends a []string: {"a","b"}.
func pqArray(values ...string) string {
	quoted := make([]string, len(values))
	for i, v := range values {
		quoted[i] = `"` + v + `"`
	}
	return "{" + strings.Join(quoted, ",") + "}"
}
