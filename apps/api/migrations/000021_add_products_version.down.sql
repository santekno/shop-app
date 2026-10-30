-- Reverses 000021_add_products_version.up.sql. The constraint goes with
-- the column.
ALTER TABLE products DROP COLUMN IF EXISTS version;
