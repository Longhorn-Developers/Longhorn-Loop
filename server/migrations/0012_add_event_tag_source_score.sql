-- Migration 0007: record how each event_tag was assigned.
-- source: 'semantic' (Vectorize match) or 'keyword' (classifier fallback).
--   Default 'keyword' is truthful for all pre-existing rows, which were
--   written by the keyword classifier before semantic tagging existed.
-- score: cosine similarity for semantic tags; NULL for keyword tags (no score).
ALTER TABLE event_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'keyword';
ALTER TABLE event_tags ADD COLUMN score REAL;
