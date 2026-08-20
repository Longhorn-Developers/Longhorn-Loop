-- Migration 0005: add event_tags table (LOOP-221)
-- Stores classifier-assigned bucket + tag pairs for each event.
CREATE TABLE IF NOT EXISTS event_tags (
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  bucket_id TEXT    NOT NULL,
  tag       TEXT    NOT NULL,
  PRIMARY KEY (event_id, bucket_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_event_tags_event    ON event_tags(event_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_bucket   ON event_tags(bucket_id);
