-- What Midtrans said about a payment, and what GoShop did about it
-- (ADR 0007). One row per distinct status: Midtrans retries a notification
-- until it gets a 2xx, and the reconciler asks again every few minutes, so
-- the same status arrives many times; the unique key makes every repeat a
-- no-op. It is also the payment's audit trail. No secret is stored: not
-- the signature, not the server key.

CREATE TABLE payment_events (
    id                 uuid        PRIMARY KEY,
    payment_id         uuid        NOT NULL,
    -- transaction_id|transaction_status|fraud_status: the same status of
    -- the same Midtrans transaction is the same event.
    dedupe_key         text        NOT NULL,
    -- Who asked: Midtrans' notification, or GoShop's reconciler.
    source             text        NOT NULL,
    transaction_status text        NOT NULL,
    fraud_status       text,
    status_code        text        NOT NULL,
    transaction_id     text,
    payment_type       text,
    -- gross_amount in whole rupiah; NULL when Midtrans sent a fraction.
    gross_amount       bigint,
    outcome            text        NOT NULL,
    received_at        timestamptz NOT NULL,

    CONSTRAINT payment_events_payment_fkey FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE RESTRICT,
    -- Leads with payment_id, so it also serves a payment's history and the
    -- RESTRICT.
    CONSTRAINT payment_events_dedupe_key UNIQUE (payment_id, dedupe_key),
    CONSTRAINT payment_events_source_check CHECK (source IN ('webhook', 'reconcile')),
    CONSTRAINT payment_events_outcome_check CHECK (outcome IN (
        'paid', 'order_cancelled', 'refund_required', 'amount_mismatch', 'recorded'))
);
