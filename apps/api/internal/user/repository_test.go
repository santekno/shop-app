package user_test

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// userRow is a users row in sqlc's column order; phone and verified are
// nil for NULL.
func userRow(phone, verified driver.Value) fakeAnswer {
	return rows(uid, "budi@example.com", "hash", "Budi", phone, "seller", verified, testTime, testTime)
}

func TestPostgresRepository_Get(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByID", userRow("081234567890", testTime))
		u, err := user.NewPostgresRepository(db.open(t)).Get(context.Background(), uid)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, u.ID, uid)
		testx.AssertEqual(t, u.Email, "budi@example.com")
		testx.AssertEqual(t, u.Name, "Budi")
		testx.AssertEqual(t, u.Role, user.RoleSeller)
		testx.AssertTrue(t, u.Phone != nil && *u.Phone == "081234567890")
		testx.AssertTrue(t, u.EmailVerifiedAt != nil && u.EmailVerifiedAt.Equal(testTime))
		testx.AssertTrue(t, u.CreatedAt.Equal(testTime) && u.UpdatedAt.Equal(testTime))
		call, _ := db.call("GetUserByID")
		testx.AssertEqual(t, call.args[0], driver.Value(uid))
	})
	t.Run("NULL phone and unverified", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByID", userRow(nil, nil))
		u, err := user.NewPostgresRepository(db.open(t)).Get(context.Background(), uid)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, u.Phone == nil)
		testx.AssertFalse(t, u.EmailVerified())
	})
	t.Run("gone", func(t *testing.T) {
		_, err := user.NewPostgresRepository(newFakeSQL().open(t)).Get(context.Background(), uid)
		testx.AssertTrue(t, errors.Is(err, user.ErrNotFound), "err = %v", err)
	})
	t.Run("query fails", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByID", failWith(errBoom))
		_, err := user.NewPostgresRepository(db.open(t)).Get(context.Background(), uid)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query user: "), "err = %v", err)
	})
}

func TestPostgresRepository_Update(t *testing.T) {
	name, phone := "Budi Santoso", "081234567890"
	tests := []struct {
		name     string
		update   user.ProfileUpdate
		wantArgs []driver.Value // name, set_phone, phone, id
	}{
		{name: "nothing", update: user.ProfileUpdate{}, wantArgs: []driver.Value{nil, false, nil, uid}},
		{name: "name", update: user.ProfileUpdate{Name: &name}, wantArgs: []driver.Value{name, false, nil, uid}},
		{name: "phone", update: user.ProfileUpdate{SetPhone: true, Phone: &phone}, wantArgs: []driver.Value{nil, true, phone, uid}},
		{name: "clear phone", update: user.ProfileUpdate{SetPhone: true}, wantArgs: []driver.Value{nil, true, nil, uid}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on("UpdateUserProfile", userRow(nil, nil))
			u, err := user.NewPostgresRepository(db.open(t)).Update(context.Background(), uid, tt.update)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, u.ID, uid)
			call, _ := db.call("UpdateUserProfile")
			testx.AssertEqual(t, len(call.args), 4)
			for i, want := range tt.wantArgs {
				testx.AssertEqual(t, call.args[i], want, "arg %d", i)
			}
		})
	}
	t.Run("gone", func(t *testing.T) {
		_, err := user.NewPostgresRepository(newFakeSQL().open(t)).Update(context.Background(), uid, user.ProfileUpdate{})
		testx.AssertTrue(t, errors.Is(err, user.ErrNotFound), "err = %v", err)
	})
	t.Run("query fails", func(t *testing.T) {
		db := newFakeSQL().on("UpdateUserProfile", failWith(errBoom))
		_, err := user.NewPostgresRepository(db.open(t)).Update(context.Background(), uid, user.ProfileUpdate{})
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "update user: "), "err = %v", err)
	})
}

func TestPostgresRepository_Anonymise(t *testing.T) {
	db := newFakeSQL().on("RevokeUserSessions", fakeAnswer{rows: [][]driver.Value{{"s1"}, {"s2"}}})

	sessions, err := user.NewPostgresRepository(db.open(t)).Anonymise(context.Background(), uid)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, strings.Join(sessions, ","), "s1,s2")
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,AnonymizeUser,DeleteUserAddresses,DeleteUserIdentities,DeleteUserTokens,RevokeUserSessions,COMMIT")
	for _, name := range []string{"AnonymizeUser", "DeleteUserAddresses", "DeleteUserIdentities", "DeleteUserTokens", "RevokeUserSessions"} {
		call, _ := db.call(name)
		testx.AssertEqual(t, call.args[0], driver.Value(uid), "%s is for the caller", name)
	}
}

func TestPostgresRepository_AnonymiseErrors(t *testing.T) {
	tests := []struct {
		name   string
		db     *fakeSQL
		want   error
		prefix string
	}{
		{name: "already deleted", db: newFakeSQL().on("AnonymizeUser", fakeAnswer{affected: 0}), want: user.ErrNotFound},
		{name: "anonymise", db: newFakeSQL().on("AnonymizeUser", failWith(errBoom)), prefix: "anonymise user: "},
		{name: "addresses", db: newFakeSQL().on("DeleteUserAddresses", failWith(errBoom)), prefix: "delete addresses: "},
		{name: "identities", db: newFakeSQL().on("DeleteUserIdentities", failWith(errBoom)), prefix: "delete identities: "},
		{name: "tokens", db: newFakeSQL().on("DeleteUserTokens", failWith(errBoom)), prefix: "delete email tokens: "},
		{name: "sessions", db: newFakeSQL().on("RevokeUserSessions", failWith(errBoom)), prefix: "revoke sessions: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sessions, err := user.NewPostgresRepository(tt.db.open(t)).Anonymise(context.Background(), uid)
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v", err)
			} else {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			}
			testx.AssertEqual(t, len(sessions), 0)
			names := tt.db.names()
			testx.AssertEqual(t, names[len(names)-1], "ROLLBACK")
		})
	}
}
