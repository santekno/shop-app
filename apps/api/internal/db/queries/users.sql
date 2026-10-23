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
-- Serialises writes to one user's child rows (email tokens; from artikel 11
-- the address book), and fails for a deleted account.
SELECT id FROM users
WHERE id = @id AND anonymized_at IS NULL
FOR UPDATE;
