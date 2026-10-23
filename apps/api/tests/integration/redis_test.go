//go:build integration

package integration_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/testx"
)

// Every test that starts a server gets a Redis logical database of its own
// on the server REDIS_ADDR points at, emptied before the test and again
// after it:
//
//	redisURL, rdb := newTestRedis(t) // redis://localhost:6379/<n>, empty
//
// Rate-limit counters and revoked sessions of one test can therefore never
// reach another, and a test may count keys. Database 0 is left to the
// Compose api container (the stack test); the tests use 1 to 15. Redis
// has 16 logical databases by default, so at most 15 tests hold one at a
// time and a sixteenth waits for one to be given back.

// firstTestRedisDB and lastTestRedisDB bound the logical databases tests use.
const (
	firstTestRedisDB = 1
	lastTestRedisDB  = 15
)

// redisDBs holds the logical databases no test is using.
var redisDBs = func() chan int {
	c := make(chan int, lastTestRedisDB-firstTestRedisDB+1)
	for n := firstTestRedisDB; n <= lastTestRedisDB; n++ {
		c <- n
	}
	return c
}()

// newTestRedis takes a free logical database, empties it, and returns its
// URL and a client on it. The database is emptied again and given back
// when the test ends, after the test's servers have stopped (the cleanup
// is registered first, so it runs last).
func newTestRedis(t *testing.T) (string, *redis.Client) {
	t.Helper()
	// testx skips the test when REDIS_ADDR is unset or Redis does not
	// answer; make test-integration always sets it and fails on any skip.
	addr := testx.RedisContainer(t)

	var n int
	select {
	case n = <-redisDBs:
	case <-time.After(2 * time.Minute):
		t.Fatal("no free Redis test database after 2 minutes; does a test keep one?")
	}
	client := redis.NewClient(&redis.Options{Addr: addr, DB: n})
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := client.FlushDB(ctx).Err(); err != nil {
			t.Errorf("flush Redis test database %d: %v", n, err)
		}
		_ = client.Close()
		redisDBs <- n
	})
	if err := client.FlushDB(t.Context()).Err(); err != nil {
		t.Fatalf("flush Redis test database %d: %v", n, err)
	}
	return fmt.Sprintf("redis://%s/%d", addr, n), client
}

// redisKeys lists the keys matching pattern in the server's own Redis
// database.
func (s *server) redisKeys(t *testing.T, pattern string) []string {
	t.Helper()
	if s.rdb == nil {
		t.Fatal("this server has no Redis client of the test's own")
	}
	var out []string
	iter := s.rdb.Scan(t.Context(), 0, pattern, 100).Iterator()
	for iter.Next(t.Context()) {
		out = append(out, iter.Val())
	}
	if err := iter.Err(); err != nil {
		t.Fatalf("scan %s: %v", pattern, err)
	}
	return out
}

// TestRedis_IsolatedPerTest checks the isolation the other tests rely on:
// two servers started in one test write to different logical databases,
// and a database is empty when a test receives it.
func TestRedis_IsolatedPerTest(t *testing.T) {
	_, a := newTestRedis(t)
	_, b := newTestRedis(t)
	if a.Options().DB == b.Options().DB {
		t.Fatalf("two newTestRedis calls returned the same database %d", a.Options().DB)
	}
	for _, c := range []*redis.Client{a, b} {
		if n, err := c.DBSize(t.Context()).Result(); err != nil || n != 0 {
			t.Fatalf("database %d holds %d keys (err %v), want an empty one", c.Options().DB, n, err)
		}
	}
	if err := a.Set(t.Context(), "goshop:it:probe", "1", time.Minute).Err(); err != nil {
		t.Fatalf("set: %v", err)
	}
	if n, err := b.Exists(t.Context(), "goshop:it:probe").Result(); err != nil || n != 0 {
		t.Errorf("a key written to database %d is visible in database %d (exists=%d, err %v)",
			a.Options().DB, b.Options().DB, n, err)
	}
}
