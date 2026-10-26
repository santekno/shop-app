-- Outbox consumers (ADR 0007). Delivery is at least once: an event can be
-- published twice (the dispatcher died between the enqueue and its
-- commit) and a task can run twice (a worker died before Asynq heard it
-- finished). Each consumer records here what it has done, and skips an
-- event it finds, so the buyer does not get the same email twice.
CREATE TABLE event_deliveries (
    -- outbox_events.id. No foreign key: published events are deleted
    -- after 7 days, and so are these rows.
    event_id     uuid        NOT NULL,
    -- The task type that handled it, e.g. email:payment-received.
    consumer     text        NOT NULL,
    delivered_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT event_deliveries_pkey PRIMARY KEY (event_id, consumer)
);

-- The cleanup of old deliveries.
CREATE INDEX event_deliveries_delivered_at_idx ON event_deliveries (delivered_at);

-- The cleanup of published events (the Bab 5 deferred item): partial, so
-- it holds published rows only, which the dispatcher's index does not.
CREATE INDEX outbox_events_published_idx ON outbox_events (published_at)
    WHERE published_at IS NOT NULL;
