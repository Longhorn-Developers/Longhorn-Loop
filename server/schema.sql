-- Longhorn Loop D1 Database Schema

-- Users table -- core profile info from onboarding
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
  -- Short profile bio, edited on Edit Profile (LOOP-181). NULL = unset.
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Linked socials -- up to MAX_LINKED_SOCIALS (3) per user (LOOP-181).
-- One row per (user, platform); the 3-max cap is enforced in the route
-- handler because SQLite can't express it as a constraint.
CREATE TABLE IF NOT EXISTS user_socials (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   TEXT    NOT NULL,  -- see shared/socialPlatforms.ts
  url        TEXT    NOT NULL,  -- normalized absolute https URL
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_user_socials_user ON user_socials(user_id);

-- User-to-user follows (Profile Main frame). Drives the "N followers -
-- N following" line on the profile header. Distinct from org_followers
-- (user->org) and org_follows (org->org).
CREATE TABLE IF NOT EXISTS user_follows (
  follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_user_id, followed_user_id),
  CHECK (follower_user_id <> followed_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_followed ON user_follows(followed_user_id);

-- User majors -- supports multiple majors per user
CREATE TABLE IF NOT EXISTS user_majors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  major TEXT NOT NULL,
  UNIQUE(user_id, major)
);

-- User interest tags -- selected during onboarding
CREATE TABLE IF NOT EXISTS user_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  UNIQUE(user_id, tag)
);

-- Verification codes -- replaces the in-memory authStore
CREATE TABLE IF NOT EXISTS verification_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL
);

-- Organizations -- scraped from HornsLink
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  profile_picture TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  -- President on file, checked against a claimant's entered email (LOOP-185).
  -- NULL = nobody on record, which the route treats as a mismatch.
  president_email TEXT,
  -- unverified | pending_review | rejected. Distinct from `verified`,
  -- which only a human approval flips.
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  -- "What best describes this organization?" from the registration form
  -- (LOOP-141). One of shared/orgRegistration.ts ORG_CATEGORIES; NULL means
  -- unanswered, which is every scraped row. Written only once a claim's code
  -- is confirmed, so an unverified stranger can't relabel a public org.
  category TEXT,
  source TEXT NOT NULL DEFAULT 'hornslink',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Events -- scraped from HornsLink and other sources
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'hornslink',
  source_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT,
  location_short TEXT,
  location_full TEXT,
  latitude REAL,
  longitude REAL,
  host_organization_id INTEGER REFERENCES organizations(id),
  host_organization_name TEXT,
  event_url TEXT,
  rsvp_url TEXT,
  image_url TEXT,
  image_width INTEGER,
  image_height INTEGER,
  image_aspect_ratio TEXT CHECK(image_aspect_ratio IN ('vertical', 'square', 'horizontal', 'none')),
  image_mime_type TEXT,
  image_alt_text TEXT,
  theme TEXT,
  visibility TEXT DEFAULT 'Public',
  rsvp_total INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Purge target for the cleanup job (LOOP-150); defaults to end_datetime + 7 days
  expires_at TEXT,
  -- Pins an event to the top of feeds
  is_featured INTEGER NOT NULL DEFAULT 0,
  -- NULL for scraped events; set for user-created events
  created_by_user_id INTEGER REFERENCES users(id),
  -- Soft-delete flag set by the cleanup job instead of a hard delete, so
  -- past user-linked events remain visible in profile history (LOOP-200)
  is_archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  -- Denormalized signal counters (Phase 1). Kept in sync inline by the
  -- save/rsvp/view endpoints; count distinct users, not raw pings.
  save_count INTEGER NOT NULL DEFAULT 0,
  rsvp_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source, source_event_id)
);

-- Cleanup job (LOOP-150) and past-events view (LOOP-200) both filter on these
CREATE INDEX IF NOT EXISTS idx_events_is_archived ON events(is_archived);
CREATE INDEX IF NOT EXISTS idx_events_created_by_user_id ON events(created_by_user_id);

-- User settings -- preferences, notification toggles, delivery channels
-- (LOOP-184). Created lazily; absent row means "all defaults".
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

-- Event categories -- many-to-many
CREATE TABLE IF NOT EXISTS event_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  category_name TEXT,
  UNIQUE(event_id, category_id)
);

-- Event perks/benefits (Free Food, Free Stuff, etc.)
CREATE TABLE IF NOT EXISTS event_benefits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  benefit_name TEXT NOT NULL,
  UNIQUE(event_id, benefit_name)
);

-- Category lookup -- maps HornsLink category IDs to names
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'hornslink'
);

-- Saved events -- user bookmarks, drives the home screen bookmark icon
-- and the event-reminder notification cron job
CREATE TABLE IF NOT EXISTS saved_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, event_id)
);

-- Event RSVPs -- deduped per user (LOOP-211). Drives rsvp_count.
CREATE TABLE IF NOT EXISTS event_rsvps (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id);

-- Event views -- deduped per user (Phase 1). Drives view_count.
CREATE TABLE IF NOT EXISTS event_views (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_event_views_event ON event_views(event_id);

-- Event tags -- classifier-assigned bucket + tag pairs (LOOP-221)
CREATE TABLE IF NOT EXISTS event_tags (
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  bucket_id TEXT    NOT NULL,
  tag       TEXT    NOT NULL,
  -- How the tag was assigned: 'semantic' (a Vectorize match) or 'keyword'
  -- (the classifier fallback). 'keyword' is truthful for every row written
  -- before semantic tagging existed.
  source    TEXT    NOT NULL DEFAULT 'keyword',
  -- Cosine similarity for semantic tags; NULL for keyword tags, which have
  -- no score to record.
  score     REAL,
  PRIMARY KEY (event_id, bucket_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_event_tags_event  ON event_tags(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_bucket ON event_tags(bucket_id);

-- Notifications -- activity center entries per user
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

-- The only read this table has is "WHERE user_id = ? ORDER BY created_at
-- DESC", so the index carries both halves of it.
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

-- Event reports -- user-submitted moderation reports. Once an event has
-- REPORT_HIDE_THRESHOLD (5) reports it is filtered from feeds for everyone.
-- The reporter also stops seeing it immediately regardless of the count.
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
