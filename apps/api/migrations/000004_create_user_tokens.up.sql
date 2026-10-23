-- One-time tokens sent by email: verifying the address and resetting the
-- password. Same shape as refresh tokens (ADR 0005): "<id>.<secret>", only
-- the SHA-256 of the secret stored, used once, with an expiry.

CREATE TABLE user_tokens (
    id         uuid        PRIMARY KEY,
    user_id    uuid        NOT NULL,
    purpose    text        NOT NULL,
    token_hash bytea       NOT NULL,
    expires_at timestamptz NOT NULL,
    -- Set when the token is used; it never works again.
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_tokens_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT user_tokens_purpose_check CHECK (purpose IN ('verify_email', 'reset_password')),
    CONSTRAINT user_tokens_hash_check CHECK (octet_length(token_hash) = 32)
);

-- A new email replaces the user's unused tokens of the same purpose, so only
-- the newest link works. Not partial, so it also serves deleting every
-- token of a user (account deletion) and the CASCADE.
CREATE INDEX user_tokens_user_purpose_idx ON user_tokens (user_id, purpose);
