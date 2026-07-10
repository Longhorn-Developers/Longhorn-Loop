-- Migration 0001: add events, organizations, and supporting tables

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

CREATE TABLE IF NOT EXISTS event_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  category_name TEXT,
  UNIQUE(event_id, category_id)
);

CREATE TABLE IF NOT EXISTS event_benefits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  benefit_name TEXT NOT NULL,
  UNIQUE(event_id, benefit_name)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'hornslink'
);
