-- EXPLAIN (ANALYZE, BUFFERS) for the storefront catalog queries.
--
-- Run on a seeded database (make up && make seed-large), from the repo root:
--   docker compose exec -T postgres psql -U goshop -d goshop < docs/explain/catalog.sql
-- (docker-compose with a hyphen on older installs). Results and how to read
-- them: docs/explain/catalog.md.
--
-- The statements are the SQL sqlc generated in apps/api/internal/db/sqlc,
-- prepared with the same $n parameters the API sends, so each EXPLAIN shows
-- the plan the API gets. Regenerate this file's queries from there when a
-- query changes.

\pset pager off
\set ECHO queries
SET plan_cache_mode = force_custom_plan; -- as the API's connections
ANALYZE products;
ANALYZE product_variants;
ANALYZE categories;

PREPARE list_newest(uuid[], text, timestamptz, uuid, int) AS
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at
    FROM products p
    WHERE p.status = 'active'
      AND ($1::uuid[] IS NULL
           OR p.category_id = ANY($1::uuid[]))
      AND ($2::text IS NULL
           OR p.search @@ websearch_to_tsquery('indonesian', $2))
      AND (p.created_at, p.id) < ($3::timestamptz, $4::uuid)
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $5
)
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
LEFT JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.created_at DESC, page.id DESC, v.price, v.position, v.id;

PREPARE list_price_asc(uuid[], text, bigint, uuid, int) AS
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at
    FROM products p
    WHERE p.status = 'active'
      AND ($1::uuid[] IS NULL
           OR p.category_id = ANY($1::uuid[]))
      AND ($2::text IS NULL
           OR p.search @@ websearch_to_tsquery('indonesian', $2))
      AND (p.price_from, p.id) > ($3::bigint, $4::uuid)
    ORDER BY p.price_from, p.id
    LIMIT $5
)
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
LEFT JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.price_from, page.id, v.price, v.position, v.id;

PREPARE list_price_desc(uuid[], text, bigint, uuid, int) AS
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at
    FROM products p
    WHERE p.status = 'active'
      AND ($1::uuid[] IS NULL
           OR p.category_id = ANY($1::uuid[]))
      AND ($2::text IS NULL
           OR p.search @@ websearch_to_tsquery('indonesian', $2))
      AND (p.price_from, p.id) < ($3::bigint, $4::uuid)
    ORDER BY p.price_from DESC, p.id DESC
    LIMIT $5
)
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
LEFT JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.price_from DESC, page.id DESC, v.price, v.position, v.id;

PREPARE product_by_slug(text) AS
SELECT p.id, p.slug, p.name, p.description, p.price_from, p.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM products p
JOIN categories c ON c.id = p.category_id
LEFT JOIN product_variants v ON v.product_id = p.id AND v.archived_at IS NULL
WHERE p.slug = $1 AND p.status = 'active'
ORDER BY v.price, v.position, v.id;

PREPARE category_tree_ids(text) AS
SELECT c.id
FROM categories c
JOIN categories t ON c.id = t.id OR c.parent_id = t.id
WHERE t.slug = $1;

-- The ID lists the API passes for ?category=, from category_tree_ids.
SELECT array_agg(c.id)::text AS pakaian FROM categories c JOIN categories t ON c.id = t.id OR c.parent_id = t.id WHERE t.slug = 'pakaian' \gset
SELECT array_agg(c.id)::text AS kaos FROM categories c JOIN categories t ON c.id = t.id OR c.parent_id = t.id WHERE t.slug = 'kaos' \gset

-- 1. First page, newest (limit 20 + 1)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest(NULL, NULL, '9999-12-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);

-- 2. A deep page, newest: the cursor of the 5000th product
SELECT created_at AS c_time, id AS c_id FROM products WHERE status = 'active'
ORDER BY created_at DESC, id DESC OFFSET 4999 LIMIT 1 \gset
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest(NULL, NULL, :'c_time', :'c_id', 21);

-- 3. The same deep page with OFFSET, for comparison (not used by the API)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM products WHERE status = 'active' ORDER BY created_at DESC, id DESC OFFSET 5000 LIMIT 21;

-- 4. Newest in a top-level category (pakaian and its three children)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest(:'pakaian', NULL, '9999-12-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);

-- 5. Newest in a child category (kaos)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest(:'kaos', NULL, '9999-12-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);

-- 6. Newest in an empty category: the worst case before category_ids. The
--    category exists only inside this transaction.
BEGIN;
INSERT INTO categories (id, parent_id, level, parent_level, name, slug)
SELECT '01a16299-0000-7000-8000-000000000001', id, 2, 1, 'Kosong', 'kosong' FROM categories WHERE slug = 'pakaian';
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest('{01a16299-0000-7000-8000-000000000001}', NULL, '9999-12-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_price_asc('{01a16299-0000-7000-8000-000000000001}', NULL, 0, '00000000-0000-0000-0000-000000000000', 21);
ROLLBACK;

-- 7. Cheapest first
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_price_asc(NULL, NULL, 0, '00000000-0000-0000-0000-000000000000', 21);

-- 8. Most expensive first (the same index, backwards)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_price_desc(NULL, NULL, 9223372036854775807, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);

-- 9. Cheapest first in a top-level category
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_price_asc(:'pakaian', NULL, 0, '00000000-0000-0000-0000-000000000000', 21);

-- 10. Search, newest
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest(NULL, 'kopi arabika', '9999-12-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);

-- 11. Search in a category, cheapest first
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_price_asc(:'pakaian', 'kaos', 0, '00000000-0000-0000-0000-000000000000', 21);

-- 12. The generic plan of the search query, for a word no product has.
--     After five runs a prepared statement may switch to one plan for all
--     parameter values. The API prevents that (database.Open sets
--     plan_cache_mode=force_custom_plan on its connections); this shows why.
SET plan_cache_mode = force_generic_plan;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest(NULL, 'sepatu', '9999-12-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);
SET plan_cache_mode = force_custom_plan;

-- 13. The same search with a custom plan, as the API runs it
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE list_newest(NULL, 'sepatu', '9999-12-31', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 21);

-- 14. One product by slug
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE product_by_slug('kaos-polos-hitam');

-- 15. Resolving ?category= (a category and its children)
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) EXECUTE category_tree_ids('pakaian');
