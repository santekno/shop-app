package auth

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestPostgresRepository_ResetPassword(t *testing.T) {
	_, tok := presentedToken(t, id3)
	db := tokenOwnerDB().
		on("LockUserToken", userTokenRow(tok, PurposeResetPassword, testTime.Add(time.Minute), nil)).
		on("RevokeUserSessions", fakeAnswer{rows: [][]driver.Value{{id4}, {id5}}})

	sessions, err := NewPostgresRepository(db.open(t)).ResetPassword(context.Background(), tok, testTime, "new-hash")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, strings.Join(sessions, ","), id4+","+id5)
	// One transaction: consume, set the hash, verify the email, end every
	// session, drop the other reset tokens.
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,LockUserTokenOwner,LockUserToken,MarkUserTokenUsed,SetUserPassword,MarkEmailVerified,RevokeUserSessions,DeleteUnusedUserTokens,COMMIT")
	assertLockedFirst(t, db, "LockUserTokenOwner")
	set, _ := db.call("SetUserPassword")
	testx.AssertEqual(t, set.args[0], driver.Value("new-hash"))
	testx.AssertEqual(t, set.args[1], driver.Value(id1))
	revoke, _ := db.call("RevokeUserSessions")
	testx.AssertEqual(t, revoke.args[0], driver.Value(id1))
	del, _ := db.call("DeleteUnusedUserTokens")
	testx.AssertEqual(t, del.args[1], driver.Value("reset_password"))
}

func TestPostgresRepository_ResetPasswordRefusesAVerifyToken(t *testing.T) {
	_, tok := presentedToken(t, id3)
	db := tokenOwnerDB().on("LockUserToken", userTokenRow(tok, PurposeVerifyEmail, testTime.Add(time.Hour), nil))
	sessions, err := NewPostgresRepository(db.open(t)).ResetPassword(context.Background(), tok, testTime, "h")
	testx.AssertTrue(t, errors.Is(err, ErrEmailTokenInvalid), "err = %v", err)
	testx.AssertEqual(t, len(sessions), 0)
	testx.AssertFalse(t, db.ran("SetUserPassword"))
}

// No users row for the token: invalid, no password is set and no session
// is touched.
func TestPostgresRepository_ResetPasswordNoOwner(t *testing.T) {
	_, tok := presentedToken(t, id3)
	db := newFakeSQL().on("LockUserToken", userTokenRow(tok, PurposeResetPassword, testTime.Add(time.Minute), nil))
	sessions, err := NewPostgresRepository(db.open(t)).ResetPassword(context.Background(), tok, testTime, "h")
	testx.AssertTrue(t, errors.Is(err, ErrEmailTokenInvalid), "err = %v", err)
	testx.AssertEqual(t, len(sessions), 0)
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockUserTokenOwner,ROLLBACK")
}

func TestPostgresRepository_ResetPasswordErrors(t *testing.T) {
	_, tok := presentedToken(t, id3)
	live := func() *fakeSQL {
		return tokenOwnerDB().on("LockUserToken", userTokenRow(tok, PurposeResetPassword, testTime.Add(time.Minute), nil))
	}
	tests := []struct {
		name   string
		db     *fakeSQL
		prefix string
	}{
		{name: "set password", db: live().on("SetUserPassword", failWith(errBoom)), prefix: "set password: "},
		{name: "verify email", db: live().on("MarkEmailVerified", failWith(errBoom)), prefix: "mark email verified: "},
		{name: "revoke sessions", db: live().on("RevokeUserSessions", failWith(errBoom)), prefix: "revoke sessions: "},
		{name: "delete other tokens", db: live().on("DeleteUnusedUserTokens", failWith(errBoom)), prefix: "delete other reset tokens: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sessions, err := NewPostgresRepository(tt.db.open(t)).ResetPassword(context.Background(), tok, testTime, "h")
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			testx.AssertEqual(t, len(sessions), 0, "no sessions are reported from a rolled back reset")
			names := tt.db.names()
			testx.AssertEqual(t, names[len(names)-1], "ROLLBACK")
		})
	}
}
