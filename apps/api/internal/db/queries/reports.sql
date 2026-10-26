-- The sales report (ADR 0007). A sale is an order paid in the range that
-- was not cancelled afterwards: status paid, processing, shipped or
-- completed. Days, weeks and months are Jakarta's (WIB). Both queries are
-- served by orders_paid_at_idx, whose predicate is this status list.

-- name: SalesByPeriod :many
-- One row per period from @first_day to @last_day (Jakarta dates), empty
-- periods included (generate_series), with the running total over the
-- range (a window function over the per-period sums). The orders are
-- summed per period inside paid, so the outer join meets one row per
-- period instead of one per order.
WITH paid AS (
    SELECT date_trunc(@unit::text, o.paid_at AT TIME ZONE 'Asia/Jakarta') AS period,
           sum(o.total)::bigint AS revenue, count(*)::bigint AS orders
    FROM orders o
    WHERE o.status IN ('paid', 'processing', 'shipped', 'completed')
      AND o.paid_at >= @from_at::timestamptz AND o.paid_at < @to_at::timestamptz
    GROUP BY 1
),
periods AS (
    SELECT generate_series(
        date_trunc(@unit::text, @first_day::timestamp),
        @last_day::timestamp,
        ('1 ' || @unit::text)::interval) AS period
)
SELECT p.period::timestamp AS period,
       COALESCE(paid.revenue, 0)::bigint AS revenue,
       COALESCE(paid.orders, 0)::bigint AS orders,
       (sum(COALESCE(paid.revenue, 0)) OVER (ORDER BY p.period))::bigint AS cumulative_revenue
FROM periods p
LEFT JOIN paid ON paid.period = p.period
ORDER BY p.period;

-- name: TopProducts :many
-- The products that sold the most in the range, by the revenue of their
-- lines (goods only, before vouchers and shipping), ranked with a window
-- function (ties share a rank). The ranking and the LIMIT run on the sums,
-- so only the top rows look up their product's name (products_pkey). On a
-- month of a big shop (the audit's 1 million order lines) the planner reads
-- the range's orders from orders_paid_at_idx and hash-joins their lines and
-- variants; a nested loop over order_items_order_variant_key was 6 times
-- slower there.
WITH sold AS (
    SELECT v.product_id, sum(oi.quantity)::bigint AS units, sum(oi.line_total)::bigint AS revenue
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN product_variants v ON v.id = oi.variant_id
    WHERE o.status IN ('paid', 'processing', 'shipped', 'completed')
      AND o.paid_at >= @from_at::timestamptz AND o.paid_at < @to_at::timestamptz
    GROUP BY v.product_id
),
ranked AS (
    SELECT s.product_id, s.units, s.revenue, rank() OVER (ORDER BY s.revenue DESC) AS rank
    FROM sold s
    ORDER BY s.revenue DESC, s.product_id
    LIMIT @top
)
SELECT r.product_id, p.name, r.units, r.revenue, r.rank::integer AS rank
FROM ranked r
JOIN products p ON p.id = r.product_id
ORDER BY r.revenue DESC, r.product_id;
