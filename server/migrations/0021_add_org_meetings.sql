-- Migration 0021: an org's regular meeting times (LOOP-319).
--
-- Shown on the org's public landing page, but ONLY to its members (admins and
-- editors in org_members). Where a student org meets is not public in the way
-- its events are; the server withholds these rows from everyone else, so a
-- client-side hide is not the only thing standing between a stranger and the
-- room number. Admins add, edit and remove them.
--
-- Weekly recurring only -- a one-off gathering is an event. Times are Austin
-- wall-clock "HH:MM" so "Tuesdays at 7pm" survives the DST change. See
-- shared/orgMeetings.ts for validation and display.

CREATE TABLE IF NOT EXISTS org_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- 0 = Sunday ... 6 = Saturday
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT,
  location TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The only read is "every meeting for this org, in week order".
CREATE INDEX IF NOT EXISTS idx_org_meetings_org ON org_meetings(org_id, day_of_week, start_time);
