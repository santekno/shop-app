package app_test

import (
	"context"
	"errors"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgproto3"
)

// fakePG is a tiny in-process PostgreSQL server: it speaks just enough of
// the wire protocol (startup, simple and extended queries, transactions)
// for pgx, so the commands that open DATABASE_URL themselves (Run's
// serve, migrate, the jobs, fake-pay) run against it in a unit test. No
// PostgreSQL is needed; the SQL itself runs against PostgreSQL in
// tests/integration.
//
// A statement is answered by the first rule whose match is in its SQL:
// rows of text columns, or an error. Without a rule a query returns no
// rows and an exec changes none. Every statement's sqlc name (or its
// first line) and text parameters are recorded.
type fakePG struct {
	ln    net.Listener
	rules []pgRule

	mu    sync.Mutex
	calls []pgCall
}

// pgRule answers the statements whose SQL contains match.
type pgRule struct {
	match string
	rows  [][]string
	err   string
}

// pgCall is one statement run: its name and parameters as text.
type pgCall struct {
	name   string
	params []string
}

func newFakePG(t *testing.T, rules ...pgRule) *fakePG {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	f := &fakePG{ln: ln, rules: rules}
	go f.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return f
}

// url is a DATABASE_URL for f.
func (f *fakePG) url() string {
	return "postgres://goshop:goshop@" + f.ln.Addr().String() + "/goshop?sslmode=disable"
}

// names lists the statements run, in order.
func (f *fakePG) names() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.calls))
	for _, c := range f.calls {
		out = append(out, c.name)
	}
	return out
}

// call returns the first statement called name.
func (f *fakePG) call(name string) (pgCall, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.calls {
		if c.name == name {
			return c, true
		}
	}
	return pgCall{}, false
}

func (f *fakePG) serve() {
	for {
		conn, err := f.ln.Accept()
		if err != nil {
			return
		}
		go f.handle(conn)
	}
}

// pgSession is one client connection.
type pgSession struct {
	f       *fakePG
	be      *pgproto3.Backend
	stmts   map[string]string // prepared statement name → SQL
	portals map[string]string // portal name → SQL
	tx      byte              // 'I' idle, 'T' in a transaction
	failed  bool              // an error: skip to Sync
}

func (f *fakePG) handle(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	s := &pgSession{f: f, be: pgproto3.NewBackend(conn, conn), stmts: map[string]string{}, portals: map[string]string{}, tx: 'I'}
	if err := s.startup(conn); err != nil {
		return
	}
	for {
		msg, err := s.be.Receive()
		if err != nil {
			return
		}
		if !s.answer(msg) {
			return
		}
	}
}

func (s *pgSession) startup(conn net.Conn) error {
	for {
		msg, err := s.be.ReceiveStartupMessage()
		if err != nil {
			return err //nolint:wrapcheck // ends the session
		}
		switch msg.(type) {
		case *pgproto3.SSLRequest, *pgproto3.GSSEncRequest:
			if _, err := conn.Write([]byte("N")); err != nil {
				return err //nolint:wrapcheck // ends the session
			}
			continue
		case *pgproto3.StartupMessage:
		default:
			return errors.New("unexpected startup message")
		}
		s.be.Send(&pgproto3.AuthenticationOk{})
		for k, v := range map[string]string{
			"server_version": "17.0", "client_encoding": "UTF8", "standard_conforming_strings": "on",
			"DateStyle": "ISO, MDY", "integer_datetimes": "on", "TimeZone": "UTC",
		} {
			s.be.Send(&pgproto3.ParameterStatus{Name: k, Value: v})
		}
		s.be.Send(&pgproto3.BackendKeyData{ProcessID: 1, SecretKey: []byte{0, 0, 0, 1}})
		s.be.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
		return s.be.Flush() //nolint:wrapcheck // ends the session
	}
}

// answer handles one frontend message; false ends the session.
func (s *pgSession) answer(msg pgproto3.FrontendMessage) bool {
	switch m := msg.(type) {
	case *pgproto3.Query:
		s.simple(m.String)
		return s.be.Flush() == nil
	case *pgproto3.Parse:
		if !s.failed {
			s.stmts[m.Name] = m.Query
			s.be.Send(&pgproto3.ParseComplete{})
		}
	case *pgproto3.Describe:
		if s.failed {
			break
		}
		sql := s.portals[m.Name]
		if m.ObjectType == 'S' {
			sql = s.stmts[m.Name]
			s.be.Send(&pgproto3.ParameterDescription{ParameterOIDs: make([]uint32, paramCount(sql))})
		}
		s.describe(s.f.rule(sql))
	case *pgproto3.Bind:
		if s.failed {
			break
		}
		sql := s.stmts[m.PreparedStatement]
		s.portals[m.DestinationPortal] = sql
		params := make([]string, 0, len(m.Parameters))
		for _, p := range m.Parameters {
			params = append(params, string(p))
		}
		s.f.record(sql, params)
		s.be.Send(&pgproto3.BindComplete{})
	case *pgproto3.Execute:
		if s.failed {
			break
		}
		s.execute(s.portals[m.Portal])
	case *pgproto3.Sync:
		s.failed = false
		s.be.Send(&pgproto3.ReadyForQuery{TxStatus: s.tx})
		return s.be.Flush() == nil
	case *pgproto3.Close:
		if !s.failed {
			s.be.Send(&pgproto3.CloseComplete{})
		}
	case *pgproto3.Flush:
		return s.be.Flush() == nil
	case *pgproto3.Terminate:
		return false
	}
	return true
}

// simple answers a simple-protocol query: transaction control, pings and
// statements without parameters.
func (s *pgSession) simple(sql string) {
	word := firstWord(sql)
	switch word {
	case "BEGIN", "START":
		s.tx = 'T'
	case "COMMIT", "ROLLBACK", "END":
		s.tx = 'I'
	}
	s.f.record(sql, nil)
	r := s.f.rule(sql)
	if r.err != "" {
		s.be.Send(&pgproto3.ErrorResponse{Severity: "ERROR", Code: "XX000", Message: r.err})
	} else {
		s.describe(r)
		s.sendRows(r, word)
	}
	s.be.Send(&pgproto3.ReadyForQuery{TxStatus: s.tx})
}

func (s *pgSession) describe(r pgRule) {
	if len(r.rows) == 0 || r.err != "" {
		s.be.Send(&pgproto3.NoData{})
		return
	}
	fields := make([]pgproto3.FieldDescription, len(r.rows[0]))
	for i := range fields {
		fields[i] = pgproto3.FieldDescription{Name: []byte("c" + strconv.Itoa(i)), DataTypeOID: 25, DataTypeSize: -1, TypeModifier: -1}
	}
	s.be.Send(&pgproto3.RowDescription{Fields: fields})
}

func (s *pgSession) execute(sql string) {
	r := s.f.rule(sql)
	if r.err != "" {
		s.be.Send(&pgproto3.ErrorResponse{Severity: "ERROR", Code: "XX000", Message: r.err})
		s.failed = true
		return
	}
	s.sendRows(r, firstWord(sql))
}

func (s *pgSession) sendRows(r pgRule, word string) {
	for _, row := range r.rows {
		values := make([][]byte, len(row))
		for i, v := range row {
			values[i] = []byte(v)
		}
		s.be.Send(&pgproto3.DataRow{Values: values})
	}
	n := strconv.Itoa(len(r.rows))
	switch word {
	case "SELECT", "WITH", "SHOW", "":
		s.be.Send(&pgproto3.CommandComplete{CommandTag: []byte("SELECT " + n)})
	case "INSERT":
		s.be.Send(&pgproto3.CommandComplete{CommandTag: []byte("INSERT 0 " + n)})
	default:
		s.be.Send(&pgproto3.CommandComplete{CommandTag: []byte(word + " " + n)})
	}
}

func (f *fakePG) rule(sql string) pgRule {
	for _, r := range f.rules {
		if strings.Contains(sql, r.match) {
			return r
		}
	}
	return pgRule{}
}

func (f *fakePG) record(sql string, params []string) {
	name := strings.TrimSpace(sql)
	if rest, ok := strings.CutPrefix(name, "-- name: "); ok {
		name, _, _ = strings.Cut(rest, " ")
	} else {
		name, _, _ = strings.Cut(name, "\n")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, pgCall{name: name, params: params})
}

var paramRef = regexp.MustCompile(`\$([0-9]+)`)

// paramCount is the highest $n in sql.
func paramCount(sql string) int {
	n := 0
	for _, m := range paramRef.FindAllStringSubmatch(sql, -1) {
		if i, err := strconv.Atoi(m[1]); err == nil && i > n {
			n = i
		}
	}
	return n
}

// firstWord is the first SQL keyword of sql, after comment lines.
func firstWord(sql string) string {
	for line := range strings.SplitSeq(sql, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		word, _, _ := strings.Cut(line, " ")
		return strings.ToUpper(strings.TrimRight(word, ";"))
	}
	return ""
}
