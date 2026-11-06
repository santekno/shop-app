-- Reverses 000022_create_banners_and_featured_products.up.sql.
DROP TABLE IF EXISTS banners;
DROP INDEX IF EXISTS products_active_featured_newest_idx;
ALTER TABLE products DROP COLUMN IF EXISTS is_featured;
