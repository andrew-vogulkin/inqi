-- Run once after `prisma migrate`. Enables extensions + realtime NOTIFY trigger.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Subject similarity (pgvector) + geo point (PostGIS) columns Prisma doesn't model.
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS geo geography(Point,4326);

-- Emit a NOTIFY whenever an outbox row is inserted -> WsGateway LISTENs.
CREATE OR REPLACE FUNCTION inqi_notify_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('inqi_events', NEW.id::text);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inqi_event_insert ON "EventOutbox";
CREATE TRIGGER inqi_event_insert AFTER INSERT ON "EventOutbox"
  FOR EACH ROW EXECUTE FUNCTION inqi_notify_event();
