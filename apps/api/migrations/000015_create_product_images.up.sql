-- Product photos (ADR 0007). The file itself is in S3 under original_key;
-- the seller uploads it there directly with a presigned URL, and this row
-- holds what was declared (type, size) until confirm checks what arrived.

CREATE TABLE product_images (
    id           uuid        PRIMARY KEY,
    product_id   uuid        NOT NULL,
    -- The storefront's order of a product's photos; the first is the
    -- product's main photo.
    position     smallint    NOT NULL,
    alt          text        NOT NULL DEFAULT '',
    -- pending_upload: signed, not confirmed yet; ready: on the storefront.
    status       text        NOT NULL DEFAULT 'pending_upload',
    content_type text        NOT NULL,
    size_bytes   integer     NOT NULL,
    original_key text        NOT NULL,
    -- The original's pixels, known once confirm has read its header.
    width        integer,
    height       integer,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    -- Products are archived, never deleted.
    CONSTRAINT product_images_product_fkey FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT product_images_original_key_key UNIQUE (original_key),
    CONSTRAINT product_images_status_check CHECK (status IN ('pending_upload', 'ready')),
    CONSTRAINT product_images_content_type_check
        CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    -- At most 5 MiB.
    CONSTRAINT product_images_size_check CHECK (size_bytes BETWEEN 1 AND 5242880),
    CONSTRAINT product_images_position_check CHECK (position >= 0),
    CONSTRAINT product_images_alt_check CHECK (char_length(alt) <= 200),
    CONSTRAINT product_images_dimensions_check CHECK (
        (width IS NULL) = (height IS NULL) AND (width IS NULL OR (width > 0 AND height > 0))),
    -- A confirmed image has been looked at.
    CONSTRAINT product_images_confirmed_check CHECK (status = 'pending_upload' OR width IS NOT NULL)
);

-- A product's photos in order (the storefront and the admin), the count
-- under the 10-per-product limit, and the RESTRICT on products.
CREATE INDEX product_images_product_idx ON product_images (product_id, position, id);

-- Uploads that were signed but never confirmed, for the cleanup job.
CREATE INDEX product_images_pending_idx ON product_images (created_at)
    WHERE status = 'pending_upload';
