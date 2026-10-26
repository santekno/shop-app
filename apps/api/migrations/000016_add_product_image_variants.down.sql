-- Reverses 000016_add_product_image_variants.up.sql. A processing or ready
-- image was confirmed, so it is ready again (its variants are forgotten;
-- the files stay). A failed image never decoded: it goes back to
-- pending_upload, which the storefront never shows and which a confirm
-- would refuse again, rather than onto the storefront as ready. It keeps
-- its width and height (product_images_confirmed_check allows that for a
-- pending row), and the worker's hourly cleanup deletes it, with its file,
-- once it is a day old, like any upload that was never confirmed.
DROP INDEX IF EXISTS product_images_processing_idx;
ALTER TABLE product_images
    DROP CONSTRAINT IF EXISTS product_images_ready_check,
    DROP CONSTRAINT IF EXISTS product_images_variants_check,
    DROP COLUMN IF EXISTS variants,
    DROP CONSTRAINT product_images_status_check;
UPDATE product_images SET status = 'ready' WHERE status = 'processing';
UPDATE product_images SET status = 'pending_upload' WHERE status = 'failed';
ALTER TABLE product_images
    ADD CONSTRAINT product_images_status_check CHECK (status IN ('pending_upload', 'ready'));
