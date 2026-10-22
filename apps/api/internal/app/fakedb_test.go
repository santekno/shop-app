package app_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"testing"
)

// fakeDB is a *sql.DB without PostgreSQL behind it: a ping returns pingErr,
// and every query returns queryErr or, when that is nil, no rows. That is
// enough to check the wiring of app.New; the SQL itself is tested in
// tests/integration.
type fakeDB struct {
	pingErr  error
	queryErr error
}

func (f *fakeDB) open(t *testing.T) *sql.DB {
	t.Helper()
	db := sql.OpenDB(fakeConnector{f})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

type fakeConnector struct{ db *fakeDB }

func (c fakeConnector) Connect(context.Context) (driver.Conn, error) { return fakeConn(c), nil }
func (c fakeConnector) Driver() driver.Driver                        { return fakeDriver{} }

type fakeDriver struct{}

func (fakeDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("fakeDriver: use sql.OpenDB with a fakeConnector")
}

type fakeConn struct{ db *fakeDB }

func (c fakeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("fakeConn: Prepare is not supported")
}
func (c fakeConn) Close() error              { return nil }
func (c fakeConn) Begin() (driver.Tx, error) { return nil, errors.New("fakeConn: no transactions") }

func (c fakeConn) Ping(context.Context) error { return c.db.pingErr }

func (c fakeConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	if c.db.queryErr != nil {
		return nil, c.db.queryErr
	}
	return noRows{}, nil
}

func (c fakeConn) ExecContext(context.Context, string, []driver.NamedValue) (driver.Result, error) {
	if c.db.queryErr != nil {
		return nil, c.db.queryErr
	}
	return driver.RowsAffected(0), nil
}

// CheckNamedValue accepts every argument as it is.
func (c fakeConn) CheckNamedValue(*driver.NamedValue) error { return nil }

type noRows struct{}

func (noRows) Columns() []string         { return nil }
func (noRows) Close() error              { return nil }
func (noRows) Next([]driver.Value) error { return io.EOF }
