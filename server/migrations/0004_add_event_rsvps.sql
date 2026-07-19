-- Migration 0004: add event_rsvps table (LOOP-211)
-- Backs the POST /events/:id/rsvp and DELETE /events/:id/rsvp endpoints.

CREATE TABLE IF NOT EXISTS event_rsvps (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id);
