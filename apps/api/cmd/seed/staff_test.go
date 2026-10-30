package main

// Bab 12: make seed-admin role=seller. The role is checked before
// anything else, and the upsert sends the role and its display name.

import (
	"context"
	"database/sql/driver"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestStaffNames(t *testing.T) {
	testx.AssertEqual(t, len(staffNames), 2, "admin and seller only")
	testx.AssertEqual(t, staffNames[user.RoleAdmin], "Admin")
	testx.AssertEqual(t, staffNames[user.RoleSeller], "Seller")
	_, buyer := staffNames[user.RoleBuyer]
	testx.AssertFalse(t, buyer, "a buyer registers through the API")
}

// An unknown role is refused first, before the email, the password or the
// database (db is nil).
func TestSeedStaff_RefusesOtherRoles(t *testing.T) {
	for _, role := range []user.Role{user.RoleBuyer, "", "Admin", "superuser"} {
		t.Run(string(role), func(t *testing.T) {
			created, err := seedStaff(context.Background(), nil, "not an email", "", role)
			testx.AssertFalse(t, created)
			testx.AssertError(t, err)
			testx.AssertEqual(t, err.Error(), `-role "`+string(role)+`" must be admin or seller`)
		})
	}
}

// The upsert carries the role and its display name. The fake database
// answers RETURNING with one column instead of two, so the scan fails
// right after the statement is recorded, and the error names the role.
func TestSeedStaff_UpsertsTheRole(t *testing.T) {
	tests := []struct {
		name  string
		seed  func(*seedDB) error
		role  string
		disp  string
		email string
	}{
		{name: "seller", role: "seller", disp: "Seller", email: "seller@goshop.local", seed: func(db *seedDB) error {
			_, err := seedStaff(context.Background(), db.open(t), "Seller@GoShop.local", "kopi susu gula aren", user.RoleSeller)
			return err
		}},
		{name: "admin through seedAdmin", role: "admin", disp: "Admin", email: "admin@goshop.local", seed: func(db *seedDB) error {
			_, err := seedAdmin(context.Background(), db.open(t), "admin@goshop.local", "kopi susu gula aren")
			return err
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := &seedDB{returning: []driver.Value{"0190c8a0-0000-7000-8000-000000000001"}}
			err := tt.seed(db)
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), "upsert "+tt.role+" (did you run make migrate-up?): ")

			var upsert *seedStmt
			for i := range db.stmts {
				if strings.Contains(db.stmts[i].sql, "INSERT INTO users") {
					upsert = &db.stmts[i]
				}
			}
			if upsert == nil {
				t.Fatalf("no upsert in %v", db.kinds())
			}
			testx.AssertContains(t, upsert.sql, "SET role = EXCLUDED.role", "an existing account gets the role asked for")
			testx.AssertEqual(t, len(upsert.args), 5)
			testx.AssertEqual(t, upsert.args[1], driver.Value(tt.email), "normalised email")
			testx.AssertEqual(t, upsert.args[3], driver.Value(tt.disp))
			testx.AssertEqual(t, upsert.args[4], driver.Value(tt.role))
			testx.AssertFalse(t, strings.Contains(upsert.args[2].(string), "kopi"), "the password is hashed")
		})
	}
}

// runStaff refuses an unknown role before it looks at DATABASE_URL.
func TestRunStaff_Guards(t *testing.T) {
	err := runStaff(context.Background(), "", "seller@goshop.local", "kopi susu gula aren", "buyer")
	testx.AssertError(t, err)
	testx.AssertEqual(t, err.Error(), `-role "buyer" must be admin or seller`)

	err = runStaff(context.Background(), "", "seller@goshop.local", "kopi susu gula aren", user.RoleSeller)
	testx.AssertError(t, err)
	testx.AssertEqual(t, err.Error(), "DATABASE_URL is not set (make seed-admin sets it to the Compose postgres)")
}
