-- Accounts (docs/erd.md). The API generates the UUIDv7 id and lower-cases
-- the email before it inserts; the CHECKs refuse anything else, so the
-- rules hold even when the code has a bug.

CREATE TABLE users (
    id                uuid        PRIMARY KEY,
    email             text        NOT NULL,
    -- argon2id in its encoded form ($argon2id$v=19$m=…), from sdk hashx.
    -- NULL for an account that signs in with Google only, and after
    -- anonymisation.
    password_hash     text,
    name              text        NOT NULL,
    phone             text,
    role              text        NOT NULL,
    email_verified_at timestamptz,
    -- Set when the account is deleted: the row stays because orders
    -- (Bab 5) point to it, but nothing identifies the person any more.
    anonymized_at     timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT users_email_key UNIQUE (email),
    -- One account per address: Budi@Mail.com and budi@mail.com cannot both
    -- exist. 254 characters is the longest address SMTP can deliver.
    CONSTRAINT users_email_check CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
    CONSTRAINT users_role_check CHECK (role IN ('buyer', 'seller', 'admin')),
    -- An anonymised row keeps no personal data and cannot log in.
    CONSTRAINT users_anonymized_check
        CHECK (anonymized_at IS NULL OR (password_hash IS NULL AND phone IS NULL AND name = ''))
);
