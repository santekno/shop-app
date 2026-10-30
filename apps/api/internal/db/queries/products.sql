-- Storefront reads. Every read returns the same columns, one row per
-- sellable variant, so the repository turns all of them into products with
-- one function (and Go can convert one generated row type into another).
-- Archived variants are joined away; an active product always has at least
-- one sellable variant (products_active_price_check, with UpdateProduct
-- recomputing price_from in the same transaction), so an inner join never
-- drops one. Variants with the same price keep the admin's order (position).

-- The three list queries differ only in their sort, and so in their cursor
-- condition and ORDER BY: one fixed query per sort, never SQL built from
-- the request. Each is a page of active products with their sellable
-- variants in the same query (no N+1); the page CTE picks the products, so
-- LIMIT counts products, not variant rows. The page starts just after the
-- cursor; the row comparison (a, b) < (x, y) matches the index on (a, b),
-- so Postgres jumps straight to it.
--
-- The filters are the same in all three. category_ids NULL means every
-- category; otherwise it holds the IDs of a category and its children
-- (ListCategoryTreeIDs), matched with = ANY, so Postgres can also read
-- products_active_category_newest_idx once per category. search NULL means
-- no search; otherwise full-text search on the generated column (name
-- weighted above description) with the GIN index products_search_idx.
-- websearch_to_tsquery accepts what people type (words, "quoted phrases",
-- -excluded, or) and never fails on syntax.

-- name: ListProductsNewest :many
-- sort=newest, served by products_active_newest_idx (or
-- products_active_category_newest_idx with a category).
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at, p.updated_at
    FROM products p
    WHERE p.status = 'active'
      AND (sqlc.narg('category_ids')::uuid[] IS NULL
           OR p.category_id = ANY(sqlc.narg('category_ids')::uuid[]))
      AND (sqlc.narg('search')::text IS NULL
           OR p.search @@ websearch_to_tsquery('indonesian', sqlc.narg('search')))
      AND (p.created_at, p.id) < (@cursor_created_at::timestamptz, @cursor_id::uuid)
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT @page_size
)
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at, page.updated_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.created_at DESC, page.id DESC, v.price, v.position, v.id;

-- name: ListProductsPriceAsc :many
-- sort=price_asc, served by products_active_price_idx.
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at, p.updated_at
    FROM products p
    WHERE p.status = 'active'
      AND (sqlc.narg('category_ids')::uuid[] IS NULL
           OR p.category_id = ANY(sqlc.narg('category_ids')::uuid[]))
      AND (sqlc.narg('search')::text IS NULL
           OR p.search @@ websearch_to_tsquery('indonesian', sqlc.narg('search')))
      AND (p.price_from, p.id) > (@cursor_price::bigint, @cursor_id::uuid)
    ORDER BY p.price_from, p.id
    LIMIT @page_size
)
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at, page.updated_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.price_from, page.id, v.price, v.position, v.id;

-- name: ListProductsPriceDesc :many
-- sort=price_desc, served by products_active_price_idx scanned backwards.
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at, p.updated_at
    FROM products p
    WHERE p.status = 'active'
      AND (sqlc.narg('category_ids')::uuid[] IS NULL
           OR p.category_id = ANY(sqlc.narg('category_ids')::uuid[]))
      AND (sqlc.narg('search')::text IS NULL
           OR p.search @@ websearch_to_tsquery('indonesian', sqlc.narg('search')))
      AND (p.price_from, p.id) < (@cursor_price::bigint, @cursor_id::uuid)
    ORDER BY p.price_from DESC, p.id DESC
    LIMIT @page_size
)
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at, page.updated_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.price_from DESC, page.id DESC, v.price, v.position, v.id;

-- name: GetActiveProductBySlug :many
-- One active product with its sellable variants, cheapest first. No rows
-- means there is no active product with that slug.
SELECT p.id, p.slug, p.name, p.description, p.price_from, p.created_at, p.updated_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM products p
JOIN categories c ON c.id = p.category_id
JOIN product_variants v ON v.product_id = p.id AND v.archived_at IS NULL
WHERE p.slug = @slug AND p.status = 'active'
ORDER BY v.price, v.position, v.id;

-- Admin reads and writes (sellers and admins only, from Bab 4).

-- name: GetProduct :one
-- Any product, whatever its status.
SELECT id, category_id, slug, name, description, status, price_from, created_at, updated_at
FROM products
WHERE id = @id;

-- name: LockProduct :one
-- Locks the product row for the rest of the transaction, so two admin saves
-- of the same product run one after the other and price_from stays right.
SELECT id
FROM products
WHERE id = @id
FOR UPDATE;

-- name: LockProductVariants :exec
-- An admin save's second lock, right after LockProduct: every variant of
-- the product, archived ones too, in id order, the order checkout, cancel
-- and expiry lock variants in (ADR 0006, "Lock order"). The save then
-- writes them in the form's order without taking a lock out of turn: two
-- transactions locking the same variants in opposite orders deadlock.
-- FOR UPDATE, not FOR NO KEY UPDATE: a save may change a SKU, a unique key,
-- and that update needs the strongest lock; taking it now, in id order,
-- means it is never upgraded later, out of turn, while a cart merge holds
-- FOR KEY SHARE on the same variants. Served by
-- product_variants_product_id_idx.
SELECT id FROM product_variants
WHERE product_id = @product_id
ORDER BY id
FOR UPDATE;

-- name: ListSellableVariants :many
-- version goes to the admin form and comes back with the save (the
-- optimistic check in UpdateVariant).
SELECT id, sku, name, price, stock, weight_grams, version
FROM product_variants
WHERE product_id = @product_id AND archived_at IS NULL
ORDER BY price, position, id;

-- name: InsertProduct :exec
-- A new product starts as a draft without a price: its variants do not exist
-- yet. UpdateProduct then sets the real status and price_from in the same
-- transaction, once the variants are in.
INSERT INTO products (id, category_id, slug, name, description, status, price_from)
VALUES (@id, @category_id, @slug, @name, @description, 'draft', NULL);

-- name: UpdateProduct :execrows
-- Writes the product's fields and recomputes price_from from its sellable
-- variants in the same statement, so the price_from CHECK sees the final
-- status and price together. Every product write ends with this query.
UPDATE products
SET category_id = @category_id,
    slug        = @slug,
    name        = @name,
    description = @description,
    status      = @status,
    price_from  = (SELECT min(v.price) FROM product_variants v
                   WHERE v.product_id = products.id AND v.archived_at IS NULL),
    updated_at  = now()
WHERE products.id = @id;

-- name: InsertVariant :exec
INSERT INTO product_variants (id, product_id, sku, name, price, stock, weight_grams, position)
VALUES (@id, @product_id, @sku, @name, @price, @stock, @weight_grams, @position);

-- name: UpdateVariant :execrows
-- Optimistic locking (ADR 0006): the admin's form sends back the version it
-- was loaded with, and the row changes only if nobody (a checkout taking
-- stock, another admin) changed it since. Every change bumps version. Zero
-- rows: a version conflict, or not a sellable variant of this product
-- (GetVariantVersion tells which).
UPDATE product_variants
SET sku          = @sku,
    name         = @name,
    price        = @price,
    stock        = @stock,
    weight_grams = @weight_grams,
    position     = @position,
    version      = version + 1,
    updated_at   = now()
WHERE id = @id AND product_id = @product_id AND archived_at IS NULL
  AND version = @version;

-- name: GetVariantVersion :one
-- After UpdateVariant changed nothing: a row here means the version was
-- stale (409 VERSION_CONFLICT); no row, that the id is not a sellable
-- variant of the product.
SELECT version FROM product_variants
WHERE id = @id AND product_id = @product_id AND archived_at IS NULL;

-- Soft delete: products and variants are archived, never deleted, because
-- order items (Bab 5) point to them. updated_at is set by every UPDATE in
-- this file, not by a trigger, so each write shows it.

-- name: ArchiveProduct :execrows
-- Takes the product off the storefront. Archiving it again changes nothing
-- but updated_at. Zero rows: there is no such product.
UPDATE products
SET status = 'archived', updated_at = now()
WHERE id = @id;

-- name: ArchiveVariantsNotIn :exec
-- Archives every sellable variant of the product whose id is not in
-- keep_ids: they leave the storefront, price_from and in_stock, while their
-- rows, SKUs and stock stay for order history. An empty keep_ids archives
-- them all. Run UpdateProduct afterwards in the same transaction to
-- recompute price_from.
UPDATE product_variants
SET archived_at = now(), updated_at = now()
WHERE product_id = @product_id
  AND archived_at IS NULL
  AND id <> ALL(@keep_ids::uuid[]);

-- The admin's product table (Bab 12): every status, offset pages, any
-- column sort. Offset rather than the storefront's cursor, because a data
-- table jumps to page N and shows "page 3 of 12", which needs the total.
-- Both queries share one filter, written out twice so each stays plain
-- SQL; a change to one must be made to the other.
--
-- Filters: status NULL means any status; category_id NULL means every
-- category, otherwise the category and its children; search NULL means no
-- search, otherwise an ILIKE pattern (the caller escapes % _ \) matched
-- against the name and every variant's SKU, archived variants included,
-- because a SKU on an old packing slip still names its product;
-- low_stock_only keeps products with a sellable variant whose stock is at
-- or below low_stock_threshold.
--
-- The sort is a fixed set of CASE expressions chosen by @sort and
-- @descending, never SQL built from the request. No index can serve them
-- (stock is a sum over the variants), and none needs to: the total has to
-- count every matching product anyway, and an admin catalog is small. The
-- id tie-break, in the same direction, keeps a page stable when values tie.

-- name: CountAdminProducts :one
SELECT count(*)
FROM products p
CROSS JOIN LATERAL (
    SELECT bool_or(v.stock <= @low_stock_threshold::int) AS low_stock
    FROM product_variants v
    WHERE v.product_id = p.id AND v.archived_at IS NULL
) s
WHERE (sqlc.narg('status')::text IS NULL OR p.status = sqlc.narg('status')::text)
  AND (sqlc.narg('category_id')::uuid IS NULL
       OR p.category_id = sqlc.narg('category_id')::uuid
       OR p.category_id IN (SELECT c.id FROM categories c WHERE c.parent_id = sqlc.narg('category_id')::uuid))
  AND (sqlc.narg('search')::text IS NULL
       OR p.name ILIKE sqlc.narg('search')::text
       OR EXISTS (SELECT 1 FROM product_variants sv
                  WHERE sv.product_id = p.id AND sv.sku ILIKE sqlc.narg('search')::text))
  AND (NOT @low_stock_only::boolean OR COALESCE(s.low_stock, false));

-- name: ListAdminProducts :many
-- One row per product with its category and its sellable variants' totals
-- (a product with none has stock 0, variant_count 0, low_stock false).
SELECT p.id, p.slug, p.name, p.status, p.price_from, p.created_at, p.updated_at,
       c.id AS category_id, c.name AS category_name,
       s.stock, s.variant_count, s.low_stock
FROM products p
JOIN categories c ON c.id = p.category_id
CROSS JOIN LATERAL (
    SELECT COALESCE(sum(v.stock), 0)::bigint AS stock,
           count(*)::int AS variant_count,
           COALESCE(bool_or(v.stock <= @low_stock_threshold::int), false)::boolean AS low_stock
    FROM product_variants v
    WHERE v.product_id = p.id AND v.archived_at IS NULL
) s
WHERE (sqlc.narg('status')::text IS NULL OR p.status = sqlc.narg('status')::text)
  AND (sqlc.narg('category_id')::uuid IS NULL
       OR p.category_id = sqlc.narg('category_id')::uuid
       OR p.category_id IN (SELECT c2.id FROM categories c2 WHERE c2.parent_id = sqlc.narg('category_id')::uuid))
  AND (sqlc.narg('search')::text IS NULL
       OR p.name ILIKE sqlc.narg('search')::text
       OR EXISTS (SELECT 1 FROM product_variants sv
                  WHERE sv.product_id = p.id AND sv.sku ILIKE sqlc.narg('search')::text))
  AND (NOT @low_stock_only::boolean OR s.low_stock)
ORDER BY
    CASE WHEN @sort::text = 'name' AND NOT @descending::boolean THEN p.name END ASC,
    CASE WHEN @sort::text = 'name' AND @descending::boolean THEN p.name END DESC,
    -- A draft without a sellable variant has no price: last either way.
    CASE WHEN @sort::text = 'price_from' AND NOT @descending::boolean THEN p.price_from END ASC NULLS LAST,
    CASE WHEN @sort::text = 'price_from' AND @descending::boolean THEN p.price_from END DESC NULLS LAST,
    CASE WHEN @sort::text = 'stock' AND NOT @descending::boolean THEN s.stock END ASC,
    CASE WHEN @sort::text = 'stock' AND @descending::boolean THEN s.stock END DESC,
    CASE WHEN @sort::text = 'updated_at' AND NOT @descending::boolean THEN p.updated_at END ASC,
    CASE WHEN @sort::text = 'updated_at' AND @descending::boolean THEN p.updated_at END DESC,
    CASE WHEN @sort::text = 'created_at' AND NOT @descending::boolean THEN p.created_at END ASC,
    CASE WHEN @sort::text = 'created_at' AND @descending::boolean THEN p.created_at END DESC,
    CASE WHEN NOT @descending::boolean THEN p.id END ASC,
    CASE WHEN @descending::boolean THEN p.id END DESC
LIMIT @page_size OFFSET @page_offset;
