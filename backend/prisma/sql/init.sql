-- Run once after `prisma migrate`. Enables extensions + realtime NOTIFY trigger.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Subject similarity (pgvector) + geo point (PostGIS) columns Prisma doesn't model.
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS geo geography(Point,4326);

-- subject_build domain memory (also modelled in schema.prisma; created here so
-- live DBs never need `prisma db push`, which would drop the embedding column).
CREATE TABLE IF NOT EXISTS "DomainKnowledge" (
  "id"         TEXT PRIMARY KEY,
  "domain"     TEXT NOT NULL UNIQUE,
  "category"   TEXT,
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "sources"    JSONB NOT NULL DEFAULT '[]',
  "titleHints" JSONB NOT NULL DEFAULT '[]',
  "buildCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Emit a NOTIFY whenever an outbox row is inserted -> WsGateway LISTENs.
CREATE OR REPLACE FUNCTION inqi_notify_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('inqi_events', NEW.id::text);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inqi_event_insert ON "EventOutbox";
CREATE TRIGGER inqi_event_insert AFTER INSERT ON "EventOutbox"
  FOR EACH ROW EXECUTE FUNCTION inqi_notify_event();
