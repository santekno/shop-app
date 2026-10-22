# EXPLAIN ANALYZE: the catalog queries

This page checks, with real plans, that the storefront queries in `apps/api/internal/db/queries/products.sql` use the indexes from [the ERD](../erd.md#indexes-built-in-bab-3). The full output is in [`catalog-output.txt`](catalog-output.txt), and the script that produces it is [`catalog.sql`](catalog.sql).

## Reproduce it

```bash
make up            # postgres, migrations (the one-shot migrate service) and the api
make seed-large    # the example catalog plus 10,000 generated products
docker compose exec -T postgres psql -U goshop -d goshop < docs/explain/catalog.sql
```

The dataset: 10,028 products (9,428 active, 400 draft, 200 archived) and 20,132 variants, on PostgreSQL 17.11 with a warm cache. Times differ per machine; the plan shapes and row counts are what matter.

`catalog.sql` prepares the SQL that sqlc generated, with the same `$n` parameters the API sends, and runs `EXPLAIN (ANALYZE, BUFFERS)` on each. It first sets `plan_cache_mode = force_custom_plan`, as the API's connections do (see 12 and 13). `ANALYZE` runs the query for real, `BUFFERS` shows how many 8 kB pages it touched (`shared hit` = found in memory), and `COSTS OFF` hides the planner's estimates to keep the output short.

## How to read a plan

- Read it inside out: the most indented node runs first and feeds the one above it.
- `Index Scan using X`, with an `Index Cond`, means the index finds the rows. `Seq Scan` reads the whole table. That is right for `categories` (13 rows in one page) and wrong for `products`.
- `rows=21 loops=1` is what the node really returned. `Rows Removed by Filter` counts rows it read and then threw away: the work an index did not save.
- A `Limit` directly over an index scan stops as soon as it has enough rows. That is why a page costs the same on page 1 and page 500.

## Results

| # | Request | Plan for `products` | Rows read | Time |
|---|---|---|---|---|
| 1 | `GET /v1/products` (first page) | Index Scan `products_active_newest_idx` | 21 | 0.19 ms |
| 2 | the page after the 5,000th product (its cursor) | Index Scan `products_active_newest_idx` | 21 | 0.08 ms |
| 3 | the same page with `OFFSET 5000` (not used) | Index Only Scan, `rows=5021` | 5,021 | 0.50 ms |
| 4 | `?category=pakaian` (top level, 4 category IDs) | `products_active_newest_idx` + filter | 21 + 38 removed | 0.09 ms |
| 5 | `?category=kaos` (child) | `products_active_newest_idx` + filter | 21 + 125 removed | 0.10 ms |
| 6 | an empty category, newest and `price_asc` | Index Scan `products_active_category_newest_idx` | 0 | 0.04 / 0.02 ms |
| 7 | `?sort=price_asc` | Index Scan `products_active_price_idx` | 21 | 0.28 ms |
| 8 | `?sort=price_desc` | Index Scan **Backward** `products_active_price_idx` | 21 | 0.14 ms |
| 9 | `?category=pakaian&sort=price_asc` | `products_active_price_idx` + filter | 21 + 35 removed | 0.18 ms |
| 10 | `?q=kopi arabika` | Bitmap Index Scan `products_search_idx`, then top-N sort | 365 matches, 349 active | 0.98 ms |
| 11 | `?category=pakaian&q=kaos&sort=price_asc` | `products_active_price_idx` + filter | 21 + 117 removed | 0.23 ms |
| 12 | `?q=sepatu` with a **generic** plan | `products_active_newest_idx` + filter | 9,428 removed | 7.7 ms |
| 13 | `?q=sepatu` as the API runs it (custom plan) | Bitmap Index Scan `products_search_idx` | 0 | 0.05 ms |
| 14 | `GET /v1/products/kaos-polos-hitam` | Index Scan `products_slug_key` | 1 | 0.04 ms |
| 15 | resolving `?category=pakaian` | two Seq Scans of `categories` (13 rows, 1 page) | 13 | 0.01 ms |

In every list query, the variants come from `product_variants_product_id_idx`: one index lookup per product on the page (`loops=21`) in the same statement, so there is no N+1. Each query is one round trip whatever the page size. The variants are a `LEFT JOIN`, so a product that has no sellable variant still fills its place in the page (the service then leaves it out of the response) instead of making the page end early.

### 1. The first page

```
Limit (actual time=0.017..0.026 rows=21 loops=1)
  ->  Index Scan using products_active_newest_idx on products p (actual time=0.017..0.024 rows=21 loops=1)
        Index Cond: (ROW(created_at, id) < ROW('9999-12-31 00:00:00+00'::timestamp with time zone, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
```

The partial index `(created_at DESC, id DESC) WHERE status = 'active'` is already in the order the page needs, so Postgres reads 21 entries (20 plus one to know whether there is a next page) and stops. The row comparison from the cursor is an `Index Cond`, not a filter. The first page uses a start cursor that sorts before every product, so it is the same query.

### 2 and 3. Cursor against OFFSET

The page after the 5,000th product, reached with its cursor, reads 21 rows, like page 1. The same page with `OFFSET 5000` walks 5,021 index entries and throws 5,000 away:

```
Limit (actual time=0.490..0.492 rows=21 loops=1)
  ->  Index Only Scan using products_active_newest_idx on products (actual time=0.004..0.356 rows=5021 loops=1)
```

At 10,000 products that is still under a millisecond, but it grows with the page number, while the cursor stays flat.

### 4 to 6. The category filter

The API resolves `?category=` to the IDs of the category and its children first (`ListCategoryTreeIDs`, 15), then filters with `category_id = ANY($1)`. Postgres picks the cheaper of two plans per request:

- For a category that holds a fair share of the products (here 5–20% each), it walks the newest (or price) index and skips the other categories' rows: 38 to 125 rows read for 21 returned.
- For a small or empty category, walking the newest index would read most of the catalog, so it reads `products_active_category_newest_idx` once per category ID instead (6):

```
Index Scan using products_active_category_newest_idx on products p (actual time=0.017..0.017 rows=0 loops=1)
  Index Cond: ((category_id = ANY ('{01a16299-0000-7000-8000-000000000001}'::uuid[])) AND (ROW(created_at, id) < ROW(...)))
  Buffers: shared hit=2
```

Two pages touched. With the category filter written as `category_id IN (SELECT … FROM categories …)`, as in an earlier draft of this chapter, Postgres could only run it as a filter on the newest index, so an empty category read every active product before answering with an empty page (24–38 ms at 100,000 products in the database review).

### 10. Search

```
Limit (actual time=0.787..0.789 rows=21 loops=1)
  ->  Sort (actual time=0.786..0.787 rows=21 loops=1)
        Sort Method: top-N heapsort  Memory: 32kB
        ->  Bitmap Heap Scan on products p (actual time=0.208..0.722 rows=349 loops=1)
              Recheck Cond: (search @@ '''kopi'' & ''arabika'''::tsquery)
              Rows Removed by Filter: 16
              ->  Bitmap Index Scan on products_search_idx (actual time=0.186..0.186 rows=365 loops=1)
```

The GIN index finds the products whose `search` vector has both stems, and a top-N sort keeps the newest 21. The cost grows with the number of matches, not with the catalog. A search that matches much of the catalog (the word `kaos`, 11) walks an ordered index with a filter instead, which is also cheap, because matches are everywhere. The migration keeps a larger statistics sample for `search` (`SET STATISTICS 1000`), so the planner's guess of how many products a word matches stays close, and it picks between these two plans well.

### 12 and 13. Why the API forces custom plans

The list queries have optional filters, such as `($2::text IS NULL OR p.search @@ websearch_to_tsquery('indonesian', $2))`. pgx prepares every statement, and after five executions Postgres may switch a prepared statement to a **generic plan**, one plan for every parameter value. A generic plan cannot know that `$2` is set, so it cannot use the search index:

```
Index Scan using products_active_newest_idx on products p (actual time=7.708..7.709 rows=0 loops=1)
  Index Cond: (ROW(created_at, id) < ROW($3, $4))
  Filter: ((($1 IS NULL) OR (category_id = ANY ($1))) AND (($2 IS NULL) OR (search @@ websearch_to_tsquery('indonesian'::regconfig, $2))))
  Rows Removed by Filter: 9428
```

A word that no product has makes it read all 9,428 active products: 7.7 ms here, and linear in the size of the catalog. With a custom plan (13), the same request takes the GIN index and finishes in 0.05 ms.

Plans follow the data's statistics, so they can differ from database to database: with the seed's narrow vocabulary, a search for a word no product has can still walk the newest index, while a real catalog, with its long tail of rare words, gets the GIN plan.

So `database.Open` adds `plan_cache_mode=force_custom_plan` to the connection URL (pgx sends it to Postgres as a session setting), unless `DATABASE_URL` already sets `plan_cache_mode`, and logs a warning at start when the session does not have it (behind a pooler, see [configuration](../configuration.md)). Each execution is planned with its real values, which costs about 0.1–0.5 ms of planning here, a fair price for never getting the plan above. The alternative, one query per combination of filters (3 sorts × with or without category × with or without search = 12 queries), was rejected as too much repetition for readers.

## Notes for the database review

- **Price sorts within a category** have no `(category_id, price_from, id)` index; 9 and 11 filter `products_active_price_idx` instead, cheap for the same reason as 4 and 5, and an empty category falls back to the category index (6).
- **`categories` is always read with a Seq Scan.** With 13 rows in one page, that is the fastest plan, and it is expected to stay so for a store-sized category tree.
