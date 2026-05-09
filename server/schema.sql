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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  UNIQUE(source, source_event_id)
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
