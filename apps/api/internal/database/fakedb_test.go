package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"sync"
	"testing"
)

// fakeDB is a tiny database/sql driver: it opens no network connection and
// only records what the code under test asked of it, so transactions are
// unit-tested without PostgreSQL. Each error field, when set, is what that
// operation returns.
type fakeDB struct {
	mu        sync.Mutex
	begins    int
	commits   int
	rollbacks int
	execs     []fakeExec

	beginErr    error
	commitErr   error
	rollbackErr error
	execErr     error

	// A query answers with one column holding queryValues, one row each,
	// or with queryErr.
	queries     []string
	queryValues []string
	queryErr    error
}

// fakeExec is one statement run through the fake, and whether a
// transaction was open on its connection at the time.
type fakeExec struct {
	query string
	inTx  bool
}

// open returns a *sql.DB on f, closed when the test ends.
func (f *fakeDB) open(t *testing.T) *sql.DB {
	t.Helper()
	db := sql.OpenDB(fakeConnector{f})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// counts returns begins, commits and rollbacks.
func (f *fakeDB) counts() (begins, commits, rollbacks int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.begins, f.commits, f.rollbacks
}

func (f *fakeDB) recorded() []fakeExec {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]fakeExec(nil), f.execs...)
}

type fakeConnector struct{ db *fakeDB }

func (c fakeConnector) Connect(context.Context) (driver.Conn, error) { return &fakeConn{db: c.db}, nil }
func (c fakeConnector) Driver() driver.Driver                        { return fakeDriver{} }

type fakeDriver struct{}

func (fakeDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("fakeDriver: use sql.OpenDB with a fakeConnector")
}

type fakeConn struct {
	db   *fakeDB
	inTx bool
}

func (c *fakeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("fakeConn: Prepare is not supported")
}
func (c *fakeConn) Close() error { return nil }

func (c *fakeConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *fakeConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	c.db.mu.Lock()
	defer c.db.mu.Unlock()
	c.db.begins++
	if c.db.beginErr != nil {
		return nil, c.db.beginErr
	}
	c.inTx = true
	return &fakeTx{conn: c}, nil
}

func (c *fakeConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.db.mu.Lock()
	defer c.db.mu.Unlock()
	c.db.execs = append(c.db.execs, fakeExec{query: query, inTx: c.inTx})
	if c.db.execErr != nil {
		return nil, c.db.execErr
	}
	return driver.RowsAffected(1), nil
}

func (c *fakeConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.db.mu.Lock()
	defer c.db.mu.Unlock()
	c.db.queries = append(c.db.queries, query)
	if c.db.queryErr != nil {
		return nil, c.db.queryErr
	}
	return &fakeRows{values: append([]string(nil), c.db.queryValues...)}, nil
}

// fakeRows is a one-column result.
type fakeRows struct{ values []string }

func (r *fakeRows) Columns() []string { return []string{"value"} }
func (r *fakeRows) Close() error      { return nil }

func (r *fakeRows) Next(dest []driver.Value) error {
	if len(r.values) == 0 {
		return io.EOF
	}
	dest[0], r.values = r.values[0], r.values[1:]
	return nil
}

// CheckNamedValue accepts every argument as it is.
func (c *fakeConn) CheckNamedValue(*driver.NamedValue) error { return nil }

type fakeTx struct{ conn *fakeConn }

func (tx *fakeTx) Commit() error {
	db := tx.conn.db
	db.mu.Lock()
	defer db.mu.Unlock()
	db.commits++
	tx.conn.inTx = false
	return db.commitErr
}

func (tx *fakeTx) Rollback() error {
	db := tx.conn.db
	db.mu.Lock()
	defer db.mu.Unlock()
	db.rollbacks++
	tx.conn.inTx = false
	return db.rollbackErr
}
