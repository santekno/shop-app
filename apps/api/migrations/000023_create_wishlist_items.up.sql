-- A buyer's wishlist (Bab 14): the products they saved for later. The
-- mobile app updates its heart icon optimistically and rolls back when the
-- server refuses, so the wishlist has to live on the server.

CREATE TABLE wishlist_items (
    user_id    uuid        NOT NULL,
    product_id uuid        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    -- One row per product per user: saving a product twice is a no-op.
    -- The key leads with user_id, so it also serves the CASCADE on users.
    CONSTRAINT wishlist_items_pkey PRIMARY KEY (user_id, product_id),
    -- A wishlist is the user's working state, not a record. Users are
    -- anonymised, not deleted, so account deletion removes the rows itself
    -- (DeleteUserWishlist); this only matters for an outright delete.
    CONSTRAINT wishlist_items_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    -- Products are archived, never deleted; an archived product just stops
    -- being listed.
    CONSTRAINT wishlist_items_product_fkey FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT
);

-- GET /v1/me/wishlist: a user's items, newest first, paged by the cursor
-- (created_at, product_id).
CREATE INDEX wishlist_items_user_created_idx
    ON wishlist_items (user_id, created_at DESC, product_id DESC);

-- The RESTRICT check above, should a product ever be deleted.
CREATE INDEX wishlist_items_product_id_idx ON wishlist_items (product_id);
