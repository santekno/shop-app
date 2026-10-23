package user_test

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestService_Delete(t *testing.T) {
	t.Run("ends every session in Redis", func(t *testing.T) {
		rev := &fakeRevoker{}
		svc := user.NewService(&fakeRepo{anonymise: func(string) ([]string, error) { return []string{"s1", "s2"}, nil }}, rev)
		testx.AssertNoError(t, svc.Delete(context.Background(), uid))
		testx.AssertEqual(t, len(rev.calls), 1)
		if len(rev.calls) == 1 {
			testx.AssertEqual(t, strings.Join(rev.calls[0], ","), "s1,s2")
		}
	})
	t.Run("no session, no Redis call", func(t *testing.T) {
		rev := &fakeRevoker{}
		svc := user.NewService(&fakeRepo{anonymise: func(string) ([]string, error) { return nil, nil }}, rev)
		testx.AssertNoError(t, svc.Delete(context.Background(), uid))
		testx.AssertEqual(t, len(rev.calls), 0)
	})
	t.Run("a Redis failure is logged: the account is gone either way", func(t *testing.T) {
		var logs bytes.Buffer
		ctx := logx.WithContextLogger(context.Background(), logx.New(logx.WithOutput(&logs), logx.WithFormat("json")))
		rev := &fakeRevoker{err: errBoom}
		svc := user.NewService(&fakeRepo{anonymise: func(string) ([]string, error) { return []string{"s1"}, nil }}, rev)
		testx.AssertNoError(t, svc.Delete(ctx, uid))
		testx.AssertContains(t, logs.String(), `"msg":"revoke access tokens of a deleted account"`)
		testx.AssertContains(t, logs.String(), `"level":"ERROR"`)
		testx.AssertContains(t, logs.String(), `"sessions":1`)
	})
	t.Run("not found", func(t *testing.T) {
		rev := &fakeRevoker{}
		svc := user.NewService(&fakeRepo{anonymise: func(string) ([]string, error) { return nil, user.ErrNotFound }}, rev)
		err := svc.Delete(context.Background(), uid)
		testx.AssertTrue(t, errors.Is(err, user.ErrNotFound), "err = %v", err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "delete user "+uid+": "), "err = %v", err)
		testx.AssertEqual(t, len(rev.calls), 0)
	})
}
