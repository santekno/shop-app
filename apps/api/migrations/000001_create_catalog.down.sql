-- Reverses 000001_create_catalog.up.sql. Dropping a table drops its indexes
-- and constraints too; the order follows the foreign keys.
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
