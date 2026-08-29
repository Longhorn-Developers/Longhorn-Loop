-- Migration 0020: announcements posted by an event's host.
--
-- "Post Announcement" on the Manage Event sheet. The host writes one short
-- update ("room change, doors open at 5:45") and everyone attached to the
-- event hears about it.
--
-- Stored rather than fired-and-forgotten, for two reasons: someone who RSVPs
-- tomorrow should still see that the room changed, and a notification the user
-- has already swiped away should not be the only record that the host said
-- anything.

CREATE TABLE IF NOT EXISTS event_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- Who wrote it. Kept even if the announcement outlives their membership of
  -- the hosting org, which is why this is a plain reference and not a join.
  author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  -- Whether the host asked for this to reach people rather than just sit on
  -- the event page. Today that means rows in `notifications`; when push
  -- delivery exists it reads the same flag.
  notify INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The only read is "every announcement for this event, newest first".
CREATE INDEX IF NOT EXISTS idx_event_announcements_event
  ON event_announcements(event_id, created_at DESC);
