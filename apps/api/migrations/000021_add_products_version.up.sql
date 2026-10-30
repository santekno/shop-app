-- The product's own optimistic lock (Bab 12): the version of its fields
-- (name, slug, description, status, category) and of its set of sellable
-- variants. Every admin write of the product bumps it: a save (PUT, which
-- may also archive variants or add new ones) and an archive (DELETE). A
-- save must send back the version it loaded, so an admin's stale form can
-- no longer overwrite another admin's name, or archive the variant another
-- admin just added.
--
-- Stock does not move it: a checkout, a cancel and a stock adjustment
-- change one variant and bump that variant's version (000001), which is
-- where a form finds out about them. Photos do not move it either; they
-- are not part of the save.
--
-- Backfill: the constant default fills every existing product with 0 in
-- the same statement (PostgreSQL 11+ stores it once, without rewriting the
-- table), so forms that load a product after this migration send 0.
ALTER TABLE products
    ADD COLUMN version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT products_version_check CHECK (version >= 0);
