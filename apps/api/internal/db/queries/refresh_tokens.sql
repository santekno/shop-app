-- Refresh tokens (ADR 0005). The row is always found by its id, the first
-- half of the token; the service compares the stored hash with the hash of
-- the presented secret in constant time.

-- name: LockSessionOwner :one
-- Taken before inserting a new session's first token: a password reset or
-- an account deletion that committed after the login read the hash is
-- seen here, and one in flight makes the login wait (users ->
-- refresh_tokens).
SELECT password_hash, anonymized_at FROM users WHERE id = @id FOR SHARE;

-- name: InsertRefreshToken :exec
INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
VALUES (@id, @user_id, @family_id, @token_hash, @expires_at);

-- name: LockRefreshTokenOwner :one
-- Taken before LockRefreshToken. Every transaction that writes a user's
-- refresh tokens locks the users row first (reset and deletion UPDATE it,
-- rotation shares it), so a rotation cannot slip a new token past
-- RevokeUserSessions, and the order users -> refresh_tokens cannot
-- deadlock.
SELECT u.id, u.anonymized_at FROM users u
WHERE u.id = (SELECT rt.user_id FROM refresh_tokens rt WHERE rt.id = @id)
FOR SHARE;

-- name: LockRefreshTokenOwnerForLogout :one
-- Logout's owner lock. FOR NO KEY UPDATE conflicts with a rotation's FOR
-- SHARE, so a logout waits for a refresh in flight (and then revokes the
-- token that refresh just issued too), or makes the refresh wait and fail.
SELECT u.id FROM users u
WHERE u.id = (SELECT rt.user_id FROM refresh_tokens rt WHERE rt.id = @id)
FOR NO KEY UPDATE;

-- name: LockRefreshToken :one
-- The token and its user, locked for the rotation: a second refresh with
-- the same token waits here, then sees used_at and is treated as reuse.
SELECT rt.id, rt.family_id, rt.token_hash, rt.expires_at, rt.used_at, rt.revoked_at,
       u.id AS user_id, u.email, u.name, u.phone, u.role, u.email_verified_at,
       u.created_at, u.updated_at, u.anonymized_at
FROM refresh_tokens rt
JOIN users u ON u.id = rt.user_id
WHERE rt.id = @id
FOR UPDATE OF rt;

-- name: GetRefreshToken :one
-- Logout's lookup, after LockRefreshTokenOwnerForLogout.
SELECT id, family_id, token_hash
FROM refresh_tokens
WHERE id = @id;

-- name: MarkRefreshTokenUsed :exec
UPDATE refresh_tokens SET used_at = now()
WHERE id = @id;

-- name: RevokeRefreshFamily :exec
-- Ends a session. Served by refresh_tokens_family_idx.
UPDATE refresh_tokens SET revoked_at = now()
WHERE family_id = @family_id AND revoked_at IS NULL;

-- name: RevokeUserSessions :many
-- Ends every session of a user (password reset, account deletion) and
-- returns their ids. Each live session has exactly one token that is
-- neither used nor revoked, so this touches one row per session, through
-- refresh_tokens_user_active_idx; the used ones already fail on their own.
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = @user_id AND used_at IS NULL AND revoked_at IS NULL
RETURNING family_id;
