-- Idempotency keys of POST /v1/checkout (ADR 0006). A key belongs to the
-- user who sent it, remembers the SHA-256 of the request body, and, once
-- the checkout committed, the response it gave, so a retry gets that same
-- response instead of a second order.

CREATE TABLE idempotency_keys (
    user_id         uuid        NOT NULL,
    key             text        NOT NULL,
    request_hash    bytea       NOT NULL,
    -- New on every claim, including a takeover of an expired or stale key.
    -- Saving the answer and releasing the key match it, so a request that
    -- was taken over can neither write into, nor delete, the new claim.
    claim_id        uuid        NOT NULL,
    -- NULL while the request is in flight. Written in the checkout's own
    -- transaction, so the order and its stored response commit together.
    response_status smallint,
    -- json, not jsonb: a replay must return the very bytes of the first
    -- answer, and jsonb would reorder its keys.
    response_body   json,
    -- The order the key created. No foreign key: this is short-lived
    -- request state, and orders are never deleted.
    order_id        uuid,
    created_at      timestamptz NOT NULL,
    expires_at      timestamptz NOT NULL,

    CONSTRAINT idempotency_keys_pkey PRIMARY KEY (user_id, key),
    -- Keys go with their user; the primary key leads with user_id, so it
    -- serves the CASCADE.
    CONSTRAINT idempotency_keys_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT idempotency_keys_key_check CHECK (octet_length(key) BETWEEN 1 AND 255),
    CONSTRAINT idempotency_keys_hash_check CHECK (octet_length(request_hash) = 32),
    CONSTRAINT idempotency_keys_response_check
        CHECK ((response_status IS NULL) = (response_body IS NULL))
);

-- The cleanup of expired keys (api cleanup-idempotency-keys).
CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys (expires_at);
