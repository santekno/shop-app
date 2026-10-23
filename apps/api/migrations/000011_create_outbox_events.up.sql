-- The transactional outbox (ADR 0006). Every order status change inserts
-- its event here in the same transaction as the change, so an event exists
-- exactly when its change committed. A dispatcher publishes the rows later
-- and sets published_at; delivery is at least once.

CREATE TABLE outbox_events (
    id             uuid        PRIMARY KEY,
    aggregate_type text        NOT NULL,
    -- The order's id. No foreign key: the outbox serves any aggregate, and
    -- orders are never deleted.
    aggregate_id   uuid        NOT NULL,
    event_type     text        NOT NULL,
    payload        jsonb       NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz,

    CONSTRAINT outbox_events_aggregate_type_check CHECK (aggregate_type IN ('order')),
    CONSTRAINT outbox_events_event_type_check CHECK (event_type IN (
        'order.created', 'order.paid', 'order.processing', 'order.shipped', 'order.completed', 'order.cancelled'))
);

-- The dispatcher's queue: the unpublished events, oldest first. Partial,
-- so it stays as small as the backlog however long the table grows.
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at, id)
    WHERE published_at IS NULL;
