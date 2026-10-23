-- Refresh tokens (ADR 0005). A token is "<id>.<secret>"; only the SHA-256
-- of the secret is stored, so a copy of this table logs nobody in. All
-- tokens issued by one login share a family_id: that family is the
-- session, and its id is the access token's "sid" claim.

CREATE TABLE refresh_tokens (
    id         uuid        PRIMARY KEY,
    user_id    uuid        NOT NULL,
    family_id  uuid        NOT NULL,
    token_hash bytea       NOT NULL,
    expires_at timestamptz NOT NULL,
    -- Set when the token is rotated: presenting it again is reuse, and
    -- revokes the whole family.
    used_at    timestamptz,
    -- Set on logout, on reuse, on a password reset and on account deletion.
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    -- Users are anonymised, not deleted (docs/erd.md); CASCADE only
    -- matters for a user deleted outright, whose sessions go with them.
    CONSTRAINT refresh_tokens_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT refresh_tokens_hash_check CHECK (octet_length(token_hash) = 32)
);

-- Revoking a session (logout, reuse) updates every token of its family.
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Revoking every session of a user (password reset, account deletion)
-- only needs the tokens that can still be used: one per session. Being
-- partial, it does not serve the ON DELETE CASCADE above; users are only
-- anonymised today, so nothing deletes one. A path that deletes users
-- outright must add a full index on (user_id) first.
CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id)
    WHERE used_at IS NULL AND revoked_at IS NULL;
