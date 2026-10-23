-- The transactional outbox (ADR 0006).

-- name: InsertOutboxEvent :exec
-- Always inside the transaction of the change it announces.
INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
VALUES (@id, @aggregate_type, @aggregate_id, @event_type, @payload);

-- name: ClaimOutboxEvents :many
-- One batch of unpublished events, oldest first, locked for the
-- dispatcher's transaction. SKIP LOCKED lets two dispatchers run at once:
-- each takes rows the other has not, instead of waiting or publishing the
-- same event twice. Served by outbox_events_unpublished_idx.
SELECT id, aggregate_type, aggregate_id, event_type, payload, created_at
FROM outbox_events
WHERE published_at IS NULL
ORDER BY created_at, id
LIMIT @batch_size
FOR UPDATE SKIP LOCKED;

-- name: MarkOutboxEventsPublished :exec
UPDATE outbox_events SET published_at = @now::timestamptz
WHERE id = ANY(@ids::uuid[]) AND published_at IS NULL;
