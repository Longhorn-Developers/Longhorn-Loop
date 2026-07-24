-- Migration 0006: view signal + denormalized signal counters (Phase 1)
--
-- Adds event_views (deduped per user, mirroring event_rsvps) and the
-- denormalized counters that scoring reads: save_count, rsvp_count,
-- view_count. Counters are kept in sync inline by each write endpoint; this
-- migration backfills them once for rows that already have rsvp/saved data.

CREATE TABLE IF NOT EXISTS event_views (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_views_event ON event_views(event_id);

ALTER TABLE events ADD COLUMN save_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN rsvp_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

-- Backfill from existing signal rows (event_views is empty at this point).
UPDATE events SET save_count = (
  SELECT COUNT(*) FROM saved_events WHERE saved_events.event_id = events.id
);
UPDATE events SET rsvp_count = (
  SELECT COUNT(*) FROM event_rsvps WHERE event_rsvps.event_id = events.id
);
