-- Migration 0016: user blocks + an org profile bio (LOOP-180)
--
-- Public profiles are the first screen in the app where you look at somebody
-- who is not you, so they are also the first place that needs a way to stop
-- looking. The product decision behind this table is MUTUAL invisibility: a
-- block hides each side from the other, not just the blocked party from the
-- blocker. That is why the reads that enforce it (see server/src/lib/blocks.ts)
-- test both column orders rather than only blocker_user_id = me.
--
-- The row is directional even though the effect is symmetric. Storing one row
-- per (blocker, blocked) keeps "who did this" recoverable, which an unblock
-- needs -- if A blocks B and B also blocks A, A unblocking must not restore
-- B's block. A single unordered pair could not express that.
--
-- Blocking also DROPS any follow in both directions; that is the route's job
-- (POST /users/:userId/block), not a constraint, because SQLite cannot delete
-- from another table on insert without a trigger and a trigger would hide a
-- destructive side effect from anyone reading the handler.
--
-- Numbered 0016 because 0000 and 0001-0015 are taken.

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  -- Blocking yourself would make your own profile unreachable.
  CHECK (blocker_user_id <> blocked_user_id)
);

-- The primary key already covers "did I block them?" (blocker first). Every
-- enforcement point also asks the mirror question, "did they block me?", which
-- leads on blocked_user_id and would otherwise scan.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_user_id);

-- The org public profile shows an org-framed bio where a user profile shows a
-- personal one (Figma "Profile Main" -> Org account profile). organizations
-- rows are created as a side effect of event ingestion and carry no
-- self-description at all, so there was nowhere to read one from.
--
-- Nullable with no default: every existing row, all of them scraped, honestly
-- has no bio. NOTHING WRITES THIS YET -- the org console has no edit-profile
-- screen (it edits events and people, not the org's own identity), so adding a
-- writer would have meant designing that screen inside this ticket. The read
-- side is built; see the commit message.
ALTER TABLE organizations ADD COLUMN bio TEXT;
