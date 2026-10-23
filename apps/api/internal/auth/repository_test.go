package auth

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestPostgresRepository_CreateUser(t *testing.T) {
	db := newFakeSQL().on("InsertUser", userRow(id1, "budi@example.com", "hash", "081234567890", "buyer", nil))
	repo := NewPostgresRepository(db.open(t))

	u, err := repo.CreateUser(context.Background(), NewUser{
		ID: id1, Email: "budi@example.com", PasswordHash: "hash", Name: "Budi", Role: user.RoleBuyer,
	})

	testx.AssertNoError(t, err)
	call, _ := db.call("InsertUser")
	testx.AssertEqual(t, len(call.args), 5)
	testx.AssertEqual(t, call.args[0], driver.Value(id1))
	testx.AssertEqual(t, call.args[1], driver.Value("budi@example.com"))
	testx.AssertEqual(t, call.args[2], driver.Value("hash"))
	testx.AssertEqual(t, call.args[3], driver.Value("Budi"))
	testx.AssertEqual(t, call.args[4], driver.Value("buyer"))
	testx.AssertEqual(t, u.ID, id1)
	testx.AssertTrue(t, u.Phone != nil && *u.Phone == "081234567890", "phone %v", u.Phone)
	testx.AssertEqual(t, u.Role, user.RoleBuyer)
	testx.AssertTrue(t, u.CreatedAt.Equal(testTime))
}

// An account without a password stores NULL, not "".
func TestPostgresRepository_CreateUserWithoutPassword(t *testing.T) {
	db := newFakeSQL().on("InsertUser", userRow(id1, "a@b.co", nil, nil, "buyer", nil))
	_, err := NewPostgresRepository(db.open(t)).CreateUser(context.Background(), NewUser{ID: id1, Email: "a@b.co"})
	testx.AssertNoError(t, err)
	call, _ := db.call("InsertUser")
	testx.AssertEqual(t, call.args[2], driver.Value(nil))
}

func TestPostgresRepository_CreateUserErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want error
	}{
		{name: "email taken", err: &pgconn.PgError{Code: "23505", ConstraintName: "users_email_key"}, want: ErrEmailTaken},
		{name: "invalid text", err: &pgconn.PgError{Code: "22021"}, want: ErrInvalidText},
		{name: "another unique constraint", err: &pgconn.PgError{Code: "23505", ConstraintName: "users_pkey"}},
		{name: "not a postgres error", err: errBoom},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on("InsertUser", failWith(tt.err))
			_, err := NewPostgresRepository(db.open(t)).CreateUser(context.Background(), NewUser{ID: id1})
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
				return
			}
			testx.AssertTrue(t, errors.Is(err, tt.err), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "insert user: "), "err = %v", err)
		})
	}
}

func TestPostgresRepository_GetCredentials(t *testing.T) {
	t.Run("with a password", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByEmail", userRow(id1, "budi@example.com", "$argon2id$x", nil, "admin", testTime))
		creds, err := NewPostgresRepository(db.open(t)).GetCredentials(context.Background(), "budi@example.com")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, creds.Hash, "$argon2id$x")
		testx.AssertEqual(t, creds.User.Role, user.RoleAdmin)
		testx.AssertTrue(t, creds.User.EmailVerified())
		call, _ := db.call("GetUserByEmail")
		testx.AssertEqual(t, call.args[0], driver.Value("budi@example.com"))
	})
	t.Run("without a password", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByEmail", userRow(id1, "budi@example.com", nil, nil, "buyer", nil))
		creds, err := NewPostgresRepository(db.open(t)).GetCredentials(context.Background(), "budi@example.com")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, creds.Hash, "", "Login then verifies against the dummy")
	})
	t.Run("unknown", func(t *testing.T) {
		_, err := NewPostgresRepository(newFakeSQL().open(t)).GetCredentials(context.Background(), "x@y.z")
		testx.AssertTrue(t, errors.Is(err, ErrNoUser), "err = %v", err)
	})
	t.Run("query fails", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByEmail", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).GetCredentials(context.Background(), "x@y.z")
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query user: "), "err = %v", err)
	})
}

func TestNullString(t *testing.T) {
	testx.AssertFalse(t, nullString("").Valid)
	ns := nullString("x")
	testx.AssertTrue(t, ns.Valid && ns.String == "x")
}
