-- One-off production repair, 18 Aug 2026.
--
-- WHY THIS FILE EXISTS
--
-- The production D1 was built by running schema.sql directly rather than by
-- applying migrations, so `d1_migrations` never recorded anything and
-- `wrangler d1 migrations list --remote` reports six migrations as pending.
-- Most of those are already present in the database; two are genuinely
-- missing. Running `migrations apply --remote` blind would therefore fail
-- partway through on a live database — `0013` would die with
-- `duplicate column name: category` before `0016` ever ran.
--
-- Verified against production before writing this, not assumed:
--
--   0000 core tables                    PRESENT
--   0013 organizations.category         MISSING  <- applied here
--   0014 notifications                  PRESENT
--   0015 saved_events.reminder_sent_at  PRESENT
--   0016 user_blocks + organizations.bio  BOTH MISSING  <- applied here
--   0017 followed_org_notification_settings  MISSING  <- applied here
--
-- The two missing tables were a live bug, not housekeeping. Every read path
-- that joins user_blocks — /users/me, /feed/home, /saved, event detail —
-- returns 500 in production without it. That is the whole app after login.
-- It went unnoticed because production had three users, none of them looking.
--
-- Safe to run more than once: the CREATEs are guarded. The two ALTERs are NOT
-- (SQLite has no ADD COLUMN IF NOT EXISTS) and will error with
-- "duplicate column name" on a second run. That error is harmless — it means
-- the column already exists — but it is why this file is not idempotent and
-- should be deleted once applied.

-- 0016: blocking. Safety feature, so a missing table is a real-world harm:
-- every "blocked" relationship silently fails to exist.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_user_id);

-- 0017: per-user notification preferences for orgs they follow.
CREATE TABLE IF NOT EXISTS followed_org_notification_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  paused               INTEGER NOT NULL DEFAULT 0,
  new_event_posts      INTEGER NOT NULL DEFAULT 1,
  event_detail_changes INTEGER NOT NULL DEFAULT 1,
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 0013 and 0016: columns on organizations. Both confirmed absent via
-- PRAGMA table_info(organizations) before writing this.
ALTER TABLE organizations ADD COLUMN category TEXT;
ALTER TABLE organizations ADD COLUMN bio TEXT;

-- Record all six as applied so the migration ledger matches reality and the
-- next `migrations apply` does not try to re-run them against a database that
-- already has their contents. INSERT OR IGNORE so this line is safe to repeat.
INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES
  ('0000_add_core_user_tables.sql', datetime('now')),
  ('0013_add_org_category.sql', datetime('now')),
  ('0014_add_notifications.sql', datetime('now')),
  ('0015_add_saved_events_reminder_sent_at.sql', datetime('now')),
  ('0016_add_user_blocks_and_org_bio.sql', datetime('now')),
  ('0017_add_followed_org_notification_settings.sql', datetime('now'));
