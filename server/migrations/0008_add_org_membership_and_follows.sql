-- Migration 0008: organization membership, invites, follows (LOOP-183)
--
-- The organizations table already exists (migration 0001) but is scrape-only:
-- it records that a HornsLink org exists, with nobody attached to it. This
-- migration adds the people layer the Org Management console needs -- who
-- belongs to an org, in what role, who has been invited, and who follows it.

-- Org membership. Two roles, matching the badges in the Figma Members tab:
--   admin  -- can change roles, remove editors, and invite
--   editor -- can post/manage events, cannot manage people
CREATE TABLE IF NOT EXISTS org_members (
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL CHECK(role IN ('admin', 'editor')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org  ON org_members(org_id);

-- Pending editor invites (the Invite Editor modal, LOOP-182).
--
-- Keyed by email rather than user_id on purpose: the Figma flow searches by UT
-- email and the invitee may not have an account yet. The row is created at
-- invite time and consumed when they accept, at which point an org_members row
-- is written.
--
-- UNIQUE(org_id, email) means re-inviting the same person updates the existing
-- invite instead of accumulating duplicates.
CREATE TABLE IF NOT EXISTS org_invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email      TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'editor' CHECK(role IN ('admin', 'editor')),
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status     TEXT    NOT NULL DEFAULT 'pending'
             CHECK(status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL DEFAULT (datetime('now', '+14 days')),
  UNIQUE(org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(email);

-- Users following an org. Drives the "36 followers" count in the console
-- header and, later, follow-based feed signals.
CREATE TABLE IF NOT EXISTS org_followers (
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_followers_org ON org_followers(org_id);

-- Orgs following other orgs. Separate from org_followers because the header
-- shows both numbers ("36 followers - 44 following") and they are genuinely
-- different relationships; collapsing them into one polymorphic table would
-- make every query carry a discriminator for no benefit.
CREATE TABLE IF NOT EXISTS org_follows (
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  followed_org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (org_id, followed_org_id),
  -- An org following itself would inflate its own numbers.
  CHECK (org_id <> followed_org_id)
);

-- Per-org notification toggles (Figma Frame 470). One row per org; defaults
-- match the design's on-by-default state.
CREATE TABLE IF NOT EXISTS org_notification_settings (
  org_id            INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  new_rsvps         INTEGER NOT NULL DEFAULT 1,
  new_followers     INTEGER NOT NULL DEFAULT 1,
  event_reports     INTEGER NOT NULL DEFAULT 1,
  org_team_invites  INTEGER NOT NULL DEFAULT 1,
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
