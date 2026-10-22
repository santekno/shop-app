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
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at
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
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.created_at DESC, page.id DESC, v.price, v.position, v.id;

-- name: ListProductsPriceAsc :many
-- sort=price_asc, served by products_active_price_idx.
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at
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
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.price_from, page.id, v.price, v.position, v.id;

-- name: ListProductsPriceDesc :many
-- sort=price_desc, served by products_active_price_idx scanned backwards.
WITH page AS (
    SELECT p.id, p.category_id, p.slug, p.name, p.description, p.price_from, p.created_at
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
SELECT page.id, page.slug, page.name, page.description, page.price_from, page.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM page
JOIN categories c ON c.id = page.category_id
JOIN product_variants v ON v.product_id = page.id AND v.archived_at IS NULL
ORDER BY page.price_from DESC, page.id DESC, v.price, v.position, v.id;

-- name: GetActiveProductBySlug :many
-- One active product with its sellable variants, cheapest first. No rows
-- means there is no active product with that slug.
SELECT p.id, p.slug, p.name, p.description, p.price_from, p.created_at,
       c.id AS category_id, c.slug AS category_slug, c.name AS category_name, c.parent_id AS category_parent_id,
       v.id AS variant_id, v.sku AS variant_sku, v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock
FROM products p
JOIN categories c ON c.id = p.category_id
JOIN product_variants v ON v.product_id = p.id AND v.archived_at IS NULL
WHERE p.slug = @slug AND p.status = 'active'
ORDER BY v.price, v.position, v.id;

-- Admin reads and writes (development only until Bab 4 adds auth).

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

-- name: ListSellableVariants :many
SELECT id, sku, name, price, stock, weight_grams
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
-- Every change to a variant bumps version, so the optimistic stock check in
-- Bab 5 notices it. Zero rows: the variant is not a sellable variant of this
-- product.
UPDATE product_variants
SET sku          = @sku,
    name         = @name,
    price        = @price,
    stock        = @stock,
    weight_grams = @weight_grams,
    position     = @position,
    version      = version + 1,
    updated_at   = now()
WHERE id = @id AND product_id = @product_id AND archived_at IS NULL;
