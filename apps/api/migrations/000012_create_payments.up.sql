-- Payments (ADR 0007): one row per Midtrans Snap transaction of an order.
-- An order may have several over its life (a denied card, then a virtual
-- account), but at most one open at a time (payments_order_open_key). The
-- amount always comes from the order row, never from a client.

CREATE TABLE payments (
    id                 uuid        PRIMARY KEY,
    order_id           uuid        NOT NULL,
    -- 'fake' is the test double of APP_PAYMENT_PROVIDER=fake (Bab 6
    -- artikel 13), refused in production.
    provider           text        NOT NULL,
    -- Midtrans' order_id: the order code plus 6 random characters, new per
    -- payment, because Midtrans refuses an order_id it has seen before.
    provider_order_id  text        NOT NULL,
    -- Whole rupiah: the order's total when the payment was created.
    amount             bigint      NOT NULL,
    status             text        NOT NULL DEFAULT 'pending',
    snap_token         text        NOT NULL,
    redirect_url       text        NOT NULL,
    -- When Snap stops taking money: before the order's payment_expires_at.
    expires_at         timestamptz NOT NULL,
    -- What Midtrans last said (transaction_status, transaction_id,
    -- payment_type), for support; GoShop acts on status only.
    provider_status    text,
    provider_transaction_id text,
    payment_type       text,
    paid_at            timestamptz,
    -- Money received for an order that can no longer be paid (it expired,
    -- was cancelled, or another payment paid it first): the seller must
    -- return it. Never resurrects the order.
    refund_required_at timestamptz,
    -- Room for refunds (the chapter's challenge): 0 up to amount.
    refunded_amount    bigint      NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    -- Orders are never deleted; a payment is a financial record too.
    CONSTRAINT payments_order_fkey FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE RESTRICT,
    CONSTRAINT payments_provider_order_id_key UNIQUE (provider_order_id),
    CONSTRAINT payments_provider_order_id_check
        CHECK (provider_order_id ~ '^GS-[0-9]{8}-[0-9A-Z]{6}-[0-9A-Z]{6}$'),
    CONSTRAINT payments_provider_check CHECK (provider IN ('midtrans', 'fake')),
    CONSTRAINT payments_status_check CHECK (status IN (
        'pending', 'challenge', 'paid', 'denied', 'cancelled', 'expired', 'failed',
        'partially_refunded', 'refunded')),
    CONSTRAINT payments_amount_check CHECK (amount > 0),
    CONSTRAINT payments_refunded_amount_check CHECK (refunded_amount >= 0 AND refunded_amount <= amount),
    -- Every status that means money arrived has the time it arrived.
    CONSTRAINT payments_paid_check
        CHECK (status NOT IN ('paid', 'partially_refunded', 'refunded') OR paid_at IS NOT NULL),
    CONSTRAINT payments_refund_required_check CHECK (refund_required_at IS NULL OR paid_at IS NOT NULL)
);

-- At most one open payment per order: paying again returns it, and two
-- racing pay requests cannot both store a token. Also serves finding it.
CREATE UNIQUE INDEX payments_order_open_key ON payments (order_id)
    WHERE status IN ('pending', 'challenge');

-- An order's payments, newest first, and the RESTRICT on orders.
CREATE INDEX payments_order_created_idx ON payments (order_id, created_at DESC);
