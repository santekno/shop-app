-- Resized photos (ADR 0007): confirm hands the original to the worker
-- (processing), which writes JPEG variants 400 and 800 pixels wide and
-- puts the image on the storefront (ready), or gives up on a file that
-- does not decode (failed).
--
-- In this order: the new statuses and the variants column first, then the
-- images that were ready without variants go to processing, and only then
-- the CHECK that a ready image has variants, which those rows would break.
ALTER TABLE product_images
    DROP CONSTRAINT product_images_status_check,
    ADD CONSTRAINT product_images_status_check
        CHECK (status IN ('pending_upload', 'processing', 'ready', 'failed')),
    -- [{"width": 400, "height": 300, "key": "products/…/400.jpg"}, …],
    -- narrowest first. Written once by the worker and always read whole,
    -- so a JSON array rather than a table.
    ADD COLUMN variants jsonb NOT NULL DEFAULT '[]',
    ADD CONSTRAINT product_images_variants_check CHECK (jsonb_typeof(variants) = 'array');

-- Images were ready without variants before this migration: hand them to
-- the worker.
UPDATE product_images SET status = 'processing' WHERE status = 'ready';

-- What the storefront shows has variants.
ALTER TABLE product_images
    ADD CONSTRAINT product_images_ready_check CHECK (status <> 'ready' OR jsonb_array_length(variants) > 0);

-- The worker's queue: confirmed images waiting for their variants.
CREATE INDEX product_images_processing_idx ON product_images (updated_at)
    WHERE status = 'processing';
