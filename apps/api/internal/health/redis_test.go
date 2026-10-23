package health_test

import (
	"context"
	"errors"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/health"
)

func TestRedisCheck(t *testing.T) {
	for _, pingErr := range []error{nil, errors.New("redis ping: dial tcp 10.0.0.6:6379: connection refused")} {
		r := &fakePinger{err: pingErr}
		check := health.RedisCheck(r)
		testx.AssertEqual(t, check.Name, "redis")
		testx.AssertEqual(t, check.Name, health.RedisCheckName)
		testx.AssertEqual(t, r.calls, 0, "building the check does not ping")

		ctx := context.WithValue(context.Background(), ctxKey{}, "probe")
		err := check.Check(ctx)

		testx.AssertEqual(t, r.calls, 1)
		testx.AssertTrue(t, errors.Is(err, pingErr) && (err == nil) == (pingErr == nil), "err = %v", err)
		testx.AssertEqual(t, r.ctx.Value(ctxKey{}), any("probe"))
	}
}

// Redis down makes /readyz 503 under "redis", with PostgreSQL still ok, so
// the load balancer drains an instance whose auth would fail closed.
func TestRedisCheck_InReadiness(t *testing.T) {
	r := &fakePinger{err: errors.New("connection refused")}
	h := health.NewHandler(logx.Noop(), &health.Readiness{}, false,
		health.PostgresCheck(&fakePinger{}), health.RedisCheck(r))

	code, body, _ := probe(t, h, "/readyz")
	testx.AssertEqual(t, code, 503)
	testx.AssertEqual(t, body.Checks["redis"].Status, "unavailable")
	testx.AssertEqual(t, body.Checks["redis"].Error, "connection refused")
	testx.AssertEqual(t, body.Checks["postgres"].Status, "ok")

	r.err = nil
	code, body, _ = probe(t, h, "/readyz")
	testx.AssertEqual(t, code, 200)
	testx.AssertEqual(t, body.Checks["redis"].Status, "ok")
}
