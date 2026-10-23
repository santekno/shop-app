-- Accounts. Every lookup skips anonymised rows (anonymized_at IS NOT
-- NULL): a deleted account cannot log in, be found by email or show a
-- profile. The email is always passed lower-cased; users_email_key serves
-- the lookup by email.

-- name: InsertUser :one
-- Registration. A taken email fails on users_email_key, which the
-- repository maps to ErrEmailTaken. It returns the same columns as the
-- reads below, so the repository maps all of them with one function.
INSERT INTO users (id, email, password_hash, name, role)
VALUES (@id, @email, @password_hash, @name, @role)
RETURNING id, email, password_hash, name, phone, role, email_verified_at, created_at, updated_at;

-- name: GetUserByID :one
SELECT id, email, password_hash, name, phone, role, email_verified_at, created_at, updated_at
FROM users
WHERE id = @id AND anonymized_at IS NULL;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, name, phone, role, email_verified_at, created_at, updated_at
FROM users
WHERE email = @email AND anonymized_at IS NULL;

-- name: MarkEmailVerified :exec
-- Keeps the first verification time when the address is confirmed again.
UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
WHERE id = @id AND anonymized_at IS NULL;

-- name: LockUser :one
-- Serialises writes to one user's child rows (email tokens, the address
-- book with its limit and single default), and fails for a deleted account.
SELECT id FROM users
WHERE id = @id AND anonymized_at IS NULL
FOR UPDATE;

-- name: SetUserPassword :exec
UPDATE users SET password_hash = @password_hash, updated_at = now()
WHERE id = @id AND anonymized_at IS NULL;

-- name: InsertVerifiedUser :one
-- An account created by a provider that has verified the email already
-- (Google): no password, email_verified_at set.
INSERT INTO users (id, email, name, role, email_verified_at)
VALUES (@id, @email, @name, @role, now())
RETURNING id, email, password_hash, name, phone, role, email_verified_at, created_at, updated_at;

-- name: UpdateUserProfile :one
-- A NULL name keeps it; set_phone decides whether phone is written (NULL
-- then clears it).
UPDATE users
SET name       = COALESCE(sqlc.narg('name'), name),
    phone      = CASE WHEN @set_phone::boolean THEN sqlc.narg('phone') ELSE phone END,
    updated_at = now()
WHERE id = @id AND anonymized_at IS NULL
RETURNING id, email, password_hash, name, phone, role, email_verified_at, created_at, updated_at;

-- name: AnonymizeUser :execrows
-- Account deletion (docs/erd.md): the row stays for the orders that point
-- to it, but nothing identifies the person. The email becomes the unique
-- placeholder deleted+<id>@invalid (.invalid never receives mail).
UPDATE users
SET email = 'deleted+' || id::text || '@invalid',
    name = '', phone = NULL, password_hash = NULL,
    anonymized_at = now(), updated_at = now()
WHERE id = @id AND anonymized_at IS NULL;
