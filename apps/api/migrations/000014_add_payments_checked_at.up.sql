-- Payment reconciliation (ADR 0007): the reconciler asks Midtrans about
-- every payment that may still take money, in case a notification was
-- lost. checked_at is when it last asked; final_checked_at is when it
-- first got a final answer (settled, expired, denied, cancelled, failed,
-- refunded, or no such transaction after its expiry), after which the
-- payment can take no more money that GoShop would not hear about.
ALTER TABLE payments
    ADD COLUMN checked_at timestamptz,
    ADD COLUMN final_checked_at timestamptz;

-- The reconciler's first queue: open payments only (partial, so it stays as
-- small as the number of orders waiting for payment), never-checked first.
CREATE INDEX payments_reconcile_idx ON payments (checked_at NULLS FIRST, created_at)
    WHERE status IN ('pending', 'challenge');

-- Its second queue: payments GoShop closed itself when their order closed.
-- Midtrans still takes money for them until expires_at (or later, if its
-- own expiry lags), so the reconciler keeps asking until a check gets a
-- final answer; then the payment leaves this index, which therefore holds
-- only the closed payments still without one, however many pile up over
-- the years. Ordered by expiry: the ones closest to the end of their
-- window first.
CREATE INDEX payments_closed_window_idx ON payments (expires_at)
    WHERE status = 'cancelled' AND final_checked_at IS NULL;
