-- Migration 0011: user-to-user follows (Profile Main frame)
--
-- The profile header shows "88 followers · 102 following". Org follows already
-- exist (org_followers, org_follows from migration 0008), but there was no way
-- for one user to follow another, so the followers half of that line had no
-- source at all.
--
-- Separate from org_followers on purpose: that table is (org, user) and this is
-- (user, user). Merging them would need a discriminator column on every query
-- for no benefit, the same reasoning applied to org_followers vs org_follows.

CREATE TABLE IF NOT EXISTS user_follows (
  follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_user_id, followed_user_id),
  -- Following yourself would inflate both of your own counters.
  CHECK (follower_user_id <> followed_user_id)
);

-- "N followers" counts rows by who is being followed, so this index carries
-- the read that appears on every profile view.
CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_user_id);
