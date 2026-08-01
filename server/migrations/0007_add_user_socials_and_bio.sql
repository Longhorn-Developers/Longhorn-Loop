-- Migration 0007: linked socials + profile bio (LOOP-181)
--
-- Backs the "Linked Socials (3 max)" row on Edit Profile. One row per
-- (user, platform) pair, so a user can't link two Instagram accounts -- the
-- Figma flow greys out an app once it's connected and this enforces the same
-- rule at the database level.
--
-- The 3-max cap is NOT expressible as a table constraint in SQLite, so it is
-- enforced in the POST /users/me/socials handler.

CREATE TABLE IF NOT EXISTS user_socials (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- One of the ids in shared/socialPlatforms.ts:
  -- linkedin | instagram | linktree | discord | slack | link
  platform   TEXT    NOT NULL,
  -- Normalized absolute https URL (scheme forced, trailing slash stripped).
  url        TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_user_socials_user ON user_socials(user_id);

-- Edit Profile also edits a short bio (Figma "Edit Profile" frame). There was
-- no column for it, so onboarding never captured one -- NULL means "unset"
-- and the profile screen hides the section entirely.
ALTER TABLE users ADD COLUMN bio TEXT;
