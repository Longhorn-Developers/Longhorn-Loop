-- Migration 0003: add event_reports table (moderation reporting, merged from upstream PR #271)

CREATE TABLE IF NOT EXISTS event_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reasons TEXT NOT NULL,        -- JSON array of reason codes
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, event_id)     -- one report per user per event
);

CREATE INDEX IF NOT EXISTS idx_event_reports_event ON event_reports(event_id);
