-- Reverses 000018_index_refresh_tokens_expires_at.up.sql.
DROP INDEX CONCURRENTLY IF EXISTS refresh_tokens_expires_at_idx;
