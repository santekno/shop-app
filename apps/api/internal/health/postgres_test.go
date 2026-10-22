package health_test

import (
	"context"
	"errors"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/health"
)

// fakePinger stands in for *sql.DB: it records the context it was pinged
// with and returns err.
type fakePinger struct {
	err   error
	calls int
	ctx   context.Context
}

func (p *fakePinger) PingContext(ctx context.Context) error {
	p.calls++
	p.ctx = ctx
	return p.err
}

type ctxKey struct{}

func TestPostgresCheck(t *testing.T) {
	refused := errors.New("dial tcp 10.0.0.5:5432: connect: connection refused")
	tests := []struct {
		name    string
		pingErr error
	}{
		{name: "reachable", pingErr: nil},
		{name: "unreachable", pingErr: refused},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := &fakePinger{err: tt.pingErr}
			check := health.PostgresCheck(db)
			testx.AssertEqual(t, check.Name, "postgres")
			testx.AssertEqual(t, check.Name, health.PostgresCheckName)
			testx.AssertEqual(t, db.calls, 0, "building the check does not ping")

			ctx := context.WithValue(context.Background(), ctxKey{}, "probe")
			err := check.Check(ctx)

			testx.AssertEqual(t, db.calls, 1)
			testx.AssertTrue(t, errors.Is(err, tt.pingErr), "err = %v, want %v", err, tt.pingErr)
			testx.AssertTrue(t, (err == nil) == (tt.pingErr == nil), "err = %v", err)
			testx.AssertEqual(t, db.ctx.Value(ctxKey{}), any("probe"), "the probe's context reaches the ping")
		})
	}
}

// Through NewHandler, a failing database makes /readyz 503 under the
// "postgres" name while /healthz stays 200.
func TestPostgresCheck_InReadiness(t *testing.T) {
	db := &fakePinger{err: errors.New("connection refused")}
	h := health.NewHandler(logx.Noop(), &health.Readiness{}, false, health.PostgresCheck(db))

	code, body, _ := probe(t, h, "/readyz")
	testx.AssertEqual(t, code, 503)
	testx.AssertEqual(t, body.Checks["postgres"].Status, "unavailable")
	testx.AssertEqual(t, body.Checks["postgres"].Error, "connection refused")
	testx.AssertEqual(t, body.Checks["server"].Status, "ok")

	code, _, _ = probe(t, h, "/healthz")
	testx.AssertEqual(t, code, 200, "liveness never runs the database check")
	testx.AssertEqual(t, db.calls, 1)
}
