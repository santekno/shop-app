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
-- final_checked_at goes back to NULL: the close starts a new window for
-- the reconciler to watch (its closed queue), whatever it had concluded
-- about the payment while it was open.
UPDATE payments SET status = 'cancelled', final_checked_at = NULL, updated_at = @now::timestamptz
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

-- name: ListPaymentsToReconcile :many
-- What the reconciler asks Midtrans about (ADR 0007), created before
-- @created_before (a fresh payment may still be waiting for its first
-- notification), from two queues, each with its own budget per run:
--   * up to @batch_size open payments (pending, challenge), the least
--     recently checked first; served by payments_reconcile_idx;
--   * up to @closed_batch_size payments GoShop closed itself when their
--     order closed (cancelled). Midtrans was never told, so it takes money
--     until expires_at. Such a payment stays in this queue until a check
--     gets a final answer (final_checked_at): a backlog is delayed, never
--     dropped, and a Midtrans that still says pending after the window
--     keeps it queued. The ones closest to the end of their window first.
--     It is asked about again at most every 30 minutes
--     (@closed_recheck_before), except once its window has ended
--     (@window_ended_before) and it has not been checked since: then it is
--     due at once. Served by payments_closed_window_idx, whose predicate
--     is the first line of the WHERE.
-- The open payments are listed first (closed: false sorts before true; a
-- UNION can only be ordered by its output columns).
(SELECT o.id, o.order_id, o.provider, o.provider_order_id, o.amount, o.status, o.snap_token, o.redirect_url,
        o.expires_at, o.paid_at, o.refund_required_at, o.created_at, o.updated_at, o.checked_at,
        false AS closed
 FROM payments o
 WHERE o.status IN ('pending', 'challenge') AND o.created_at < @created_before
 ORDER BY o.checked_at NULLS FIRST, o.created_at
 LIMIT @batch_size)
UNION ALL
(SELECT c.id, c.order_id, c.provider, c.provider_order_id, c.amount, c.status, c.snap_token, c.redirect_url,
        c.expires_at, c.paid_at, c.refund_required_at, c.created_at, c.updated_at, c.checked_at,
        true AS closed
 FROM payments c
 WHERE c.status = 'cancelled' AND c.final_checked_at IS NULL
   AND c.created_at < @created_before
   AND (c.checked_at IS NULL OR c.checked_at < @closed_recheck_before::timestamptz
        OR (c.expires_at < @window_ended_before::timestamptz
            AND c.checked_at - c.expires_at < interval '10 minutes'))
 ORDER BY c.expires_at
 LIMIT @closed_batch_size)
ORDER BY closed, expires_at;

-- name: MarkPaymentChecked :exec
-- Bookkeeping for the reconciler, not a change of the payment, so
-- updated_at stays: every check that got an answer sets checked_at; one
-- that got a final answer (@final) also sets final_checked_at, once, which
-- takes a closed payment out of the reconciler's closed queue.
UPDATE payments
SET checked_at       = @now::timestamptz,
    final_checked_at = CASE WHEN @final::boolean THEN COALESCE(final_checked_at, @now::timestamptz)
                            ELSE final_checked_at END
WHERE id = @id;

