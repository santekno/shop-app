package user_test

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// recordingHook runs one statement through the deletion's queries (so the
// fake database shows where it ran) and records the user it was given.
func recordingHook(name string, seen *[]string, err error) user.DeleteHook {
	return func(ctx context.Context, q *sqlc.Queries, userID string) error {
		*seen = append(*seen, name+":"+userID)
		if err != nil {
			return err
		}
		return q.DeleteUserIdempotencyKeys(ctx, userID)
	}
}

// The hooks run in the deletion's transaction, after the users row and the
// sessions, in the order given (ADR 0006: Bab 5 cancels the unpaid orders
// and deletes the cart there).
func TestPostgresRepository_AnonymiseRunsTheHooks(t *testing.T) {
	db := newFakeSQL().on("RevokeUserSessions", fakeAnswer{rows: [][]driver.Value{{"s1"}}})
	var seen []string
	repo := user.NewPostgresRepository(db.open(t), recordingHook("orders", &seen, nil), recordingHook("cart", &seen, nil))

	sessions, err := repo.Anonymise(context.Background(), uid)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, strings.Join(sessions, ","), "s1")
	testx.AssertEqual(t, strings.Join(seen, ","), "orders:"+uid+",cart:"+uid)
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,AnonymizeUser,DeleteUserAddresses,DeleteUserIdentities,DeleteUserTokens,RevokeUserSessions,"+
			"DeleteUserIdempotencyKeys,DeleteUserIdempotencyKeys,COMMIT")
}

func TestPostgresRepository_AnonymiseHookErrors(t *testing.T) {
	t.Run("a failing hook rolls the whole deletion back", func(t *testing.T) {
		db := newFakeSQL()
		var seen []string
		repo := user.NewPostgresRepository(db.open(t),
			recordingHook("orders", &seen, errBoom), recordingHook("cart", &seen, nil))
		sessions, err := repo.Anonymise(context.Background(), uid)
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, len(sessions), 0, "no sessions are reported revoked")
		testx.AssertEqual(t, strings.Join(seen, ","), "orders:"+uid, "the next hook does not run")
		names := db.names()
		testx.AssertEqual(t, names[len(names)-1], "ROLLBACK")
		testx.AssertFalse(t, strings.Contains(strings.Join(names, ","), "COMMIT"))
	})
	t.Run("an account already deleted runs no hook", func(t *testing.T) {
		db := newFakeSQL().on("AnonymizeUser", fakeAnswer{affected: 0})
		var seen []string
		_, err := user.NewPostgresRepository(db.open(t), recordingHook("orders", &seen, nil)).Anonymise(context.Background(), uid)
		testx.AssertTrue(t, errors.Is(err, user.ErrNotFound))
		testx.AssertEqual(t, len(seen), 0)
	})
	t.Run("a step before the hooks fails: no hook runs", func(t *testing.T) {
		db := newFakeSQL().on("RevokeUserSessions", failWith(errBoom))
		var seen []string
		_, err := user.NewPostgresRepository(db.open(t), recordingHook("orders", &seen, nil)).Anonymise(context.Background(), uid)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, len(seen), 0)
	})
}
