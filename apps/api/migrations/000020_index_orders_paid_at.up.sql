-- The sales report (ADR 0007): orders paid in a range that were not
-- cancelled afterwards. Partial on exactly the report's statuses, so it
-- holds only orders that count as sales, and it carries id and total, so
-- the revenue per day is an index-only scan.
CREATE INDEX orders_paid_at_idx ON orders (paid_at) INCLUDE (id, total)
    WHERE status IN ('paid', 'processing', 'shipped', 'completed');
