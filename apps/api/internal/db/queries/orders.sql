-- Orders (docs/erd.md, ADR 0006). Checkout runs these in one transaction,
-- in this lock order: the buyer's users row, then the buyer's cart, then
-- the variants in id order, then the voucher row (UseVoucher), then the
-- new rows. ADR 0006 ("Lock order") lists every path's order.

-- name: LockCheckoutUser :one
-- The users-first lock of ADR 0005. FOR NO KEY UPDATE makes the same
-- buyer's checkouts take turns (the pending-order and per-user voucher
-- counts below stay true), while the foreign keys of new rows, which take
-- FOR KEY SHARE, are not blocked. No rows: the account was deleted.
SELECT email_verified_at FROM users
WHERE id = @id AND anonymized_at IS NULL
FOR NO KEY UPDATE;

-- name: CountPendingOrders :one
-- Served by orders_user_pending_idx, which holds only unpaid orders, so the
-- count stays cheap for a buyer with thousands of past orders.
SELECT count(*) FROM orders WHERE user_id = @user_id AND status = 'pending_payment';

-- name: CountVoucherUses :one
-- A buyer's orders that used the voucher; a cancelled order gave its use
-- back. Served by orders_voucher_user_idx.
SELECT count(*) FROM orders
WHERE voucher_id = @voucher_id AND user_id = @user_id AND voucher_id IS NOT NULL AND status <> 'cancelled';

-- name: LockCheckoutCart :one
-- Locks the buyer's cart, after the buyer and before the variants: a second
-- checkout of the same cart (the web and the phone at once, with different
-- idempotency keys) waits here, then reads the lines the first one took
-- out, and refuses (ADR 0006). Served by carts_user_key.
SELECT id FROM carts WHERE user_id = @user_id FOR UPDATE;

-- name: LockCheckoutVariants :many
-- Locks the variants of the order in id order, the order every path that
-- locks several variants uses (ADR 0006, "Lock order"). Every requested
-- variant is locked, sellable or not, so checkout can say which line is
-- unavailable. FOR NO KEY UPDATE, not FOR UPDATE: it does not block the
-- FOR KEY SHARE lock another buyer's new cart line takes on the variant.
-- OF v leaves the product rows unlocked: an admin save locks the product
-- first and the variants second, and locking both here could deadlock
-- with it.
SELECT v.id, v.sku, v.name, v.price, v.stock, v.weight_grams,
       (v.archived_at IS NULL AND p.status = 'active')::boolean AS sellable,
       p.id AS product_id, p.slug AS product_slug, p.name AS product_name
FROM product_variants v
JOIN products p ON p.id = v.product_id
WHERE v.id = ANY(@ids::uuid[])
ORDER BY v.id
FOR NO KEY UPDATE OF v;

-- name: DecrementStock :execrows
-- The guarded decrement (docs/erd.md): only from a sellable variant of an
-- active product with enough stock, and every stock change bumps version
-- so the admin's optimistic check sees it. Zero rows: not available any
-- more, and the order is not created.
UPDATE product_variants v
SET stock = v.stock - @quantity::integer, version = v.version + 1, updated_at = now()
FROM products p
WHERE v.id = @id AND p.id = v.product_id
  AND p.status = 'active' AND v.archived_at IS NULL
  AND v.stock >= @quantity::integer;

-- name: InsertOrder :execrows
-- Zero rows: the random code is taken already; the repository makes a new
-- one. ON CONFLICT keeps the transaction alive, where a failed INSERT
-- would abort it. Every time on the row comes from the API's clock (@now),
-- like payment_expires_at and the later status times, so the row never
-- mixes two clocks and a test's clock (app.WithClock) moves all of them.
INSERT INTO orders (
    id, code, user_id, status, subtotal, discount, shipping_fee, total, total_weight_grams,
    voucher_id, voucher_code, courier, courier_service,
    shipping_recipient, shipping_phone, shipping_street, shipping_city, shipping_province, shipping_postal_code,
    payment_expires_at, created_at, updated_at)
VALUES (
    @id, @code, @user_id, 'pending_payment', @subtotal, @discount, @shipping_fee, @total, @total_weight_grams,
    sqlc.narg('voucher_id'), sqlc.narg('voucher_code'), @courier, @courier_service,
    @shipping_recipient, @shipping_phone, @shipping_street, @shipping_city, @shipping_province, @shipping_postal_code,
    @payment_expires_at, @now, @now)
ON CONFLICT (code) DO NOTHING;

-- name: InsertOrderItem :exec
-- created_at from the API's clock too, the order's own time.
INSERT INTO order_items (id, order_id, variant_id, product_name, variant_name, sku, unit_price, quantity, line_total, created_at)
VALUES (@id, @order_id, @variant_id, @product_name, @variant_name, @sku, @unit_price, @quantity, @line_total, @now);

-- name: DeleteOrderedCartItems :exec
-- The lines that became the order leave the cart; a line added while the
-- checkout ran stays. Served by carts_user_key and cart_items_pkey.
DELETE FROM cart_items
WHERE cart_id = (SELECT c.id FROM carts c WHERE c.user_id = @user_id)
  AND variant_id = ANY(@variant_ids::uuid[]);

-- name: GetOrderForUser :one
-- Scoped by the buyer: another user's order is not found (404).
SELECT id, code, user_id, status, cancel_reason, subtotal, discount, shipping_fee, total, total_weight_grams,
       voucher_code, courier, courier_service, tracking_number,
       shipping_recipient, shipping_phone, shipping_street, shipping_city, shipping_province, shipping_postal_code,
       payment_expires_at, paid_at, shipped_at, completed_at, cancelled_at, created_at, updated_at
FROM orders
WHERE id = @id AND user_id = @user_id;

-- name: ListOrderItems :many
-- Served by order_items_order_variant_key.
SELECT id, variant_id, product_name, variant_name, sku, unit_price, quantity, line_total
FROM order_items
WHERE order_id = @order_id
ORDER BY created_at, id;
