package user_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

func TestRole_Valid(t *testing.T) {
	for _, r := range []user.Role{user.RoleBuyer, user.RoleSeller, user.RoleAdmin} {
		testx.AssertTrue(t, r.Valid(), "%s", r)
	}
	for _, r := range []user.Role{"", "Admin", "root", "buyer "} {
		testx.AssertFalse(t, r.Valid(), "%q", r)
	}
	testx.AssertEqual(t, string(user.RoleBuyer), "buyer")
	testx.AssertEqual(t, string(user.RoleSeller), "seller")
	testx.AssertEqual(t, string(user.RoleAdmin), "admin")
}

func TestToJSON(t *testing.T) {
	wib := time.FixedZone("WIB", 7*3600)
	created := time.Date(2026, 10, 23, 9, 0, 0, 0, wib)

	t.Run("no phone, unverified", func(t *testing.T) {
		u := user.User{ID: uid, Email: "budi@example.com", Name: "Budi", Role: user.RoleBuyer, CreatedAt: created}
		testx.AssertFalse(t, u.EmailVerified())
		b, err := json.Marshal(user.ToJSON(u))
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, string(b),
			`{"id":"`+uid+`","email":"budi@example.com","name":"Budi","phone":null,"role":"buyer","email_verified":false,"created_at":"2026-10-23T02:00:00Z"}`)
	})
	t.Run("phone, verified", func(t *testing.T) {
		phone := "081234567890"
		at := created
		u := user.User{ID: uid, Phone: &phone, Role: user.RoleAdmin, EmailVerifiedAt: &at}
		testx.AssertTrue(t, u.EmailVerified())
		j := user.ToJSON(u)
		testx.AssertTrue(t, j.Phone != nil && *j.Phone == phone)
		testx.AssertTrue(t, j.EmailVerified)
		testx.AssertEqual(t, j.Role, user.RoleAdmin)
	})
}
