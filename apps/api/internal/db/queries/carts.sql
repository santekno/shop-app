-- Carts (ADR 0006). Every write to a cart's lines runs in a transaction
-- that first locks the cart row (UpsertUserCart or LockGuestCart), so the
-- 50-line limit and the per-line quantity hold when two requests race.

-- name: UpsertUserCart :one
-- The user's cart, created on first use. DO UPDATE (not DO NOTHING) so the
-- row is returned and locked for the rest of the transaction even when it
-- already existed. Served by carts_user_key.
--
-- Only for an account that exists: the users row is read FOR KEY SHARE,
-- so a cart write that meets an account deletion in progress waits for it
-- and then finds anonymized_at set, and returns no row instead of giving
-- the deleted account a cart again. FOR KEY SHARE does not conflict with
-- checkout's FOR NO KEY UPDATE on the same row.
INSERT INTO carts (id, user_id)
SELECT @id::uuid, u.id
FROM users u
WHERE u.id = @user_id AND u.anonymized_at IS NULL
FOR KEY SHARE
ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
RETURNING id;

-- name: GetUserCartID :one
SELECT id FROM carts WHERE user_id = @user_id;

-- name: ListCartLines :many
-- A cart's lines with what the buyer needs to decide: the current price
-- and stock, and whether the variant can still be sold. Served by
-- cart_items_pkey, then one primary-key lookup per variant and product.
SELECT ci.variant_id, ci.quantity, ci.unit_price AS added_price, ci.created_at,
       v.sku, v.name AS variant_name, v.price, v.stock, v.weight_grams,
       (v.archived_at IS NULL AND p.status = 'active')::boolean AS sellable,
       p.id AS product_id, p.slug AS product_slug, p.name AS product_name
FROM cart_items ci
JOIN product_variants v ON v.id = ci.variant_id
JOIN products p ON p.id = v.product_id
WHERE ci.cart_id = @cart_id
ORDER BY ci.created_at, ci.variant_id;

-- name: GetSellableVariant :one
-- A variant that can be put in a cart: not archived, of an active product.
SELECT v.id, v.price, v.stock
FROM product_variants v
JOIN products p ON p.id = v.product_id
WHERE v.id = @id AND v.archived_at IS NULL AND p.status = 'active';

-- name: CountCartItems :one
SELECT count(*) FROM cart_items WHERE cart_id = @cart_id;

-- name: GetCartItemQuantity :one
SELECT quantity FROM cart_items WHERE cart_id = @cart_id AND variant_id = @variant_id;

-- name: UpsertCartItem :exec
-- Writes the line's new quantity, computed by the repository under the
-- cart lock, and the price the buyer sees now.
INSERT INTO cart_items (cart_id, variant_id, quantity, unit_price)
VALUES (@cart_id, @variant_id, @quantity, @unit_price)
ON CONFLICT (cart_id, variant_id)
DO UPDATE SET quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, updated_at = now();

-- name: DeleteCartItem :execrows
DELETE FROM cart_items WHERE cart_id = @cart_id AND variant_id = @variant_id;

-- Guest carts (ADR 0006). The token "<cart id>.<secret>" carries the row
-- id, so the cart is found by its primary key; the repository then
-- compares token_hash with the hash of the presented secret in constant
-- time. user_id IS NULL keeps a merged cart's id from ever working as a
-- guest token again (a merge deletes the guest cart anyway).

-- name: InsertGuestCart :exec
INSERT INTO carts (id, token_hash) VALUES (@id, @token_hash);

-- name: GetGuestCart :one
SELECT token_hash FROM carts WHERE id = @id AND user_id IS NULL;

-- name: LockGuestCart :one
-- Lock order: a merge locks the user's cart first and the guest cart
-- second; nothing locks them the other way round.
--
-- An UPDATE, not SELECT … FOR UPDATE (Bab 6): every write to a guest
-- cart's lines touches the cart row, so updated_at is its last use, and
-- the row really changes. The guest-cart cleanup re-checks its conditions
-- only on a row that changed while it waited: a row that was merely
-- locked would be deleted, with a line added by the write it waited for.
UPDATE carts SET updated_at = now()
WHERE id = @id AND user_id IS NULL
RETURNING token_hash;

-- name: DeleteCart :exec
-- After a merge. Its lines go with it (ON DELETE CASCADE).
DELETE FROM carts WHERE id = @id;

-- name: DeleteUserCart :exec
-- Account deletion: the cart and, through the CASCADE, its lines.
DELETE FROM carts WHERE user_id = @user_id;

-- name: DeleteAbandonedGuestCarts :execrows
-- The worker's cleanup (ADR 0007): up to @batch_size guest carts whose
-- cart and lines were all last touched before @before, with their lines
-- (CASCADE). SKIP LOCKED leaves a cart that a cart write or a merge holds
-- right now. A write that locks the cart just after the cleanup read it
-- waits for the DELETE and then finds no cart (404, the guest starts a new
-- one). A write that commits first changed the row (LockGuestCart updates
-- updated_at), so PostgreSQL re-checks the row against the WHERE before
-- the DELETE takes it, and keeps it. The NOT EXISTS over cart_items is a
-- plain read of the snapshot and is not re-checked; carts.updated_at is
-- what protects a cart in use. Served by carts_guest_updated_idx and
-- cart_items_pkey.
DELETE FROM carts
WHERE id IN (
    SELECT c.id FROM carts c
    WHERE c.user_id IS NULL AND c.updated_at < @before
      AND NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id AND ci.updated_at >= @before)
    ORDER BY c.updated_at
    LIMIT @batch_size
    FOR UPDATE SKIP LOCKED);
