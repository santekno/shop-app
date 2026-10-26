-- Reverses 000014_add_payments_checked_at.up.sql.
DROP INDEX IF EXISTS payments_closed_window_idx;
DROP INDEX IF EXISTS payments_reconcile_idx;
ALTER TABLE payments DROP COLUMN IF EXISTS final_checked_at, DROP COLUMN IF EXISTS checked_at;
