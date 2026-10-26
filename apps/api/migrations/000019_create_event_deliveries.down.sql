-- Reverses 000019_create_event_deliveries.up.sql.
DROP INDEX IF EXISTS outbox_events_published_idx;
DROP TABLE IF EXISTS event_deliveries;
