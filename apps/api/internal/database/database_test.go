package database

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// secret is the password in the URLs below. It is put together at run
// time, so no URL with a login other than the scanner's placeholders is
// written in this file.
const secret = "s3cr3t-pw-1234"

// databaseURL returns a postgres URL for host with the login user and the
// password secret, the database goshop and query.
func databaseURL(host, query string) string {
	u := url.URL{Scheme: "postgres", User: url.UserPassword("user", secret), Host: host, Path: "/goshop", RawQuery: query}
	return u.String()
}

func TestWithCustomPlans(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want url.Values
	}{
		{
			name: "added when absent",
			in:   databaseURL("db:5432", ""),
			want: url.Values{"plan_cache_mode": {"force_custom_plan"}},
		},
		{
			name: "other parameters are kept",
			in:   databaseURL("db:5432", "sslmode=require&application_name=api"),
			want: url.Values{"plan_cache_mode": {"force_custom_plan"}, "sslmode": {"require"}, "application_name": {"api"}},
		},
		{
			name: "a URL that sets it wins",
			in:   databaseURL("db:5432", "plan_cache_mode=auto"),
			want: url.Values{"plan_cache_mode": {"auto"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := withCustomPlans(tt.in)
			testx.AssertNoError(t, err)
			u, err := url.Parse(got)
			if err != nil {
				t.Fatalf("parse %q: %v", got, err)
			}
			testx.AssertEqual(t, u.Query().Encode(), tt.want.Encode())
			testx.AssertEqual(t, u.Host, "db:5432", "host is kept")
			testx.AssertEqual(t, u.Path, "/goshop", "database is kept")
			pw, _ := u.User.Password()
			testx.AssertEqual(t, pw, secret, "login is kept")
		})
	}
}

func TestOpen_InvalidURL(t *testing.T) {
	bad := databaseURL("db:5432", "") + "%zz" // an invalid escape

	db, err := Open(context.Background(), config.Database{URL: bad}, logx.Noop())

	testx.AssertTrue(t, db == nil, "no pool alongside an error")
	if err == nil {
		t.Fatal("Open: want error, got nil")
	}
	testx.AssertEqual(t, err.Error(), "open database: DATABASE_URL is not a valid URL")
	testx.AssertFalse(t, strings.Contains(err.Error(), secret), "error leaks the password: %v", err)
}

// closedPort returns a local address nothing listens on.
func closedPort(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return addr
}

// silentServer accepts connections and never answers, like a firewall that
// lets the SYN through to a stuck host.
func silentServer(t *testing.T) string {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	var conns []net.Conn
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			c, err := ln.Accept()
			if err != nil {
				for _, c := range conns {
					_ = c.Close()
				}
				return
			}
			conns = append(conns, c)
		}
	}()
	t.Cleanup(func() { _ = ln.Close(); <-done })
	return ln.Addr().String()
}

func pool(dsn string) config.Database {
	return config.Database{URL: dsn, MaxOpenConns: 2, MaxIdleConns: 1, ConnMaxLifetime: time.Minute}
}

func TestOpen_PingFails(t *testing.T) {
	dsn := databaseURL(closedPort(t), "sslmode=disable")

	db, err := Open(context.Background(), pool(dsn), logx.Noop())

	testx.AssertTrue(t, db == nil, "no pool alongside an error")
	if err == nil {
		t.Fatal("Open: want error, got nil")
	}
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "err = %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), secret), "error leaks the password: %v", err)
	testx.AssertFalse(t, strings.Contains(err.Error(), dsn), "error repeats the URL: %v", err)
}

func TestOpen_HonoursTheCallersContext(t *testing.T) {
	dsn := databaseURL(silentServer(t), "sslmode=disable")
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := Open(ctx, pool(dsn), logx.Noop())

	if err == nil {
		t.Fatal("Open: want error, got nil")
	}
	testx.AssertTrue(t, time.Since(start) < 5*time.Second, "Open took %s after a 200ms deadline", time.Since(start))
	testx.AssertFalse(t, strings.Contains(err.Error(), secret), "error leaks the password: %v", err)
}

// Without a deadline from the caller, Open still gives up after
// connectTimeout instead of hanging on a host that never answers. This test
// takes connectTimeout (10s), so it runs in parallel with the others.
func TestOpen_ConnectTimeout(t *testing.T) {
	t.Parallel()
	dsn := databaseURL(silentServer(t), "sslmode=disable")

	start := time.Now()
	_, err := Open(context.Background(), pool(dsn), logx.Noop())
	took := time.Since(start)

	if err == nil {
		t.Fatal("Open: want error, got nil")
	}
	testx.AssertTrue(t, took >= connectTimeout-time.Second, "gave up after %s, before connectTimeout", took)
	testx.AssertTrue(t, took < connectTimeout+5*time.Second, "took %s, well past connectTimeout %s", took, connectTimeout)
	testx.AssertEqual(t, connectTimeout, 10*time.Second)
}

func TestWarnIfNotCustomPlans(t *testing.T) {
	tests := []struct {
		name     string
		values   []string
		queryErr error
		wantWarn string // the logged message; "" for no log line
		wantMode string
	}{
		{name: "custom plans: silent", values: []string{"force_custom_plan"}},
		{
			name: "a pooler dropped the setting", values: []string{"auto"},
			wantWarn: "plan_cache_mode is not force_custom_plan; catalog searches may get slow generic plans", wantMode: "auto",
		},
		{
			name: "generic plans forced", values: []string{"force_generic_plan"},
			wantWarn: "plan_cache_mode is not force_custom_plan; catalog searches may get slow generic plans", wantMode: "force_generic_plan",
		},
		{name: "SHOW fails", queryErr: errors.New("permission denied"), wantWarn: "could not read plan_cache_mode"},
		{name: "SHOW returns no row", values: nil, wantWarn: "could not read plan_cache_mode"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeDB{queryValues: tt.values, queryErr: tt.queryErr}
			var logs bytes.Buffer
			logger := logx.New(logx.WithOutput(&logs), logx.WithFormat("json"))

			warnIfNotCustomPlans(context.Background(), fake.open(t), logger)

			testx.AssertEqual(t, strings.Join(fake.queries, ";"), "SHOW plan_cache_mode")
			if tt.wantWarn == "" {
				testx.AssertEqual(t, logs.Len(), 0, "logged %s", logs.String())
				return
			}
			var line map[string]any
			if err := json.Unmarshal(logs.Bytes(), &line); err != nil {
				t.Fatalf("want one JSON log line, got %q: %v", logs.String(), err)
			}
			testx.AssertEqual(t, line["level"], any("WARN"))
			testx.AssertEqual(t, line["msg"], any(tt.wantWarn))
			if tt.wantMode != "" {
				testx.AssertEqual(t, line["plan_cache_mode"], any(tt.wantMode))
				testx.AssertEqual(t, line["fix"], any("ALTER ROLE <user> SET plan_cache_mode = force_custom_plan"))
			}
			if tt.queryErr != nil {
				testx.AssertEqual(t, line["error"], any("permission denied"))
			}
		})
	}
}
