-- The worker's refresh-token cleanup (ADR 0005, ADR 0007): expired tokens
-- are deleted in batches. CONCURRENTLY, because refresh_tokens can be big
-- by the time this runs in production and a plain CREATE INDEX would block
-- every login and refresh while it builds. CONCURRENTLY cannot run inside
-- a transaction, so this file holds this one statement only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
