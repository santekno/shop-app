-- The worker's guest-cart cleanup (ADR 0007): guest carts untouched for
-- 30 days. Partial, so it holds guest carts only.
CREATE INDEX carts_guest_updated_idx ON carts (updated_at) WHERE user_id IS NULL;
