-- Product images (ADR 0007).

-- name: LockProductForImages :one
-- An image write's first lock: the product row, so two uploads of one
-- product take turns on the 10-image limit and the next position. FOR NO
-- KEY UPDATE: nothing here changes the product's key. An admin save also
-- locks the product first, so the two queue instead of deadlocking.
SELECT id FROM products WHERE id = @id FOR NO KEY UPDATE;

-- name: CountProductImages :one
-- Pending uploads count too. Served by product_images_product_idx.
SELECT count(*) AS images, COALESCE(max(position) + 1, 0)::smallint AS next_position
FROM product_images
WHERE product_id = @product_id;

-- name: InsertProductImage :exec
INSERT INTO product_images (id, product_id, position, content_type, size_bytes, original_key)
VALUES (@id, @product_id, @position, @content_type, @size_bytes, @original_key);

-- name: GetProductImage :one
SELECT id, product_id, position, alt, status, content_type, size_bytes, original_key, width, height, created_at, updated_at
FROM product_images
WHERE id = @id AND product_id = @product_id;

-- name: ConfirmProductImage :execrows
-- Only a pending upload is confirmed; zero rows: confirmed or deleted
-- meanwhile.
UPDATE product_images
SET status = @status, alt = @alt, width = @width, height = @height, updated_at = now()
WHERE id = @id AND product_id = @product_id AND status = 'pending_upload';

-- name: DeleteProductImage :execrows
DELETE FROM product_images WHERE id = @id AND product_id = @product_id;

-- name: ListProductImages :many
-- Every image of the products, any status, in order: the storefront keeps
-- the ready ones, the admin shows all. Served by
-- product_images_product_idx.
SELECT id, product_id, position, alt, status, content_type, size_bytes, original_key, width, height, created_at, updated_at
FROM product_images
WHERE product_id = ANY(@product_ids::uuid[])
ORDER BY product_id, position, id;
