-- The oversell check after a k6 run (e2e/k6/run.sh): read from the
-- database, not from k6's counters. make seed-loadtest resets the stock and
-- closes the load-test buyers' unpaid orders, so every unpaid order below
-- comes from this run.
--
--   LOADTEST-SCARCE: stock exactly 0, exactly 10 unpaid orders of one unit;
--   LOADTEST-PLENTY: the stock plus the units of its live orders is still
--                    1 000 000 (every cancel gave its unit back once);
--   no variant anywhere below 0.
DO $$
DECLARE
    scarce_stock  integer;
    scarce_orders integer;
    scarce_units  integer;
    plenty_stock  integer;
    plenty_live   integer;
    negative      integer;
BEGIN
    SELECT stock INTO scarce_stock FROM product_variants WHERE sku = 'LOADTEST-SCARCE';
    SELECT count(DISTINCT o.id), COALESCE(sum(i.quantity), 0) INTO scarce_orders, scarce_units
    FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE i.sku = 'LOADTEST-SCARCE' AND o.status = 'pending_payment';
    SELECT stock INTO plenty_stock FROM product_variants WHERE sku = 'LOADTEST-PLENTY';
    SELECT COALESCE(sum(i.quantity), 0) INTO plenty_live
    FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE i.sku = 'LOADTEST-PLENTY' AND o.status <> 'cancelled'
      AND o.user_id IN (SELECT id FROM users WHERE email LIKE 'loadtest-%@goshop.local');
    SELECT count(*) INTO negative FROM product_variants WHERE stock < 0;

    RAISE NOTICE 'LOADTEST-SCARCE: stock %, % unpaid orders, % units', scarce_stock, scarce_orders, scarce_units;
    RAISE NOTICE 'LOADTEST-PLENTY: stock %, % units in live orders', plenty_stock, plenty_live;
    IF scarce_stock IS DISTINCT FROM 0 OR scarce_orders <> 10 OR scarce_units <> 10 THEN
        RAISE EXCEPTION 'oversell check failed: LOADTEST-SCARCE stock %, % orders, % units; want 0, 10, 10',
            scarce_stock, scarce_orders, scarce_units;
    END IF;
    IF plenty_stock + plenty_live <> 1000000 THEN
        RAISE EXCEPTION 'stock check failed: LOADTEST-PLENTY stock % + % in live orders <> 1000000', plenty_stock, plenty_live;
    END IF;
    IF negative <> 0 THEN
        RAISE EXCEPTION '% variants have negative stock', negative;
    END IF;
    RAISE NOTICE 'oversell check passed';
END $$;
