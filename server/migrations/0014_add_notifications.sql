-- Migration 0014: add the notifications table (LOOP-239)
--
-- This table has existed in schema.sql since the activity center shipped, but
-- no migration ever created it. Anyone whose D1 was built by applying
-- migrations in order -- a fresh preview database, a new contributor's local,
-- a rebuilt prod -- has a Worker that 500s on every /notifications route and a
-- reminder cron ("*/15 * * * *", sendEventReminders in src/worker.ts) that
-- throws on its INSERT every tick. Nothing surfaces that except Worker logs,
-- which is why it survived this long.
--
-- Numbered 0014 rather than the 0012 the ticket asks for: 0012 and 0013 were
-- taken by event_tag source/score and org category before this landed.
--
-- The DDL is copied field for field from the notifications block in
-- schema.sql. The two files are meant to describe the same database, and
-- test/test_schema_migration_parity.ts now fails the build if they stop
-- agreeing.

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  subtitle TEXT,
  avatar_url TEXT,
  thumbnail_url TEXT,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Composite rather than a plain user_id index because the only read this table
-- has is the activity center's "WHERE user_id = ? ORDER BY created_at DESC" --
-- the second column keeps that off a sort of every notification a user has
-- ever received. Added to schema.sql in the same commit so the two match.
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
