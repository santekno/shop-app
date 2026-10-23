package address_test

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/address"
)

// addressRow is an addresses row in sqlc's column order.
func addressRow(id string, isDefault bool) []driver.Value {
	return []driver.Value{id, "Rumah", "Budi", "081234567890", "Jl. Merdeka 1", "Bandung", "Jawa Barat", "40111",
		isDefault, testTime, testTime}
}

func oneAddress(id string, isDefault bool) fakeAnswer {
	return fakeAnswer{rows: [][]driver.Value{addressRow(id, isDefault)}}
}

// locked is the answer of LockUser for an account that exists.
var locked = rows(me)

func input(isDefault bool) address.Input {
	return address.Input{Label: "Rumah", RecipientName: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1",
		City: "Bandung", Province: "Jawa Barat", PostalCode: "40111", IsDefault: isDefault}
}

func TestPostgresRepository_List(t *testing.T) {
	db := newFakeSQL().on("ListAddresses", fakeAnswer{rows: [][]driver.Value{addressRow(addrID, true), addressRow(otherID, false)}})
	list, err := address.NewPostgresRepository(db.open(t)).List(context.Background(), me)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(list), 2)
	testx.AssertEqual(t, list[0], address.Address{ID: addrID, Label: "Rumah", RecipientName: "Budi", Phone: "081234567890",
		Street: "Jl. Merdeka 1", City: "Bandung", Province: "Jawa Barat", PostalCode: "40111", IsDefault: true,
		CreatedAt: testTime, UpdatedAt: testTime})
	testx.AssertFalse(t, list[1].IsDefault)
	call, _ := db.call("ListAddresses")
	testx.AssertEqual(t, call.args[0], driver.Value(me))

	db = newFakeSQL().on("ListAddresses", failWith(errBoom))
	_, err = address.NewPostgresRepository(db.open(t)).List(context.Background(), me)
	testx.AssertTrue(t, errors.Is(err, errBoom))
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query addresses: "), "err = %v", err)
}

// Every query carries the owner next to the id: another user's address
// is simply not found.
func TestPostgresRepository_Get(t *testing.T) {
	db := newFakeSQL().on("GetAddress", oneAddress(addrID, true))
	a, err := address.NewPostgresRepository(db.open(t)).Get(context.Background(), me, addrID)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, a.ID, addrID)
	call, _ := db.call("GetAddress")
	testx.AssertEqual(t, call.args[0], driver.Value(addrID))
	testx.AssertEqual(t, call.args[1], driver.Value(me))

	_, err = address.NewPostgresRepository(newFakeSQL().open(t)).Get(context.Background(), me, otherID)
	testx.AssertTrue(t, errors.Is(err, address.ErrNotFound), "err = %v", err)

	db = newFakeSQL().on("GetAddress", failWith(errBoom))
	_, err = address.NewPostgresRepository(db.open(t)).Get(context.Background(), me, addrID)
	testx.AssertTrue(t, errors.Is(err, errBoom))
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "query address: "), "err = %v", err)
}

func TestPostgresRepository_Create(t *testing.T) {
	tests := []struct {
		name        string
		count       int64
		isDefault   bool
		wantDefault bool
		wantCalls   string
	}{
		{name: "the first address is the default", count: 0, isDefault: false, wantDefault: true,
			wantCalls: "BEGIN,LockUser,CountAddresses,ClearDefaultAddress,InsertAddress,COMMIT"},
		{name: "a new default takes the flag", count: 3, isDefault: true, wantDefault: true,
			wantCalls: "BEGIN,LockUser,CountAddresses,ClearDefaultAddress,InsertAddress,COMMIT"},
		{name: "another address", count: 3, isDefault: false, wantDefault: false,
			wantCalls: "BEGIN,LockUser,CountAddresses,InsertAddress,COMMIT"},
		{name: "the 20th address", count: address.MaxPerUser - 1, isDefault: false, wantDefault: false,
			wantCalls: "BEGIN,LockUser,CountAddresses,InsertAddress,COMMIT"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on("LockUser", locked).on("CountAddresses", rows(tt.count)).
				on("InsertAddress", oneAddress(otherID, tt.wantDefault))
			a, err := address.NewPostgresRepository(db.open(t)).Create(context.Background(), me, otherID, input(tt.isDefault))
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, a.ID, otherID)
			testx.AssertEqual(t, strings.Join(db.names(), ","), tt.wantCalls)
			ins, _ := db.call("InsertAddress")
			testx.AssertEqual(t, len(ins.args), 10)
			testx.AssertEqual(t, ins.args[0], driver.Value(otherID))
			testx.AssertEqual(t, ins.args[1], driver.Value(me))
			testx.AssertEqual(t, ins.args[2], driver.Value("Rumah"))
			testx.AssertEqual(t, ins.args[8], driver.Value("40111"))
			testx.AssertEqual(t, ins.args[9], driver.Value(tt.wantDefault))
		})
	}
}

func TestPostgresRepository_CreateErrors(t *testing.T) {
	tests := []struct {
		name   string
		db     *fakeSQL
		want   error
		prefix string
	}{
		{name: "account gone", db: newFakeSQL(), want: address.ErrNoUser},
		{name: "at the limit", db: newFakeSQL().on("LockUser", locked).on("CountAddresses", rows(int64(address.MaxPerUser))),
			want: address.ErrLimitReached},
		{name: "over the limit", db: newFakeSQL().on("LockUser", locked).on("CountAddresses", rows(int64(address.MaxPerUser+5))),
			want: address.ErrLimitReached},
		{name: "invalid text", db: newFakeSQL().on("LockUser", locked).on("CountAddresses", rows(int64(1))).
			on("InsertAddress", failWith(&pgconn.PgError{Code: "22021"})), want: address.ErrInvalidText},
		{name: "lock", db: newFakeSQL().on("LockUser", failWith(errBoom)), prefix: "lock user: "},
		{name: "count", db: newFakeSQL().on("LockUser", locked).on("CountAddresses", failWith(errBoom)), prefix: "count addresses: "},
		{name: "clear default", db: newFakeSQL().on("LockUser", locked).on("CountAddresses", rows(int64(0))).
			on("ClearDefaultAddress", failWith(errBoom)), prefix: "clear default: "},
		{name: "insert", db: newFakeSQL().on("LockUser", locked).on("CountAddresses", rows(int64(1))).
			on("InsertAddress", failWith(errBoom)), prefix: "insert address: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, err := address.NewPostgresRepository(tt.db.open(t)).Create(context.Background(), me, otherID, input(false))
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			} else {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			}
			testx.AssertEqual(t, a.ID, "")
			testx.AssertFalse(t, errors.Is(tt.want, address.ErrLimitReached) && tt.db.ran("InsertAddress"), "inserted past the limit")
			names := tt.db.names()
			testx.AssertEqual(t, names[len(names)-1], "ROLLBACK")
		})
	}
}

func TestPostgresRepository_Update(t *testing.T) {
	yes, no := true, false
	label := "Kantor"
	tests := []struct {
		name      string
		current   bool // the address is the default now
		patch     address.Patch
		wantCalls string
		wantArg7  driver.Value // is_default argument
	}{
		{name: "fields only", current: false, patch: address.Patch{Label: &label},
			wantCalls: "BEGIN,LockUser,GetAddress,UpdateAddress,COMMIT", wantArg7: nil},
		{name: "becomes the default", current: false, patch: address.Patch{IsDefault: &yes},
			wantCalls: "BEGIN,LockUser,GetAddress,ClearDefaultAddress,UpdateAddress,COMMIT", wantArg7: true},
		{name: "already the default", current: true, patch: address.Patch{IsDefault: &yes},
			wantCalls: "BEGIN,LockUser,GetAddress,UpdateAddress,COMMIT", wantArg7: true},
		{name: "a non-default stays one", current: false, patch: address.Patch{IsDefault: &no},
			wantCalls: "BEGIN,LockUser,GetAddress,UpdateAddress,COMMIT", wantArg7: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on("LockUser", locked).on("GetAddress", oneAddress(addrID, tt.current)).
				on("UpdateAddress", oneAddress(addrID, true))
			a, err := address.NewPostgresRepository(db.open(t)).Update(context.Background(), me, addrID, tt.patch)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, a.ID, addrID)
			testx.AssertEqual(t, strings.Join(db.names(), ","), tt.wantCalls)
			upd, _ := db.call("UpdateAddress")
			testx.AssertEqual(t, len(upd.args), 10)
			if tt.patch.Label != nil {
				testx.AssertEqual(t, upd.args[0], driver.Value("Kantor"))
			} else {
				testx.AssertEqual(t, upd.args[0], driver.Value(nil), "a nil field keeps its value")
			}
			testx.AssertEqual(t, upd.args[7], tt.wantArg7)
			testx.AssertEqual(t, upd.args[8], driver.Value(addrID))
			testx.AssertEqual(t, upd.args[9], driver.Value(me))
		})
	}
}

func TestPostgresRepository_UpdateErrors(t *testing.T) {
	no := false
	tests := []struct {
		name   string
		db     *fakeSQL
		patch  address.Patch
		want   error
		prefix string
	}{
		{name: "account gone", db: newFakeSQL(), want: address.ErrNoUser},
		{name: "not the caller's", db: newFakeSQL().on("LockUser", locked), want: address.ErrNotFound},
		// Unsetting the default would leave the user without one.
		{name: "unset the default", db: newFakeSQL().on("LockUser", locked).on("GetAddress", oneAddress(addrID, true)),
			patch: address.Patch{IsDefault: &no}, want: address.ErrDefaultRequired},
		{name: "invalid text", db: newFakeSQL().on("LockUser", locked).on("GetAddress", oneAddress(addrID, false)).
			on("UpdateAddress", failWith(&pgconn.PgError{Code: "22021"})), want: address.ErrInvalidText},
		{name: "lock", db: newFakeSQL().on("LockUser", failWith(errBoom)), prefix: "lock user: "},
		{name: "get", db: newFakeSQL().on("LockUser", locked).on("GetAddress", failWith(errBoom)), prefix: "query address: "},
		{name: "clear default", db: newFakeSQL().on("LockUser", locked).on("GetAddress", oneAddress(addrID, false)).
			on("ClearDefaultAddress", failWith(errBoom)), patch: address.Patch{IsDefault: ptr(true)}, prefix: "clear default: "},
		{name: "update", db: newFakeSQL().on("LockUser", locked).on("GetAddress", oneAddress(addrID, false)).
			on("UpdateAddress", failWith(errBoom)), prefix: "update address: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := address.NewPostgresRepository(tt.db.open(t)).Update(context.Background(), me, addrID, tt.patch)
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			} else {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			}
			names := tt.db.names()
			testx.AssertEqual(t, names[len(names)-1], "ROLLBACK")
		})
	}
}

func TestPostgresRepository_Delete(t *testing.T) {
	t.Run("the default: the newest remaining one takes over", func(t *testing.T) {
		db := newFakeSQL().on("LockUser", locked).on("DeleteAddress", rows(true))
		testx.AssertNoError(t, address.NewPostgresRepository(db.open(t)).Delete(context.Background(), me, addrID))
		testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockUser,DeleteAddress,PromoteNewestAddress,COMMIT")
		del, _ := db.call("DeleteAddress")
		testx.AssertEqual(t, del.args[0], driver.Value(addrID))
		testx.AssertEqual(t, del.args[1], driver.Value(me))
	})
	t.Run("not the default", func(t *testing.T) {
		db := newFakeSQL().on("LockUser", locked).on("DeleteAddress", rows(false))
		testx.AssertNoError(t, address.NewPostgresRepository(db.open(t)).Delete(context.Background(), me, addrID))
		testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockUser,DeleteAddress,COMMIT")
	})
	tests := []struct {
		name   string
		db     *fakeSQL
		want   error
		prefix string
	}{
		{name: "account gone", db: newFakeSQL(), want: address.ErrNoUser},
		{name: "not the caller's", db: newFakeSQL().on("LockUser", locked), want: address.ErrNotFound},
		{name: "delete", db: newFakeSQL().on("LockUser", locked).on("DeleteAddress", failWith(errBoom)), prefix: "delete address: "},
		{name: "promote", db: newFakeSQL().on("LockUser", locked).on("DeleteAddress", rows(true)).
			on("PromoteNewestAddress", failWith(errBoom)), prefix: "promote default: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := address.NewPostgresRepository(tt.db.open(t)).Delete(context.Background(), me, addrID)
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v, want %v", err, tt.want)
			} else {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			}
		})
	}
}

func ptr[T any](v T) *T { return &v }
