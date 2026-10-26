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

-- name: EventDelivered :one
-- Whether consumer has handled the event. Served by event_deliveries_pkey.
SELECT EXISTS (
    SELECT 1 FROM event_deliveries WHERE event_id = @event_id AND consumer = @consumer
) AS delivered;

-- name: MarkEventDelivered :exec
-- After the consumer's side effect; a second run of the same task finds
-- the row and does nothing.
INSERT INTO event_deliveries (event_id, consumer) VALUES (@event_id, @consumer)
ON CONFLICT (event_id, consumer) DO NOTHING;

-- name: DeletePublishedEvents :execrows
-- The cleanup (ADR 0007): up to @batch_size events published before
-- @before. The dispatcher only touches unpublished rows, so the two never
-- wait for each other. Served by outbox_events_published_idx.
DELETE FROM outbox_events
WHERE id IN (
    SELECT oe.id FROM outbox_events oe
    WHERE oe.published_at < @before::timestamptz
    ORDER BY oe.published_at
    LIMIT @batch_size);

-- name: DeleteOldDeliveries :execrows
-- Up to @batch_size delivery records older than @before: their events are
-- deleted by now. Served by event_deliveries_delivered_at_idx.
DELETE FROM event_deliveries
WHERE (event_id, consumer) IN (
    SELECT ed.event_id, ed.consumer FROM event_deliveries ed
    WHERE ed.delivered_at < @before
    ORDER BY ed.delivered_at
    LIMIT @batch_size);
