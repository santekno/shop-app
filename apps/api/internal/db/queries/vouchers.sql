-- Vouchers (ADR 0006). The code is upper-cased by the API; vouchers_code_key
-- serves the lookup.

-- name: GetVoucherByCode :one
SELECT id, code, kind, value, min_spend, max_discount, starts_at, ends_at,
       usage_limit, used_count, per_user_limit
FROM vouchers
WHERE code = @code;

-- name: UseVoucher :execrows
-- Counts one use at checkout, race-safe without a lock taken beforehand:
-- the WHERE re-checks the window and the limit on the row as it is when
-- the UPDATE runs (a concurrent checkout waits for this row and then
-- re-evaluates it), so two buyers cannot both take the last use. Zero rows:
-- used up, or outside its window.
UPDATE vouchers
SET used_count = used_count + 1, updated_at = now()
WHERE id = @id
  AND @now::timestamptz >= starts_at AND @now::timestamptz < ends_at
  AND (usage_limit IS NULL OR used_count < usage_limit);
