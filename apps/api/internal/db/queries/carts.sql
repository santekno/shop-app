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
SELECT token_hash FROM carts WHERE id = @id AND user_id IS NULL FOR UPDATE;

-- name: DeleteCart :exec
-- After a merge. Its lines go with it (ON DELETE CASCADE).
DELETE FROM carts WHERE id = @id;

-- name: DeleteUserCart :exec
-- Account deletion: the cart and, through the CASCADE, its lines.
DELETE FROM carts WHERE user_id = @user_id;
