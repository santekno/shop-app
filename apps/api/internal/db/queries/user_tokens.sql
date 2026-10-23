-- One-time email tokens. Like refresh tokens, a row is found by its id and
-- the service compares the hash in constant time.

-- name: DeleteUnusedUserTokens :exec
-- Before a new token is sent, after LockUser: the older ones of the same
-- purpose stop working. Served by user_tokens_user_purpose_idx.
DELETE FROM user_tokens
WHERE user_id = @user_id AND purpose = @purpose AND used_at IS NULL;

-- name: InsertUserToken :exec
INSERT INTO user_tokens (id, user_id, purpose, token_hash, expires_at)
VALUES (@id, @user_id, @purpose, @token_hash, @expires_at);

-- name: LockUserTokenOwner :one
-- Taken before LockUserToken: the user's row first, then the token's, the
-- lock order every transaction on a user's tokens follows (ADR 0005), so
-- using a token cannot deadlock with an account deletion.
SELECT u.id FROM users u
WHERE u.id = (SELECT ut.user_id FROM user_tokens ut WHERE ut.id = @id)
FOR NO KEY UPDATE;

-- name: LockUserToken :one
-- The token and whether its account still exists, locked so it can be used
-- only once even by two requests at the same moment.
SELECT ut.id, ut.user_id, ut.purpose, ut.token_hash, ut.expires_at, ut.used_at, u.anonymized_at
FROM user_tokens ut
JOIN users u ON u.id = ut.user_id
WHERE ut.id = @id
FOR UPDATE OF ut;

-- name: MarkUserTokenUsed :exec
UPDATE user_tokens SET used_at = now()
WHERE id = @id;
