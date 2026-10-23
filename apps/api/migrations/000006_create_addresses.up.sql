-- A user's shipping addresses (docs/erd.md). Orders (Bab 5) copy the
-- address they ship to, so an address can be edited or deleted freely.

CREATE TABLE addresses (
    id             uuid        PRIMARY KEY,
    user_id        uuid        NOT NULL,
    label          text        NOT NULL,
    recipient_name text        NOT NULL,
    phone          text        NOT NULL,
    street         text        NOT NULL,
    city           text        NOT NULL,
    province       text        NOT NULL,
    postal_code    text        NOT NULL,
    is_default     boolean     NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT addresses_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    -- Indonesian postal codes: five digits, never starting with 0.
    CONSTRAINT addresses_postal_code_check CHECK (postal_code ~ '^[1-9][0-9]{4}$')
);

-- A user's address book, and the CASCADE.
CREATE INDEX addresses_user_id_idx ON addresses (user_id);

-- At most one default address per user. The API keeps exactly one while
-- the user has any; this index makes "two defaults" impossible even when
-- two requests race.
CREATE UNIQUE INDEX addresses_one_default_idx ON addresses (user_id) WHERE is_default;
