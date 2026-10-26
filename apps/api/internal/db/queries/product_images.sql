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

-- name: InsertProductImage :one
-- RETURNING: the database sets the timestamps, so read them back.
INSERT INTO product_images (id, product_id, position, content_type, size_bytes, original_key)
VALUES (@id, @product_id, @position, @content_type, @size_bytes, @original_key)
RETURNING created_at, updated_at;

-- name: GetProductImage :one
SELECT id, product_id, position, alt, status, content_type, size_bytes, original_key, width, height, created_at, updated_at, variants
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
SELECT id, product_id, position, alt, status, content_type, size_bytes, original_key, width, height, created_at, updated_at, variants
FROM product_images
WHERE product_id = ANY(@product_ids::uuid[])
ORDER BY product_id, position, id;

-- name: ListProcessingImages :many
-- Confirmed images waiting for their variants, oldest first. Served by
-- product_images_processing_idx.
SELECT id, product_id, position, alt, status, content_type, size_bytes, original_key, width, height, created_at, updated_at, variants
FROM product_images
WHERE status = 'processing'
ORDER BY updated_at
LIMIT @batch_size;

-- name: FinishProductImage :execrows
-- The worker's answer: ready with its variants, or failed. Only from
-- processing, so an image deleted (or finished by another worker) since
-- it was listed is left alone.
UPDATE product_images SET status = @status, variants = @variants, updated_at = now()
WHERE id = @id AND status = 'processing';

-- name: DeleteStalePendingImages :many
-- The worker's cleanup (ADR 0007): uploads signed before @before and never
-- confirmed. Their URLs expired long ago. The rows go first, so a confirm
-- racing the cleanup either wins (the row is no longer pending) or finds
-- no image; the caller then deletes the returned keys' files. Served by
-- product_images_pending_idx.
DELETE FROM product_images
WHERE id IN (
    SELECT pi.id FROM product_images pi
    WHERE pi.status = 'pending_upload' AND pi.created_at < @before
    ORDER BY pi.created_at
    LIMIT @batch_size
    FOR UPDATE SKIP LOCKED)
RETURNING original_key;
