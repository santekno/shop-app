-- Idempotency keys (ADR 0006). Every query is by the primary key
-- (user_id, key), except the cleanup, which uses
-- idempotency_keys_expires_at_idx.

-- name: ClaimIdempotencyKey :one
-- Claims the key for a new request, in its own statement before the
-- checkout runs. A key that exists is taken over only when it has expired,
-- or when its request never finished (no response, older than
-- @stale_before: the process died). Otherwise nothing is returned, and the
-- caller reads the key to replay it or refuse. Two claims at once: the
-- second waits for the first's row and then finds it taken.
--
-- Only for an account that exists: like the cart's upsert, the users row
-- is read FOR KEY SHARE, so a claim that meets an account deletion in
-- progress waits for it, then finds the account gone and claims nothing.
INSERT INTO idempotency_keys (user_id, key, request_hash, claim_id, created_at, expires_at)
SELECT u.id, @key::text, @request_hash::bytea, @claim_id::uuid, @now::timestamptz, @expires_at::timestamptz
FROM users u
WHERE u.id = @user_id AND u.anonymized_at IS NULL
FOR KEY SHARE
ON CONFLICT (user_id, key) DO UPDATE
SET request_hash = EXCLUDED.request_hash, claim_id = EXCLUDED.claim_id,
    created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at,
    response_status = NULL, response_body = NULL, order_id = NULL
WHERE idempotency_keys.expires_at <= @now::timestamptz
   OR (idempotency_keys.response_status IS NULL AND idempotency_keys.created_at < @stale_before::timestamptz)
RETURNING user_id;

-- name: GetIdempotencyKey :one
-- The body as text (empty while in flight): a replay writes these bytes
-- back unchanged.
SELECT request_hash, response_status, COALESCE(response_body::text, '')::text AS response_body, order_id
FROM idempotency_keys
WHERE user_id = @user_id AND key = @key;

-- name: SaveIdempotencyResponse :execrows
-- In the checkout's transaction. Zero rows: the key is not this request's
-- any more (another claim took it over as stale).
UPDATE idempotency_keys
SET response_status = @response_status::smallint, response_body = @response_body::json,
    order_id = @order_id::uuid
WHERE user_id = @user_id AND key = @key AND claim_id = @claim_id AND response_status IS NULL;

-- name: ReleaseIdempotencyKey :exec
-- A checkout that failed changed nothing; the key is freed so the buyer can
-- fix the cart and retry with it.
DELETE FROM idempotency_keys
WHERE user_id = @user_id AND key = @key AND claim_id = @claim_id AND response_status IS NULL;

-- name: DeleteExpiredIdempotencyKeys :execrows
-- One batch of the cleanup, so a large backlog never holds many locks at
-- once. The outer WHERE checks expires_at again: a key that a new claim
-- took over while this DELETE waited for its row lock has a new expiry,
-- and is re-read and kept.
DELETE FROM idempotency_keys
WHERE (user_id, key) IN (
    SELECT k.user_id, k.key FROM idempotency_keys k
    WHERE k.expires_at < @now
    ORDER BY k.expires_at
    LIMIT @batch_size
)
  AND expires_at < @now;

-- name: DeleteUserIdempotencyKeys :exec
-- Account deletion. Served by idempotency_keys_pkey (user_id first).
DELETE FROM idempotency_keys WHERE user_id = @user_id;
