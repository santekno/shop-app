-- Sign-in providers linked to an account (docs/erd.md): Google from Bab 4.
-- An identity is the provider's stable subject id ("sub"), never an email:
-- an email address can change hands, the subject cannot.

CREATE TABLE user_identities (
    id         uuid        PRIMARY KEY,
    user_id    uuid        NOT NULL,
    provider   text        NOT NULL,
    subject    text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_identities_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT user_identities_provider_check CHECK (provider IN ('google')),
    CONSTRAINT user_identities_subject_check CHECK (subject <> '' AND length(subject) <= 255),
    -- One account per provider identity: the lookup at every sign-in.
    CONSTRAINT user_identities_provider_subject_key UNIQUE (provider, subject),
    -- One identity per provider per account. Leads with user_id, so it also
    -- serves deleting a user's identities and the CASCADE.
    CONSTRAINT user_identities_user_provider_key UNIQUE (user_id, provider)
);
