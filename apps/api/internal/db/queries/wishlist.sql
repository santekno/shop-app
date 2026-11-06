-- A buyer's wishlist (Bab 14). Every query is scoped by user_id, which the
-- API takes from the access token. Adding runs in a transaction that first
-- locks the user (LockUser), so the size limit holds when two requests race.
-- Only active products count and are listed: an archived product stays in
-- the table but disappears from the wishlist and from its limit.

-- name: GetActiveProductIDBySlug :one
-- No row: no active product has this slug (draft, archived or unknown).
SELECT id FROM products WHERE slug = @slug AND status = 'active';

-- name: WishlistItemExists :one
-- Served by wishlist_items_pkey.
SELECT EXISTS (
    SELECT 1 FROM wishlist_items WHERE user_id = @user_id AND product_id = @product_id
);

-- name: CountWishlistItems :one
-- What the size limit counts: the items the user can see. Served by
-- wishlist_items_user_created_idx, then one product lookup per item.
SELECT count(*)
FROM wishlist_items w
JOIN products p ON p.id = w.product_id AND p.status = 'active'
WHERE w.user_id = @user_id;

-- name: InsertWishlistItem :exec
-- Saving a product twice keeps the first row (and its created_at).
INSERT INTO wishlist_items (user_id, product_id)
VALUES (@user_id, @product_id)
ON CONFLICT (user_id, product_id) DO NOTHING;

-- name: DeleteWishlistItem :exec
-- Removing what is not there changes nothing.
DELETE FROM wishlist_items
WHERE user_id = @user_id AND product_id = (SELECT id FROM products WHERE slug = @slug);

-- name: ListWishlistItems :many
-- One page of the user's items, newest added first, after the cursor
-- (created_at, product_id): the row comparison matches
-- wishlist_items_user_created_idx, so Postgres jumps straight to it.
SELECT w.product_id, w.created_at
FROM wishlist_items w
JOIN products p ON p.id = w.product_id AND p.status = 'active'
WHERE w.user_id = @user_id
  AND (w.created_at, w.product_id) < (@cursor_created_at::timestamptz, @cursor_id::uuid)
ORDER BY w.created_at DESC, w.product_id DESC
LIMIT @page_size;

-- name: DeleteUserWishlist :exec
-- Account deletion.
DELETE FROM wishlist_items WHERE user_id = @user_id;
