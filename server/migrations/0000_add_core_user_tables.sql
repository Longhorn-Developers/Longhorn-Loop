-- Migration 0000: users, their onboarding rows, and saved_events (LOOP-239)
--
-- These five tables predate the migrations directory. schema.sql was applied
-- by hand to the databases that existed at the time, and when migrations
-- started at 0001 (events + organizations) nobody went back and captured what
-- was already there. So the migration sequence has never actually built a
-- working database from empty: it references `users` and `saved_events`
-- without ever creating them.
--
-- That is not theoretical. On a fresh D1, applying 0001..0013 in order fails
-- twice:
--   0006 -- backfills save_count with "SELECT COUNT(*) FROM saved_events" and
--           dies on "no such table: saved_events". Wrangler stops at the
--           failing statement and never records 0006 as applied, which is why
--           the org console 500s on events.view_count for anyone who set up
--           locally from migrations -- the ALTERs in that file are rolled back
--           with it.
--   0007 -- "ALTER TABLE users ADD COLUMN bio" dies on "no such table: users".
--
-- Numbered 0000 rather than 0016 because both of those failures are ordering
-- failures: the tables have to exist BEFORE the migrations that alter and read
-- them. Wrangler applies unapplied migrations in numeric order, so 0000 runs
-- first on any database that does not have it yet. On databases that already
-- have these tables (prod, and every local built from schema.sql) every
-- statement here is CREATE TABLE IF NOT EXISTS and does nothing.
--
-- Two columns are deliberately absent, because later migrations add them and
-- ADD COLUMN has no IF NOT EXISTS to protect it:
--   users.bio                    -- added by 0007
--   saved_events.reminder_sent_at -- added by 0015
-- Creating them here would make those two migrations fail with "duplicate
-- column name" on every fresh database. This file describes the schema as it
-- stood before 0001, not as it stands today; the end state is what
-- test/test_schema_migration_parity.ts compares against schema.sql.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  avatar INTEGER,
  year_classification TEXT,
  unique_classification TEXT,
  agreed_responsible_use INTEGER NOT NULL DEFAULT 0,
  agreed_visibility_acknowledgment INTEGER NOT NULL DEFAULT 0,
  agreed_community_guidelines INTEGER NOT NULL DEFAULT 0,
  notifications_enabled INTEGER NOT NULL DEFAULT 0,
  terms_accepted_at TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multiple majors per user, so a row each rather than a column on users.
CREATE TABLE IF NOT EXISTS user_majors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  major TEXT NOT NULL,
  UNIQUE(user_id, major)
);

-- Interest tags picked during onboarding. Distinct from event_tags (0005),
-- which the classifier writes; these are the user's own answers.
CREATE TABLE IF NOT EXISTS user_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  UNIQUE(user_id, tag)
);

-- Email verification codes -- replaced the in-memory authStore.
CREATE TABLE IF NOT EXISTS verification_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL
);

-- Bookmarks. Drives the home screen bookmark icon, save_count, and the
-- reminder cron. The events FK points at a table 0001 creates a moment later;
-- SQLite resolves foreign keys lazily, so declaring it here is fine.
CREATE TABLE IF NOT EXISTS saved_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, event_id)
);
