-- Migration 0017: notification toggles for the orgs a user follows (LOOP-180,
-- Figma Frame 471)
--
-- Three switches: Pause all followed orgs, New event posts, Event detail
-- changes. They are GLOBAL -- one row per user, applying across every org that
-- user follows -- because the signed-off frame shows three switches and no
-- per-org list. Per-org muting is the obvious extension, and the shape it
-- would take is an (org_id, user_id) table with the same three columns and
-- this row as the fallback; nothing here forecloses that.
--
-- Deliberately NOT columns on user_settings. That table is LOOP-184's, its
-- GET/PATCH enumerate a fixed column list, and its rows describe the user's
-- own account rather than a relationship to other accounts. Three more columns
-- there would have made "notification settings" mean two different scopes in
-- one row.
--
-- Created lazily, like user_settings: no row means "all defaults", and the GET
-- returns the defaults rather than writing on a read.

CREATE TABLE IF NOT EXISTS followed_org_notification_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- The master switch. Default 0 (not paused): someone who followed an org did
  -- so to hear from it.
  paused INTEGER NOT NULL DEFAULT 0,

  -- "New event posts" -- an org you follow published an event.
  new_event_posts INTEGER NOT NULL DEFAULT 1,

  -- "Event detail changes" -- time, place or cancellation on an event from an
  -- org you follow. On by default because a moved event is the notification
  -- people are most annoyed to have missed.
  event_detail_changes INTEGER NOT NULL DEFAULT 1,

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
