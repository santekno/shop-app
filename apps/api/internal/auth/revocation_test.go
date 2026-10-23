package auth

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/redisx"
	"github.com/santekno/sdk/testx"
)

// fakeKV is an in-memory redisx.RedisClient that records every Set.
type fakeKV struct {
	mu     sync.Mutex
	values map[string]string
	ttls   map[string]time.Duration
	sets   []string
	getErr error
	setErr error
}

func newFakeKV() *fakeKV {
	return &fakeKV{values: map[string]string{}, ttls: map[string]time.Duration{}}
}

func (kv *fakeKV) Get(_ context.Context, key string) (string, error) {
	kv.mu.Lock()
	defer kv.mu.Unlock()
	if kv.getErr != nil {
		return "", kv.getErr
	}
	v, ok := kv.values[key]
	if !ok {
		return "", redisx.ErrKeyNotFound
	}
	return v, nil
}

func (kv *fakeKV) Set(_ context.Context, key string, value any, ttl time.Duration) error {
	kv.mu.Lock()
	defer kv.mu.Unlock()
	kv.sets = append(kv.sets, key)
	if kv.setErr != nil {
		return kv.setErr
	}
	kv.values[key], kv.ttls[key] = value.(string), ttl
	return nil
}

func (kv *fakeKV) Del(context.Context, ...string) error { return errors.New("Del is not used") }

func (kv *fakeKV) SetNX(context.Context, string, any, time.Duration) (bool, error) {
	return false, errors.New("SetNX is not used")
}

func TestRedisSessionRevocations(t *testing.T) {
	kv := newFakeKV()
	r := NewRedisSessionRevocations(kv, 15*time.Minute)
	ctx := context.Background()

	revoked, err := r.IsRevoked(ctx, id2)
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, revoked, "a missing key is a live session")

	testx.AssertNoError(t, r.Revoke(ctx, id2, id3))

	// One key per session, living as long as an access token.
	testx.AssertEqual(t, strings.Join(kv.sets, ","), "goshop:session-revoked:"+id2+",goshop:session-revoked:"+id3)
	testx.AssertEqual(t, kv.ttls["goshop:session-revoked:"+id2], 15*time.Minute)
	testx.AssertEqual(t, kv.values["goshop:session-revoked:"+id2], "1")
	for _, id := range []string{id2, id3} {
		revoked, err = r.IsRevoked(ctx, id)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, revoked, "session %s", id)
	}
	revoked, err = r.IsRevoked(ctx, id4)
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, revoked, "other sessions are untouched")

	testx.AssertNoError(t, r.Revoke(ctx), "no sessions is nothing to do")
}

func TestRedisSessionRevocations_Errors(t *testing.T) {
	t.Run("Revoke stops at the first failure", func(t *testing.T) {
		kv := newFakeKV()
		kv.setErr = errBoom
		err := NewRedisSessionRevocations(kv, time.Minute).Revoke(context.Background(), id2, id3)
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "revoke session "+id2+": boom")
		testx.AssertEqual(t, len(kv.sets), 1)
	})
	t.Run("IsRevoked reports a Redis failure instead of saying no", func(t *testing.T) {
		kv := newFakeKV()
		kv.getErr = errBoom
		revoked, err := NewRedisSessionRevocations(kv, time.Minute).IsRevoked(context.Background(), id2)
		testx.AssertFalse(t, revoked)
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "check session "+id2+": boom")
	})
}

// Logout must reach Redis: a client that sees the error logs out again,
// which finds the same session and retries.
func TestService_LogoutRedisFailureIsReturned(t *testing.T) {
	raw, _ := presentedToken(t, id1)
	env := newServiceEnv(t, nil)
	env.revoked.revokeErr = errBoom
	env.repo.revokeSessionOf = func(opaqueToken) (string, error) { return id2, nil }

	err := env.svc.Logout(env.ctx, raw)

	testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "logout: "), "err = %v", err)
}

// Refresh-token reuse with Redis down: the session is still revoked in
// PostgreSQL, the caller still gets "invalid", and the failure is logged.
func TestService_RefreshReuseWithRedisDown(t *testing.T) {
	raw, _ := presentedToken(t, id1)
	env := newServiceEnv(t, nil)
	env.revoked.revokeErr = errBoom
	env.repo.rotateRefreshToken = func(_, _ opaqueToken, _, _ time.Time) (Rotated, error) {
		return Rotated{FamilyID: id2}, ErrRefreshTokenReused
	}

	_, err := env.svc.Refresh(env.ctx, raw)

	testx.AssertTrue(t, errors.Is(err, ErrRefreshTokenInvalid), "err = %v", err)
	line, ok := findLog(t, env.logs, "revoke access tokens of ended sessions")
	testx.AssertTrue(t, ok, "logs: %s", env.logs.String())
	testx.AssertEqual(t, line["sessions"], any(float64(1)))
}
