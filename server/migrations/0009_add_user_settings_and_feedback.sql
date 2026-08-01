-- Migration 0009: user settings + feedback (LOOP-184)
--
-- One settings row per user, created lazily on first write. A user who has
-- never opened Settings has no row, and the GET endpoint returns the defaults
-- below rather than writing on a read.
--
-- Notification columns overlap with LOOP-125 (Notification preferences) on
-- purpose: that ticket owns the *semantics* of when each notification fires,
-- this owns the storage and the Settings UI. Whoever lands LOOP-125 should
-- read these columns rather than adding a parallel table.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Preferences
  dark_mode INTEGER NOT NULL DEFAULT 0,

  -- Notifications: from-activity toggles
  event_reminders     INTEGER NOT NULL DEFAULT 1,
  new_events          INTEGER NOT NULL DEFAULT 1,
  weekly_digest       INTEGER NOT NULL DEFAULT 0,
  rsvp_confirmations  INTEGER NOT NULL DEFAULT 1,

  -- How long before an event a reminder fires. Stored in minutes rather than
  -- a label so the reminder cron can do arithmetic without parsing strings;
  -- the UI maps these to "1 hour before" / "1 day before" etc.
  reminder_lead_minutes INTEGER NOT NULL DEFAULT 1440,

  -- Delivery channels
  channel_push   INTEGER NOT NULL DEFAULT 1,
  channel_email  INTEGER NOT NULL DEFAULT 0,
  channel_in_app INTEGER NOT NULL DEFAULT 1,

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Feedback submissions from the Settings feedback form ("Let us know your
-- thoughts") and Report a Bug.
--
-- user_id is nullable and ON DELETE SET NULL: deleting an account must not
-- delete the feedback, or a bug report vanishes the moment the reporter
-- leaves -- exactly when the team still needs it.
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT    NOT NULL DEFAULT 'feedback'
             CHECK(kind IN ('feedback', 'bug', 'support')),
  message    TEXT    NOT NULL,
  -- Free-form client context (app version, platform) for triage.
  context    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
