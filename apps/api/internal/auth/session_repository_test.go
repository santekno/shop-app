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

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// lockedRefreshRow is a LockRefreshToken row for tok, live until expires;
// change edits the row's values (by column index) before it is returned.
func lockedRefreshRow(tok opaqueToken, expires time.Time, change func(row []driver.Value)) fakeAnswer {
	row := []driver.Value{
		tok.ID, id2, tok.Hash, expires, nil, nil, // id, family_id, token_hash, expires_at, used_at, revoked_at
		id1, "budi@example.com", "Budi", nil, "seller", nil, testTime, testTime, nil, // user ..., anonymized_at
	}
	if change != nil {
		change(row)
	}
	return fakeAnswer{rows: [][]driver.Value{row}}
}

// rotationDB is a database where the presented token's owner exists, so
// LockRefreshTokenOwner (FOR SHARE) finds the users row.
func rotationDB() *fakeSQL { return newFakeSQL().on("LockRefreshTokenOwner", rows(id1, nil)) }

// logoutDB is the same for logout's owner lock (FOR NO KEY UPDATE).
func logoutDB() *fakeSQL { return newFakeSQL().on("LockRefreshTokenOwnerForLogout", rows(id1)) }

// assertLockedFirst checks that lock is the first statement after BEGIN
// and that it and every later statement ran in that same transaction.
func assertLockedFirst(t *testing.T, db *fakeSQL, lock string) {
	t.Helper()
	db.mu.Lock()
	calls := append([]fakeCall(nil), db.calls...)
	db.mu.Unlock()
	if len(calls) < 2 || calls[0].name != "BEGIN" || calls[1].name != lock {
		t.Fatalf("want BEGIN then %s first, got %v", lock, db.names())
	}
	tx := calls[0].tx
	testx.AssertTrue(t, tx > 0, "BEGIN opened no transaction")
	for _, c := range calls {
		testx.AssertEqual(t, c.tx, tx, "%s ran outside the transaction of %s", c.name, lock)
	}
}

const (
	colUsedAt       = 4
	colRevokedAt    = 5
	colAnonymizedAt = 14
)

// sessionOwnerDB is a database where LockSessionOwner finds the user with
// password hash (nil: NULL, an account without a password) and
// anonymised (nil: not deleted).
func sessionOwnerDB(hash, anonymised driver.Value) *fakeSQL {
	return newFakeSQL().on("LockSessionOwner", rows(hash, anonymised))
}

func TestPostgresRepository_CreateRefreshToken(t *testing.T) {
	_, tok := presentedToken(t, id3)
	expires := testTime.Add(time.Hour)
	tests := []struct {
		name     string
		hash     driver.Value
		verified string
	}{
		{name: "password login, hash unchanged", hash: "$argon2id$current", verified: "$argon2id$current"},
		// Google: no password was checked, so the stored hash is not compared.
		{name: "no verified hash, account with a password", hash: "$argon2id$current", verified: ""},
		{name: "no verified hash, account without a password", hash: nil, verified: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := sessionOwnerDB(tt.hash, nil)
			err := NewPostgresRepository(db.open(t)).CreateRefreshToken(context.Background(),
				NewRefreshToken{Token: tok, UserID: id1, FamilyID: id2, ExpiresAt: expires, VerifiedHash: tt.verified})

			testx.AssertNoError(t, err)
			// The user is locked first (FOR SHARE), then the token is stored,
			// in one transaction.
			testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockSessionOwner,InsertRefreshToken,COMMIT")
			assertLockedFirst(t, db, "LockSessionOwner")
			lock, _ := db.call("LockSessionOwner")
			testx.AssertEqual(t, lock.args[0], driver.Value(id1))
			call, ok := db.call("InsertRefreshToken")
			testx.AssertTrue(t, ok)
			testx.AssertEqual(t, len(call.args), 5)
			testx.AssertEqual(t, call.args[0], driver.Value(id3))
			testx.AssertEqual(t, call.args[1], driver.Value(id1))
			testx.AssertEqual(t, call.args[2], driver.Value(id2))
			testx.AssertTrue(t, bytes.Equal(call.args[3].([]byte), tok.Hash), "only the hash is stored")
			testx.AssertTrue(t, call.args[4].(time.Time).Equal(expires))
		})
	}
}

// A login verifies the password before the session is stored; a reset or
// a deletion that committed in between makes the session refused.
func TestPostgresRepository_CreateRefreshTokenRefusals(t *testing.T) {
	_, tok := presentedToken(t, id3)
	tests := []struct {
		name     string
		db       *fakeSQL
		verified string
		want     error
		prefix   string
	}{
		{name: "account gone", db: newFakeSQL(), verified: "$argon2id$current", want: ErrNoUser},
		{name: "account deleted", db: sessionOwnerDB(nil, testTime), verified: "", want: ErrNoUser},
		{name: "account deleted, password login", db: sessionOwnerDB("$argon2id$current", testTime), verified: "$argon2id$current", want: ErrNoUser},
		{name: "password reset meanwhile", db: sessionOwnerDB("$argon2id$new", nil), verified: "$argon2id$old", want: ErrInvalidCredentials},
		{name: "password removed meanwhile", db: sessionOwnerDB(nil, nil), verified: "$argon2id$old", want: ErrInvalidCredentials},
		{name: "owner lock fails", db: newFakeSQL().on("LockSessionOwner", failWith(errBoom)), prefix: "lock session owner: "},
		{name: "insert fails", db: sessionOwnerDB("$argon2id$current", nil).on("InsertRefreshToken", failWith(errBoom)),
			verified: "$argon2id$current", prefix: "insert refresh token: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := NewPostgresRepository(tt.db.open(t)).CreateRefreshToken(context.Background(),
				NewRefreshToken{Token: tok, UserID: id1, FamilyID: id2, ExpiresAt: testTime, VerifiedHash: tt.verified})
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
				testx.AssertEqual(t, strings.Join(tt.db.names(), ","), "BEGIN,LockSessionOwner,ROLLBACK")
				return
			}
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			names := tt.db.names()
			testx.AssertEqual(t, names[len(names)-1], "ROLLBACK", "a failed insert rolls back")
			assertLockedFirst(t, tt.db, "LockSessionOwner")
		})
	}
}

func TestPostgresRepository_RotateRefreshToken(t *testing.T) {
	_, presented := presentedToken(t, id1)
	_, next := newOpaqueTokenWithID(t, id5)
	now := testTime
	nextExpires := now.Add(30 * 24 * time.Hour)
	db := rotationDB().on("LockRefreshToken", lockedRefreshRow(presented, now.Add(time.Hour), nil))
	repo := NewPostgresRepository(db.open(t))

	got, err := repo.RotateRefreshToken(context.Background(), presented, next, now, nextExpires)

	testx.AssertNoError(t, err)
	// The users row first (FOR SHARE), then the token, in one transaction.
	testx.AssertEqual(t, strings.Join(db.names(), ","),
		"BEGIN,LockRefreshTokenOwner,LockRefreshToken,MarkRefreshTokenUsed,InsertRefreshToken,COMMIT")
	assertLockedFirst(t, db, "LockRefreshTokenOwner")
	owner, _ := db.call("LockRefreshTokenOwner")
	testx.AssertEqual(t, owner.args[0], driver.Value(id1), "the owner of the presented token")
	mark, _ := db.call("MarkRefreshTokenUsed")
	testx.AssertEqual(t, mark.args[0], driver.Value(id1))
	insert, _ := db.call("InsertRefreshToken")
	testx.AssertEqual(t, insert.args[0], driver.Value(id5), "the next token's id")
	testx.AssertEqual(t, insert.args[1], driver.Value(id1), "the same user")
	testx.AssertEqual(t, insert.args[2], driver.Value(id2), "the same family")
	testx.AssertTrue(t, bytes.Equal(insert.args[3].([]byte), next.Hash))
	testx.AssertTrue(t, insert.args[4].(time.Time).Equal(nextExpires))

	testx.AssertEqual(t, got.FamilyID, id2)
	testx.AssertEqual(t, got.User.ID, id1)
	testx.AssertEqual(t, got.User.Email, "budi@example.com")
	testx.AssertEqual(t, got.User.Role, user.RoleSeller, "the role as stored now")
	testx.AssertTrue(t, got.User.Phone == nil)
	testx.AssertFalse(t, got.User.EmailVerified())
}

func TestPostgresRepository_RotateRefreshTokenRefusals(t *testing.T) {
	_, presented := presentedToken(t, id1)
	_, wrongSecret := newOpaqueTokenWithID(t, id1) // same id, another secret
	_, next := newOpaqueTokenWithID(t, id5)
	now := testTime

	tests := []struct {
		name      string
		presented opaqueToken
		row       fakeAnswer
		want      error
		wantCalls string
	}{
		{name: "unknown id", presented: presented, row: fakeAnswer{}, want: ErrRefreshTokenInvalid,
			wantCalls: "BEGIN,LockRefreshTokenOwner,LockRefreshToken,ROLLBACK"},
		// Guessing an id with a wrong secret must not end someone's session.
		{name: "wrong secret revokes nothing", presented: wrongSecret,
			row:  lockedRefreshRow(presented, now.Add(time.Hour), func(r []driver.Value) { r[colUsedAt] = now }),
			want: ErrRefreshTokenInvalid, wantCalls: "BEGIN,LockRefreshTokenOwner,LockRefreshToken,ROLLBACK"},
		{name: "revoked", presented: presented,
			row:  lockedRefreshRow(presented, now.Add(time.Hour), func(r []driver.Value) { r[colRevokedAt] = now }),
			want: ErrRefreshTokenInvalid, wantCalls: "BEGIN,LockRefreshTokenOwner,LockRefreshToken,ROLLBACK"},
		{name: "account deleted", presented: presented,
			row:  lockedRefreshRow(presented, now.Add(time.Hour), func(r []driver.Value) { r[colAnonymizedAt] = now }),
			want: ErrRefreshTokenInvalid, wantCalls: "BEGIN,LockRefreshTokenOwner,LockRefreshToken,ROLLBACK"},
		{name: "expires exactly now", presented: presented, row: lockedRefreshRow(presented, now, nil),
			want: ErrRefreshTokenExpired, wantCalls: "BEGIN,LockRefreshTokenOwner,LockRefreshToken,ROLLBACK"},
		{name: "expired", presented: presented, row: lockedRefreshRow(presented, now.Add(-time.Second), nil),
			want: ErrRefreshTokenExpired, wantCalls: "BEGIN,LockRefreshTokenOwner,LockRefreshToken,ROLLBACK"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := rotationDB().on("LockRefreshToken", tt.row)
			repo := NewPostgresRepository(db.open(t))
			got, err := repo.RotateRefreshToken(context.Background(), tt.presented, next, now, now.Add(time.Hour))
			testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			testx.AssertEqual(t, got, Rotated{})
			testx.AssertEqual(t, strings.Join(db.names(), ","), tt.wantCalls)
			testx.AssertFalse(t, db.ran("RevokeRefreshFamily"))
			assertLockedFirst(t, db, "LockRefreshTokenOwner")
		})
	}
}

// No users row for the token (unknown id, or the token row was deleted
// with its user): invalid, and the token row is not even locked.
func TestPostgresRepository_RotateRefreshTokenNoOwner(t *testing.T) {
	_, presented := presentedToken(t, id1)
	_, next := newOpaqueTokenWithID(t, id5)
	db := newFakeSQL().on("LockRefreshToken", lockedRefreshRow(presented, testTime.Add(time.Hour), nil))

	got, err := NewPostgresRepository(db.open(t)).RotateRefreshToken(context.Background(), presented, next, testTime, testTime.Add(time.Hour))

	testx.AssertTrue(t, errors.Is(err, ErrRefreshTokenInvalid), "err = %v", err)
	testx.AssertEqual(t, got, Rotated{})
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockRefreshTokenOwner,ROLLBACK")
}

// A used token presented again: the whole family is revoked and that is
// committed, then ErrRefreshTokenReused comes back with the family.
func TestPostgresRepository_RotateRefreshTokenReuse(t *testing.T) {
	_, presented := presentedToken(t, id1)
	_, next := newOpaqueTokenWithID(t, id5)
	now := testTime
	// Reuse wins over expiry: an old stolen token still revokes its session.
	db := rotationDB().on("LockRefreshToken",
		lockedRefreshRow(presented, now.Add(-time.Hour), func(r []driver.Value) { r[colUsedAt] = now.Add(-2 * time.Hour) }))
	repo := NewPostgresRepository(db.open(t))

	got, err := repo.RotateRefreshToken(context.Background(), presented, next, now, now.Add(time.Hour))

	testx.AssertTrue(t, errors.Is(err, ErrRefreshTokenReused), "err = %v", err)
	testx.AssertEqual(t, got.FamilyID, id2)
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockRefreshTokenOwner,LockRefreshToken,RevokeRefreshFamily,COMMIT")
	assertLockedFirst(t, db, "LockRefreshTokenOwner")
	revoke, _ := db.call("RevokeRefreshFamily")
	testx.AssertEqual(t, revoke.args[0], driver.Value(id2))
	testx.AssertFalse(t, db.ran("InsertRefreshToken"), "no new token for a reused one")
}

func TestPostgresRepository_RotateRefreshTokenDatabaseErrors(t *testing.T) {
	_, presented := presentedToken(t, id1)
	_, next := newOpaqueTokenWithID(t, id5)
	now := testTime
	live := lockedRefreshRow(presented, now.Add(time.Hour), nil)
	used := lockedRefreshRow(presented, now.Add(time.Hour), func(r []driver.Value) { r[colUsedAt] = now })
	tests := []struct {
		name   string
		db     *fakeSQL
		prefix string
	}{
		{name: "lock owner", db: newFakeSQL().on("LockRefreshTokenOwner", failWith(errBoom)), prefix: "lock token owner: "},
		{name: "lock", db: rotationDB().on("LockRefreshToken", failWith(errBoom)), prefix: "lock refresh token: "},
		{name: "mark used", db: rotationDB().on("LockRefreshToken", live).on("MarkRefreshTokenUsed", failWith(errBoom)),
			prefix: "mark refresh token used: "},
		{name: "insert next", db: rotationDB().on("LockRefreshToken", live).on("InsertRefreshToken", failWith(errBoom)),
			prefix: "insert refresh token: "},
		{name: "revoke on reuse", db: rotationDB().on("LockRefreshToken", used).on("RevokeRefreshFamily", failWith(errBoom)),
			prefix: "revoke session: "},
		{name: "commit", db: rotationDB().on("LockRefreshToken", live).on("COMMIT", failWith(errBoom)), prefix: "commit: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := NewPostgresRepository(tt.db.open(t))
			got, err := repo.RotateRefreshToken(context.Background(), presented, next, now, now.Add(time.Hour))
			testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			testx.AssertFalse(t, errors.Is(err, ErrRefreshTokenReused))
			testx.AssertEqual(t, got, Rotated{})
		})
	}
}

func TestPostgresRepository_RevokeSessionOf(t *testing.T) {
	_, presented := presentedToken(t, id1)
	_, wrongSecret := newOpaqueTokenWithID(t, id1)
	row := rows(id1, id2, presented.Hash) // id, family_id, token_hash

	t.Run("revokes the family", func(t *testing.T) {
		db := logoutDB().on("GetRefreshToken", row)
		sid, err := NewPostgresRepository(db.open(t)).RevokeSessionOf(context.Background(), presented)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, sid, id2)
		// The users row first (FOR NO KEY UPDATE, so a rotation in flight
		// finishes first), then the token, in one transaction.
		testx.AssertEqual(t, strings.Join(db.names(), ","),
			"BEGIN,LockRefreshTokenOwnerForLogout,GetRefreshToken,RevokeRefreshFamily,COMMIT")
		assertLockedFirst(t, db, "LockRefreshTokenOwnerForLogout")
		owner, _ := db.call("LockRefreshTokenOwnerForLogout")
		testx.AssertEqual(t, owner.args[0], driver.Value(id1))
		revoke, ok := db.call("RevokeRefreshFamily")
		testx.AssertTrue(t, ok)
		testx.AssertEqual(t, revoke.args[0], driver.Value(id2))
	})
	t.Run("no owner row: already logged out", func(t *testing.T) {
		db := newFakeSQL().on("GetRefreshToken", row)
		sid, err := NewPostgresRepository(db.open(t)).RevokeSessionOf(context.Background(), presented)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, sid, "")
		testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockRefreshTokenOwnerForLogout,COMMIT")
	})
	t.Run("owner lock fails", func(t *testing.T) {
		db := newFakeSQL().on("LockRefreshTokenOwnerForLogout", failWith(errBoom))
		sid, err := NewPostgresRepository(db.open(t)).RevokeSessionOf(context.Background(), presented)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "lock token owner: "), "err = %v", err)
		testx.AssertEqual(t, sid, "")
		testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockRefreshTokenOwnerForLogout,ROLLBACK")
	})
	t.Run("unknown token", func(t *testing.T) {
		db := logoutDB()
		sid, err := NewPostgresRepository(db.open(t)).RevokeSessionOf(context.Background(), presented)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, sid, "")
		testx.AssertFalse(t, db.ran("RevokeRefreshFamily"))
	})
	t.Run("wrong secret revokes nothing", func(t *testing.T) {
		db := logoutDB().on("GetRefreshToken", row)
		sid, err := NewPostgresRepository(db.open(t)).RevokeSessionOf(context.Background(), wrongSecret)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, sid, "")
		testx.AssertFalse(t, db.ran("RevokeRefreshFamily"))
	})
	t.Run("query fails", func(t *testing.T) {
		db := logoutDB().on("GetRefreshToken", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).RevokeSessionOf(context.Background(), presented)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query refresh token: "), "err = %v", err)
	})
	t.Run("revoke fails", func(t *testing.T) {
		db := logoutDB().on("GetRefreshToken", row).on("RevokeRefreshFamily", failWith(errBoom))
		sid, err := NewPostgresRepository(db.open(t)).RevokeSessionOf(context.Background(), presented)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "revoke session: "), "err = %v", err)
		testx.AssertEqual(t, sid, "")
		names := db.names()
		testx.AssertEqual(t, names[len(names)-1], "ROLLBACK")
	})
}

// newOpaqueTokenWithID makes a token with id and a secret of 0xff bytes,
// unlike presentedToken's zeros.
func newOpaqueTokenWithID(t *testing.T, id string) (string, opaqueToken) {
	t.Helper()
	raw, tok, err := newOpaqueToken(bytes.NewReader(bytes.Repeat([]byte{0xff}, 32)), func() string { return id })
	testx.AssertNoError(t, err)
	return raw, tok
}
