package auth

import (
	"bytes"
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// userTokenRow is a LockUserToken row for tok; change edits it by column.
func userTokenRow(tok opaqueToken, purpose Purpose, expires time.Time, change func(row []driver.Value)) fakeAnswer {
	// id, user_id, purpose, token_hash, expires_at, used_at, anonymized_at
	row := []driver.Value{tok.ID, id1, string(purpose), tok.Hash, expires, nil, nil}
	if change != nil {
		change(row)
	}
	return fakeAnswer{rows: [][]driver.Value{row}}
}

// tokenOwnerDB is a database where the token's owner exists, so
// LockUserTokenOwner (FOR NO KEY UPDATE) finds the users row.
func tokenOwnerDB() *fakeSQL { return newFakeSQL().on("LockUserTokenOwner", rows(id1)) }

// userDB is a database where LockUser (FOR UPDATE) finds the user.
func userDB() *fakeSQL { return newFakeSQL().on("LockUser", rows(id1)) }

func TestPostgresRepository_CreateEmailToken(t *testing.T) {
	_, tok := presentedToken(t, id3)
	db := userDB()
	expires := testTime.Add(24 * time.Hour)

	err := NewPostgresRepository(db.open(t)).CreateEmailToken(context.Background(), NewEmailToken{
		Token: tok, UserID: id1, Purpose: PurposeVerifyEmail, ExpiresAt: expires,
	})

	testx.AssertNoError(t, err)
	// The user is locked first; then the older unused tokens of the same
	// purpose go, in the same transaction.
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockUser,DeleteUnusedUserTokens,InsertUserToken,COMMIT")
	assertLockedFirst(t, db, "LockUser")
	lock, _ := db.call("LockUser")
	testx.AssertEqual(t, lock.args[0], driver.Value(id1))
	del, _ := db.call("DeleteUnusedUserTokens")
	testx.AssertEqual(t, del.args[0], driver.Value(id1))
	testx.AssertEqual(t, del.args[1], driver.Value("verify_email"))
	ins, _ := db.call("InsertUserToken")
	testx.AssertEqual(t, ins.args[0], driver.Value(id3))
	testx.AssertEqual(t, ins.args[1], driver.Value(id1))
	testx.AssertEqual(t, ins.args[2], driver.Value("verify_email"))
	testx.AssertTrue(t, bytes.Equal(ins.args[3].([]byte), tok.Hash))
	testx.AssertTrue(t, ins.args[4].(time.Time).Equal(expires))
}

func TestPostgresRepository_CreateEmailTokenErrors(t *testing.T) {
	_, tok := presentedToken(t, id3)
	for name, tt := range map[string]struct {
		db     *fakeSQL
		prefix string
	}{
		"lock user": {db: newFakeSQL().on("LockUser", failWith(errBoom)), prefix: "lock user: "},
		"delete":    {db: userDB().on("DeleteUnusedUserTokens", failWith(errBoom)), prefix: "delete old tokens: "},
		"insert":    {db: userDB().on("InsertUserToken", failWith(errBoom)), prefix: "insert token: "},
	} {
		t.Run(name, func(t *testing.T) {
			err := NewPostgresRepository(tt.db.open(t)).CreateEmailToken(context.Background(), NewEmailToken{Token: tok})
			testx.AssertTrue(t, errors.Is(err, errBoom))
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			names := tt.db.names()
			testx.AssertEqual(t, names[len(names)-1], "ROLLBACK")
		})
	}
}

// A deleted account (no LockUser row) gets no token, and nothing is deleted.
func TestPostgresRepository_CreateEmailTokenNoUser(t *testing.T) {
	_, tok := presentedToken(t, id3)
	db := newFakeSQL()
	err := NewPostgresRepository(db.open(t)).CreateEmailToken(context.Background(), NewEmailToken{Token: tok, UserID: id1})
	testx.AssertTrue(t, errors.Is(err, ErrNoUser), "err = %v", err)
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockUser,ROLLBACK")
}

func TestPostgresRepository_VerifyEmail(t *testing.T) {
	_, tok := presentedToken(t, id3)
	db := tokenOwnerDB().on("LockUserToken", userTokenRow(tok, PurposeVerifyEmail, testTime.Add(time.Hour), nil))

	err := NewPostgresRepository(db.open(t)).VerifyEmail(context.Background(), tok, testTime)

	testx.AssertNoError(t, err)
	// The token's user first, then the token, in one transaction.
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,LockUserTokenOwner,LockUserToken,MarkUserTokenUsed,MarkEmailVerified,COMMIT")
	assertLockedFirst(t, db, "LockUserTokenOwner")
	owner, _ := db.call("LockUserTokenOwner")
	testx.AssertEqual(t, owner.args[0], driver.Value(id3), "the owner of the presented token")
	used, _ := db.call("MarkUserTokenUsed")
	testx.AssertEqual(t, used.args[0], driver.Value(id3))
	verified, _ := db.call("MarkEmailVerified")
	testx.AssertEqual(t, verified.args[0], driver.Value(id1), "the token's user, not the caller's say-so")
}

// Every way a token cannot be used, for both purposes' consumers.
func TestConsumeEmailToken_Refusals(t *testing.T) {
	_, tok := presentedToken(t, id3)
	_, wrongSecret := newOpaqueTokenWithID(t, id3)
	now := testTime
	tests := []struct {
		name      string
		presented opaqueToken
		row       fakeAnswer
		want      error
	}{
		{name: "unknown", presented: tok, row: fakeAnswer{}, want: ErrEmailTokenInvalid},
		{name: "wrong secret", presented: wrongSecret, row: userTokenRow(tok, PurposeVerifyEmail, now.Add(time.Hour), nil), want: ErrEmailTokenInvalid},
		// A reset token cannot verify an email, and the other way round.
		{name: "another purpose", presented: tok, row: userTokenRow(tok, PurposeResetPassword, now.Add(time.Hour), nil), want: ErrEmailTokenInvalid},
		{name: "already used", presented: tok,
			row:  userTokenRow(tok, PurposeVerifyEmail, now.Add(time.Hour), func(r []driver.Value) { r[5] = now }),
			want: ErrEmailTokenInvalid},
		{name: "account deleted", presented: tok,
			row:  userTokenRow(tok, PurposeVerifyEmail, now.Add(time.Hour), func(r []driver.Value) { r[6] = now }),
			want: ErrEmailTokenInvalid},
		{name: "expires exactly now", presented: tok, row: userTokenRow(tok, PurposeVerifyEmail, now, nil), want: ErrEmailTokenExpired},
		// A used token is invalid even when it is also expired.
		{name: "used and expired", presented: tok,
			row:  userTokenRow(tok, PurposeVerifyEmail, now.Add(-time.Hour), func(r []driver.Value) { r[5] = now }),
			want: ErrEmailTokenInvalid},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := tokenOwnerDB().on("LockUserToken", tt.row)
			err := NewPostgresRepository(db.open(t)).VerifyEmail(context.Background(), tt.presented, now)
			testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockUserTokenOwner,LockUserToken,ROLLBACK")
		})
	}
	// No users row for the token: invalid, and the token is not locked.
	t.Run("no owner row", func(t *testing.T) {
		db := newFakeSQL().on("LockUserToken", userTokenRow(tok, PurposeVerifyEmail, now.Add(time.Hour), nil))
		err := NewPostgresRepository(db.open(t)).VerifyEmail(context.Background(), tok, now)
		testx.AssertTrue(t, errors.Is(err, ErrEmailTokenInvalid), "err = %v", err)
		testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockUserTokenOwner,ROLLBACK")
	})
}

func TestPostgresRepository_VerifyEmailErrors(t *testing.T) {
	_, tok := presentedToken(t, id3)
	live := userTokenRow(tok, PurposeVerifyEmail, testTime.Add(time.Hour), nil)
	for name, tt := range map[string]struct {
		db     *fakeSQL
		prefix string
	}{
		"lock owner": {db: newFakeSQL().on("LockUserTokenOwner", failWith(errBoom)), prefix: "lock token owner: "},
		"lock":       {db: tokenOwnerDB().on("LockUserToken", failWith(errBoom)), prefix: "lock token: "},
		"mark used":  {db: tokenOwnerDB().on("LockUserToken", live).on("MarkUserTokenUsed", failWith(errBoom)), prefix: "mark token used: "},
		"verify":     {db: tokenOwnerDB().on("LockUserToken", live).on("MarkEmailVerified", failWith(errBoom)), prefix: "mark email verified: "},
	} {
		t.Run(name, func(t *testing.T) {
			err := NewPostgresRepository(tt.db.open(t)).VerifyEmail(context.Background(), tok, testTime)
			testx.AssertTrue(t, errors.Is(err, errBoom))
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
		})
	}
}

func TestPostgresRepository_GetUser(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByID", userRow(id1, "budi@example.com", "h", nil, "buyer", nil))
		u, err := NewPostgresRepository(db.open(t)).GetUser(context.Background(), id1)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, u.Email, "budi@example.com")
		testx.AssertFalse(t, u.EmailVerified())
	})
	t.Run("gone", func(t *testing.T) {
		_, err := NewPostgresRepository(newFakeSQL().open(t)).GetUser(context.Background(), id1)
		testx.AssertTrue(t, errors.Is(err, ErrNoUser), "err = %v", err)
	})
	t.Run("query fails", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByID", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).GetUser(context.Background(), id1)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query user: "), "err = %v", err)
	})
}
