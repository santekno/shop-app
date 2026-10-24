-- Payments (ADR 0007).

-- name: GetOpenPayment :one
-- The order's open payment, if any. Served by payments_order_open_key.
SELECT id, order_id, provider, provider_order_id, amount, status, snap_token, redirect_url,
       expires_at, paid_at, refund_required_at, created_at, updated_at
FROM payments
WHERE order_id = @order_id AND status IN ('pending', 'challenge');

-- name: InsertPayment :execrows
-- Stores a new Snap transaction, but only while the order still waits for
-- payment with this total, and only when it has no open payment yet. Zero
-- rows: another request stored one first (read it with GetOpenPayment),
-- or the order was paid, cancelled or expired meanwhile. ON CONFLICT names
-- the partial unique index, so the loser of a race does not abort the
-- transaction.
--
-- FOR SHARE OF o (ADR 0007, "Lock order"): every path that closes or pays
-- an order locks the order row first, so this statement queues behind one
-- that is running and then re-checks the status on the committed row; and
-- a close that comes after it waits for it, and then finds, and cancels,
-- the new payment. Either way no open payment is left on a closed order.
-- The lock lasts this one statement: the Midtrans call ran before it.
INSERT INTO payments (
    id, order_id, provider, provider_order_id, amount, snap_token, redirect_url, expires_at, created_at, updated_at)
SELECT @id, o.id, @provider, @provider_order_id, o.total, @snap_token, @redirect_url, @expires_at, @now, @now
FROM orders o
WHERE o.id = @order_id AND o.status = 'pending_payment' AND o.total = @amount
FOR SHARE OF o
ON CONFLICT (order_id) WHERE status IN ('pending', 'challenge') DO NOTHING;

