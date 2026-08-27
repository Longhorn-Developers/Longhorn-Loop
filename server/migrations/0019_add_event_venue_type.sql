-- Migration 0019: add venue type to events
-- Supported values: in_person, online

ALTER TABLE events ADD COLUMN venue_type TEXT NOT NULL DEFAULT 'in_person';

-- Existing events whose location clearly indicates an online event.
UPDATE events
SET venue_type = 'online'
WHERE
  lower(trim(location_short)) IN (
    'online',
    'virtual',
    'zoom',
    'zoom webinar'
  )
  OR lower(trim(location_full)) IN (
    'online',
    'virtual',
    'zoom',
    'zoom webinar'
  )
  OR lower(location_short) LIKE '%webinar%'
  OR lower(location_full) LIKE '%webinar%';

CREATE INDEX IF NOT EXISTS idx_events_venue_type
  ON events(venue_type);