package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/mail"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// adminPasswordEnv holds the staff account's password. It is read from
// the environment, not a flag, so it does not end up in the shell history
// or in the process list.
const adminPasswordEnv = "SEED_ADMIN_PASSWORD"

// staffNames is the display name a new staff account gets, per role; also
// the roles -role accepts. A buyer registers through the API.
var staffNames = map[user.Role]string{user.RoleAdmin: "Admin", user.RoleSeller: "Seller"}

// seedAdmin is seedStaff with the admin role.
func seedAdmin(ctx context.Context, db *sql.DB, email, password string) (bool, error) {
	return seedStaff(ctx, db, email, password, user.RoleAdmin)
}

// seedStaff creates the staff account email with role (admin or seller,
// from Bab 12), or gives the account that already has it that role, with
// password and a verified email. Changing an existing account replaces
// its password, so its sessions are revoked too (their access tokens run
// out within APP_ACCESS_TOKEN_TTL); it also demotes an admin given the
// seller role, which is what was asked. It is for a developer's machine
// only (make seed-admin, which refuses a remote database): the API has no
// way to create staff, and production staff are made by hand by someone
// who can already reach the database.
//
// It reports whether the account is new.
func seedStaff(ctx context.Context, db *sql.DB, email, password string, role user.Role) (bool, error) {
	name, ok := staffNames[role]
	if !ok {
		return false, fmt.Errorf("-role %q must be admin or seller", role)
	}
	email = auth.NormalizeEmail(email)
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
		return false, fmt.Errorf("-admin %q is not an email address", email)
	}
	if password == "" {
		return false, errors.New(adminPasswordEnv + " is not set (make seed-admin needs it)")
	}
	if err := auth.CheckPassword(password); err != nil {
		return false, fmt.Errorf("%s: %w", adminPasswordEnv, err)
	}
	hash, err := auth.NewArgon2Hasher(1).Hash(ctx, password)
	if err != nil {
		return false, err
	}

	// Written here rather than taken from the sqlc queries, like the rest
	// of the seed: the API never upserts an account or sets a role.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // a no-op after Commit

	var id string
	var inserted bool
	err = tx.QueryRowContext(ctx, `
		INSERT INTO users (id, email, password_hash, name, role, email_verified_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (email) DO UPDATE
		SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash,
		    email_verified_at = COALESCE(users.email_verified_at, now()), updated_at = now()
		RETURNING id, xmax = 0`,
		uuidx.NewV7(), email, hash, name, string(role)).Scan(&id, &inserted)
	if err != nil {
		return false, fmt.Errorf("upsert %s (did you run make migrate-up?): %w", role, err)
	}
	if !inserted {
		// The password was replaced, so end the account's sessions, as a
		// password reset does, in the same transaction (the users row is
		// locked first, the lock order of ADR 0005). The seed has no Redis,
		// so access tokens already issued keep working until they expire
		// (APP_ACCESS_TOKEN_TTL, 15 minutes by default); a reset also marks
		// the sessions in Redis.
		_, err = tx.ExecContext(ctx, `
			UPDATE refresh_tokens SET revoked_at = now()
			WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, id)
		if err != nil {
			return false, fmt.Errorf("revoke sessions: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit: %w", err)
	}
	return inserted, nil
}
