package main

// The seed's SQL runs against PostgreSQL (make seed, make seed-loadtest).
// Here: what each step sends and how it counts, on a database/sql driver
// that answers every statement with a number of affected rows.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/santekno/sdk/testx"
)

var errSeedBoom = errors.New("boom")

// seedDB records every statement (its SQL and arguments, or BEGIN, COMMIT,
// ROLLBACK). affected answers each exec in turn (the last repeats);
// returning answers each query in turn with a one-column row (no row once
// it is used up); fail makes the statement whose SQL contains it fail.
type seedDB struct {
	mu        sync.Mutex
	affected  []int64
	returning []driver.Value
	fail      string
	stmts     []seedStmt
}

// nextRow pops the next query answer; ok is false when there is none.
func (d *seedDB) nextRow() (driver.Value, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.returning) == 0 {
		return nil, false
	}
	v := d.returning[0]
	d.returning = d.returning[1:]
	return v, true
}

type seedStmt struct {
	sql  string
	args []driver.Value
}

func (d *seedDB) open(t *testing.T) *sql.DB {
	t.Helper()
	db := sql.OpenDB(seedConnector{d})
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func (d *seedDB) record(query string, args []driver.NamedValue) (int64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	values := make([]driver.Value, 0, len(args))
	for _, a := range args {
		values = append(values, a.Value)
	}
	d.stmts = append(d.stmts, seedStmt{sql: query, args: values})
	if d.fail != "" && strings.Contains(query, d.fail) {
		return 0, errSeedBoom
	}
	n := int64(1)
	if len(d.affected) > 0 {
		n = d.affected[0]
		if len(d.affected) > 1 {
			d.affected = d.affected[1:]
		}
	}
	return n, nil
}

// kinds lists each statement as BEGIN, COMMIT, ROLLBACK or the first words
// of its SQL.
func (d *seedDB) kinds() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []string
	for _, s := range d.stmts {
		words := strings.Fields(s.sql)
		if len(words) > 3 {
			words = words[:3]
		}
		out = append(out, strings.Join(words, " "))
	}
	return out
}

type seedConnector struct{ d *seedDB }

func (c seedConnector) Connect(context.Context) (driver.Conn, error) { return seedConn(c), nil }
func (c seedConnector) Driver() driver.Driver                        { return nil }

type seedConn struct{ d *seedDB }

func (seedConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("no prepare") }
func (seedConn) Close() error                        { return nil }
func (c seedConn) Begin() (driver.Tx, error) {
	if _, err := c.d.record("BEGIN", nil); err != nil {
		return nil, err
	}
	return seedTx(c), nil
}

func (c seedConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	n, err := c.d.record(query, args)
	if err != nil {
		return nil, err
	}
	return driver.RowsAffected(n), nil
}

func (c seedConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if _, err := c.d.record(query, args); err != nil {
		return nil, err
	}
	if v, ok := c.d.nextRow(); ok {
		return &seedRows{rows: []driver.Value{v}}, nil
	}
	return &seedRows{}, nil
}

// CheckNamedValue accepts every argument as it is (nil interfaces too).
func (seedConn) CheckNamedValue(*driver.NamedValue) error { return nil }

type seedTx struct{ d *seedDB }

func (tx seedTx) Commit() error {
	_, err := tx.d.record("COMMIT", nil)
	return err
}

func (tx seedTx) Rollback() error {
	_, err := tx.d.record("ROLLBACK", nil)
	return err
}

type seedRows struct{ rows []driver.Value }

func (*seedRows) Columns() []string { return []string{"c"} }
func (*seedRows) Close() error      { return nil }
func (r *seedRows) Next(dest []driver.Value) error {
	if len(r.rows) == 0 {
		return io.EOF
	}
	dest[0], r.rows = r.rows[0], r.rows[1:]
	return nil
}

// make seed twice adds the vouchers once: the second run inserts nothing
// (ON CONFLICT DO NOTHING) and says so.
func TestSeedVouchers_Idempotent(t *testing.T) {
	db := &seedDB{affected: []int64{1}}
	added, err := seedVouchers(context.Background(), db.open(t))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, added, len(vouchers))
	testx.AssertEqual(t, len(db.stmts), len(vouchers))
	for i, s := range db.stmts {
		testx.AssertContains(t, s.sql, "ON CONFLICT (code) DO NOTHING")
		testx.AssertEqual(t, s.args[1], driver.Value(vouchers[i].code))
		testx.AssertEqual(t, s.args[2], driver.Value(vouchers[i].kind))
	}

	again := &seedDB{affected: []int64{0}}
	added, err = seedVouchers(context.Background(), again.open(t))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, added, 0, "existing codes are left as they are")

	partly := &seedDB{affected: []int64{0, 1, 0}}
	added, err = seedVouchers(context.Background(), partly.open(t))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, added, 1)

	failing := &seedDB{fail: "INSERT INTO vouchers"}
	added, err = seedVouchers(context.Background(), failing.open(t))
	testx.AssertTrue(t, errors.Is(err, errSeedBoom))
	testx.AssertEqual(t, err.Error(), "insert voucher HEMAT10: boom")
	testx.AssertEqual(t, added, 0)
}

// The example vouchers satisfy the vouchers table's CHECKs and the ADR's
// examples.
func TestVouchers(t *testing.T) {
	testx.AssertEqual(t, len(vouchers), 3)
	codes := map[string]bool{}
	for _, v := range vouchers {
		testx.AssertFalse(t, codes[v.code], "duplicate code %s", v.code)
		codes[v.code] = true
		testx.AssertEqual(t, strings.ToUpper(v.code), v.code, "codes are stored upper-case")
		testx.AssertTrue(t, v.kind == "percent" || v.kind == "fixed", "kind %q", v.kind)
		if v.kind == "percent" {
			testx.AssertTrue(t, v.value >= 1 && v.value <= 100, "%s: percent %d", v.code, v.value)
		}
		testx.AssertTrue(t, v.perUserLimit >= 1, "%s: per-user limit %d", v.code, v.perUserLimit)
	}
	testx.AssertEqual(t, vouchers[2].usageLimit, any(int32(5)), "KILAT50 has five uses, for the race on the last one")
}

func TestSeedLoadTestUser(t *testing.T) {
	const guard = "WHERE users.email LIKE 'loadtest-%@goshop.local' AND users.anonymized_at IS NULL"
	t.Run("a new buyer gets a default address", func(t *testing.T) {
		db := &seedDB{returning: []driver.Value{true}} // xmax = 0: inserted
		isNew, err := seedLoadTestUser(context.Background(), db.open(t), "loadtest-0001@goshop.local", "$argon2id$hash")
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, isNew)
		testx.AssertEqual(t, strings.Join(db.kinds(), "|"), "INSERT INTO users|INSERT INTO addresses")
		testx.AssertContains(t, db.stmts[0].sql, "'buyer', now()")
		testx.AssertContains(t, db.stmts[0].sql, "RETURNING xmax = 0")
		testx.AssertEqual(t, db.stmts[0].args[1], driver.Value("loadtest-0001@goshop.local"))
		testx.AssertEqual(t, db.stmts[0].args[2], driver.Value("$argon2id$hash"))
		testx.AssertEqual(t, db.stmts[1].args[1], db.stmts[0].args[0], "the address is the new buyer's")
	})
	// A rerun with another SEED_LOADTEST_PASSWORD gives the existing buyers
	// the new hash, so the k6 run can log in; no second address.
	t.Run("a rerun updates the password", func(t *testing.T) {
		db := &seedDB{returning: []driver.Value{false}} // updated, not inserted
		isNew, err := seedLoadTestUser(context.Background(), db.open(t), "loadtest-0001@goshop.local", "$argon2id$new")
		testx.AssertNoError(t, err)
		testx.AssertFalse(t, isNew)
		testx.AssertEqual(t, len(db.stmts), 1, "no second address")
		sql := strings.Join(strings.Fields(db.stmts[0].sql), " ")
		testx.AssertContains(t, sql, "ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash")
		testx.AssertContains(t, sql, guard)
	})
	// The guard leaves every other account alone: a real user's email, or
	// a deleted load-test buyer, returns no row.
	t.Run("an account that is not a live load-test buyer is left alone", func(t *testing.T) {
		db := &seedDB{} // ON CONFLICT ... WHERE false: no row
		isNew, err := seedLoadTestUser(context.Background(), db.open(t), "budi@example.com", "h")
		testx.AssertNoError(t, err, "not an error: the seed goes on")
		testx.AssertFalse(t, isNew)
		testx.AssertEqual(t, len(db.stmts), 1)
	})
	t.Run("errors name the buyer", func(t *testing.T) {
		_, err := seedLoadTestUser(context.Background(), (&seedDB{fail: "INSERT INTO users"}).open(t), "a@goshop.local", "h")
		testx.AssertEqual(t, err.Error(), "upsert a@goshop.local: boom")
		_, err = seedLoadTestUser(context.Background(), (&seedDB{fail: "INSERT INTO addresses", returning: []driver.Value{true}}).open(t), "a@goshop.local", "h")
		testx.AssertEqual(t, err.Error(), "insert address of a@goshop.local: boom")
	})
}

// Each load-test run starts the same: the buyers' unpaid orders cancelled
// and both variants back to their stock, in one transaction.
func TestResetLoadTest(t *testing.T) {
	db := &seedDB{}
	testx.AssertNoError(t, resetLoadTest(context.Background(), db.open(t)))
	testx.AssertEqual(t, strings.Join(db.kinds(), "|"), "BEGIN|UPDATE orders SET|UPDATE product_variants SET|COMMIT")
	testx.AssertContains(t, db.stmts[1].sql, "WHERE status = 'pending_payment'")
	testx.AssertContains(t, db.stmts[1].sql, "LIKE 'loadtest-%@goshop.local'")
	testx.AssertContains(t, db.stmts[2].sql, "version = version + 1", "a stock change bumps the version")
	testx.AssertEqual(t, len(db.stmts[2].args), 4)
	testx.AssertEqual(t, db.stmts[2].args[0], driver.Value(loadTestPlentySKU))
	testx.AssertEqual(t, db.stmts[2].args[1], driver.Value(loadTestPlentyStock))
	testx.AssertEqual(t, db.stmts[2].args[2], driver.Value(loadTestScarceStock))
	testx.AssertEqual(t, db.stmts[2].args[3], driver.Value(loadTestScarceSKU))

	// Running it again sends the same statements: a reset is idempotent.
	again := &seedDB{}
	testx.AssertNoError(t, resetLoadTest(context.Background(), again.open(t)))
	testx.AssertEqual(t, strings.Join(again.kinds(), "|"), strings.Join(db.kinds(), "|"))

	tests := []struct {
		fail, want string
	}{
		{fail: "UPDATE orders", want: "cancel load-test orders: boom"},
		{fail: "UPDATE product_variants", want: "reset load-test stock: boom"},
		{fail: "BEGIN", want: "begin: boom"},
		{fail: "COMMIT", want: "commit: boom"},
	}
	for _, tt := range tests {
		db := &seedDB{fail: tt.fail}
		err := resetLoadTest(context.Background(), db.open(t))
		testx.AssertTrue(t, errors.Is(err, errSeedBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), tt.want)
		if tt.fail != "BEGIN" && tt.fail != "COMMIT" {
			testx.AssertEqual(t, db.kinds()[len(db.kinds())-1], "ROLLBACK")
		}
	}
}

func TestRunLoadTest_Guards(t *testing.T) {
	const url = "postgres://127.0.0.1:1/goshop?sslmode=disable"
	const good = "kopi susu gula aren"
	tests := []struct {
		name     string
		users    int
		password string
		want     string
	}{
		{name: "no users", users: 0, password: good, want: "-loadtest must be between 1 and 1000, got 0"},
		{name: "negative", users: -1, password: good, want: "-loadtest must be between 1 and 1000, got -1"},
		{name: "above the cap", users: 1001, password: good, want: "-loadtest must be between 1 and 1000, got 1001"},
		{name: "no password", users: 10, password: "", want: "SEED_LOADTEST_PASSWORD is not set (make seed-loadtest needs it)"},
		{name: "short password", users: 10, password: "short", want: "SEED_LOADTEST_PASSWORD: password must be between 8 and 128 characters"},
		{name: "common password", users: 10, password: "Admin123", want: "SEED_LOADTEST_PASSWORD: password is too common"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := runLoadTest(context.Background(), url, tt.users, tt.password)
			testx.AssertError(t, err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.want), "err = %v, want %s", err, tt.want)
			if len(tt.password) >= 8 {
				testx.AssertFalse(t, strings.Contains(err.Error(), tt.password), "the password is repeated: %v", err)
			}
		})
	}
	// The bounds themselves pass the guard and reach the database.
	for _, users := range []int{1, maxLoadTestUsers} {
		err := runLoadTest(context.Background(), url, users, good)
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "users=%d: %v", users, err)
		testx.AssertFalse(t, strings.Contains(err.Error(), url), "the URL is repeated: %v", err)
	}
}
