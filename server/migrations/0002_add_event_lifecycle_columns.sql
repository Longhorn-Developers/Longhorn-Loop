-- Migration 0002: add event lifecycle columns (expiry, featured, user-created, archiving)

ALTER TABLE events ADD COLUMN expires_at TEXT;
ALTER TABLE events ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN created_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE events ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN archived_at TEXT;

-- Backfill expires_at for existing rows: end_datetime + 7 days, falling back
-- to start_datetime + 7 days when end_datetime is NULL.
UPDATE events
SET expires_at = datetime(COALESCE(end_datetime, start_datetime), '+7 days')
WHERE expires_at IS NULL;

-- is_archived already defaults to 0 and archived_at stays NULL for existing
-- rows via the ALTER TABLE defaults above -- no backfill needed for those.

-- Cleanup job (LOOP-150) and past-events view (LOOP-200) both filter on these
CREATE INDEX IF NOT EXISTS idx_events_is_archived ON events(is_archived);
CREATE INDEX IF NOT EXISTS idx_events_created_by_user_id ON events(created_by_user_id);
