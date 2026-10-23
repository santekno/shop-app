-- Carts (ADR 0006). A user has at most one cart; a guest cart has no user
-- and belongs to whoever holds its token "<cart id>.<secret>", of which
-- only the SHA-256 of the secret is stored, like the refresh tokens.

CREATE TABLE carts (
    id         uuid        PRIMARY KEY,
    user_id    uuid,
    token_hash bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- A cart is working state, not a record: it goes with its user. Users
    -- are anonymised, not deleted, so this only matters for an outright
    -- delete. carts_user_key below serves the CASCADE.
    CONSTRAINT carts_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    -- One cart per user; the login merge (POST /v1/cart/merge) moves a
    -- guest cart into it.
    CONSTRAINT carts_user_key UNIQUE (user_id),
    -- A user's cart or a guest's, never both and never neither.
    CONSTRAINT carts_owner_check CHECK ((user_id IS NULL) <> (token_hash IS NULL)),
    CONSTRAINT carts_token_hash_check CHECK (token_hash IS NULL OR octet_length(token_hash) = 32)
);

CREATE TABLE cart_items (
    cart_id    uuid        NOT NULL,
    variant_id uuid        NOT NULL,
    quantity   integer     NOT NULL,
    -- The price the buyer saw when they last added or changed the line.
    -- Checkout compares it with the current price (price_changed).
    unit_price bigint      NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- One line per variant: adding it again raises the quantity. The key
    -- leads with cart_id, so it also serves reading a cart and the CASCADE.
    CONSTRAINT cart_items_pkey PRIMARY KEY (cart_id, variant_id),
    CONSTRAINT cart_items_cart_fkey FOREIGN KEY (cart_id)
        REFERENCES carts (id) ON DELETE CASCADE,
    -- Variants are archived, never deleted.
    CONSTRAINT cart_items_variant_fkey FOREIGN KEY (variant_id)
        REFERENCES product_variants (id) ON DELETE RESTRICT,
    CONSTRAINT cart_items_quantity_check CHECK (quantity BETWEEN 1 AND 99),
    CONSTRAINT cart_items_unit_price_check CHECK (unit_price > 0)
);

-- The RESTRICT check above, should a variant ever be deleted.
CREATE INDEX cart_items_variant_id_idx ON cart_items (variant_id);
