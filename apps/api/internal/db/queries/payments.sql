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

-- name: CancelOpenPaymentsOfOrders :exec
-- An order that closes (cancelled by the buyer, the seller, the expiry
-- job or an account deletion) closes its open payment in the same
-- transaction, after the order row (ADR 0007): its Snap page must not take
-- money any more. A buyer who pays it anyway is flagged for a refund (the
-- payment may still move cancelled -> paid). One statement for many
-- orders, as account deletion needs. Served by payments_order_open_key.
UPDATE payments SET status = 'cancelled', updated_at = @now::timestamptz
WHERE order_id = ANY(@order_ids::uuid[]) AND status IN ('pending', 'challenge');

-- name: GetPaymentByProviderOrderID :one
-- The payment a notification is about. Served by
-- payments_provider_order_id_key.
SELECT id, order_id, provider, provider_order_id, amount, status, snap_token, redirect_url,
       expires_at, paid_at, refund_required_at, created_at, updated_at
FROM payments
WHERE provider_order_id = @provider_order_id;

-- name: LockPaymentOrder :one
-- The notification's first lock (ADR 0007, "Lock order"): the payment's
-- order, before the payment row, the order every path that closes an
-- order takes too (order, then its open payment). FOR NO KEY UPDATE: the
-- same strength as the order's own status UPDATEs, which it queues with.
SELECT status FROM orders WHERE id = @id FOR NO KEY UPDATE;

-- name: UpdatePaymentStatus :execrows
-- A guarded status change, like orders' (ADR 0007): @from_statuses comes
-- from the Go table payment.From, so a late or replayed status never moves
-- a payment backwards. It runs after LockPaymentOrder: the order, then the
-- payment row. Zero rows: not a move the payment may make now, and nothing
-- else is changed. paid_at keeps its first value.
UPDATE payments
SET status                  = @status,
    provider_status         = @provider_status,
    provider_transaction_id = COALESCE(sqlc.narg('provider_transaction_id'), provider_transaction_id),
    payment_type            = COALESCE(sqlc.narg('payment_type'), payment_type),
    paid_at                 = COALESCE(paid_at, sqlc.narg('paid_at')),
    updated_at              = @now
WHERE id = @id AND status = ANY(@from_statuses::text[]);

-- name: InsertPaymentEvent :execrows
-- Zero rows: this status of this transaction was recorded already, a
-- repeat (payment_events_dedupe_key).
INSERT INTO payment_events (
    id, payment_id, dedupe_key, source, transaction_status, fraud_status, status_code,
    transaction_id, payment_type, gross_amount, outcome, received_at)
VALUES (
    @id, @payment_id, @dedupe_key, @source, @transaction_status, sqlc.narg('fraud_status'), @status_code,
    sqlc.narg('transaction_id'), sqlc.narg('payment_type'), sqlc.narg('gross_amount'), @outcome, @received_at)
ON CONFLICT (payment_id, dedupe_key) DO NOTHING;

-- name: FlagPaymentForRefund :exec
-- Money arrived for an order that can no longer be paid (it expired, was
-- cancelled, or another payment paid it first). The order is not touched:
-- the seller returns the money (ADR 0007). Keeps the first flag time.
UPDATE payments SET refund_required_at = COALESCE(refund_required_at, @now::timestamptz), updated_at = @now::timestamptz
WHERE id = @id AND paid_at IS NOT NULL;
