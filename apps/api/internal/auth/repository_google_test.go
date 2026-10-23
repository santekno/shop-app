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

func TestPostgresRepository_GetUserByIdentity(t *testing.T) {
	t.Run("linked", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByIdentity", userRow(id1, "budi@gmail.com", nil, nil, "buyer", testTime))
		u, err := NewPostgresRepository(db.open(t)).GetUserByIdentity(context.Background(), ProviderGoogle, "sub-1")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, u.ID, id1)
		call, _ := db.call("GetUserByIdentity")
		testx.AssertEqual(t, call.args[0], driver.Value("google"))
		testx.AssertEqual(t, call.args[1], driver.Value("sub-1"))
	})
	t.Run("not linked", func(t *testing.T) {
		_, err := NewPostgresRepository(newFakeSQL().open(t)).GetUserByIdentity(context.Background(), ProviderGoogle, "sub-1")
		testx.AssertTrue(t, errors.Is(err, ErrNoUser), "err = %v", err)
	})
	t.Run("query fails", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByIdentity", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).GetUserByIdentity(context.Background(), ProviderGoogle, "sub-1")
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query identity: "), "err = %v", err)
	})
}

func TestPostgresRepository_CreateUserWithIdentity(t *testing.T) {
	db := newFakeSQL().on("InsertVerifiedUser", userRow(id1, "budi@gmail.com", nil, nil, "buyer", testTime))
	repo := NewPostgresRepository(db.open(t))

	u, err := repo.CreateUserWithIdentity(context.Background(),
		NewUser{ID: id1, Email: "budi@gmail.com", Name: "Budi", Role: user.RoleBuyer}, id2, ProviderGoogle, "sub-1")

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, u.ID, id1)
	testx.AssertTrue(t, u.EmailVerified(), "Google verified the email")
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,InsertVerifiedUser,InsertUserIdentity,COMMIT")
	identity, _ := db.call("InsertUserIdentity")
	testx.AssertEqual(t, len(identity.args), 4)
	testx.AssertEqual(t, identity.args[0], driver.Value(id2))
	testx.AssertEqual(t, identity.args[1], driver.Value(id1))
	testx.AssertEqual(t, identity.args[2], driver.Value("google"))
	testx.AssertEqual(t, identity.args[3], driver.Value("sub-1"))
}

func TestPostgresRepository_CreateUserWithIdentityErrors(t *testing.T) {
	ok := userRow(id1, "budi@gmail.com", nil, nil, "buyer", testTime)
	tests := []struct {
		name      string
		db        *fakeSQL
		want      error
		wrapped   string
		wantCalls string
	}{
		{name: "email taken",
			db:   newFakeSQL().on("InsertVerifiedUser", failWith(&pgconn.PgError{Code: "23505", ConstraintName: "users_email_key"})),
			want: ErrEmailTaken, wantCalls: "BEGIN,InsertVerifiedUser,ROLLBACK"},
		{name: "identity linked meanwhile",
			db: newFakeSQL().on("InsertVerifiedUser", ok).
				on("InsertUserIdentity", failWith(&pgconn.PgError{Code: "23505", ConstraintName: "user_identities_provider_subject_key"})),
			want: ErrIdentityTaken, wantCalls: "BEGIN,InsertVerifiedUser,InsertUserIdentity,ROLLBACK"},
		{name: "user insert fails", db: newFakeSQL().on("InsertVerifiedUser", failWith(errBoom)),
			wrapped: "insert user: ", wantCalls: "BEGIN,InsertVerifiedUser,ROLLBACK"},
		{name: "identity insert fails", db: newFakeSQL().on("InsertVerifiedUser", ok).on("InsertUserIdentity", failWith(errBoom)),
			wrapped: "insert identity: ", wantCalls: "BEGIN,InsertVerifiedUser,InsertUserIdentity,ROLLBACK"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u, err := NewPostgresRepository(tt.db.open(t)).CreateUserWithIdentity(context.Background(),
				NewUser{ID: id1, Email: "budi@gmail.com"}, id2, ProviderGoogle, "sub-1")
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			} else {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.wrapped), "err = %v", err)
			}
			testx.AssertEqual(t, u.ID, "", "nothing is returned from a rolled back transaction")
			testx.AssertEqual(t, strings.Join(tt.db.names(), ","), tt.wantCalls)
		})
	}
}
