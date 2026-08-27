// Expired-event cleanup (LOOP-150, reopened 2026-08-26 — never actually
// shipped despite being marked Done).
//
// Runs daily on its own cron, separate from the 6-hour scrape (LOOP-149) and
// the 15-minute reminder sweep. Keeps `events` from growing unbounded while
// preserving the history LOOP-200's past-events view depends on: an event a
// user created, RSVP'd to, or saved must never disappear from under them,
// even after it expires. Purely orphaned scraped events — nobody ever
// engaged with them — are hard-deleted instead of accumulating forever.
//
// Like accountDeletion.ts, this module imports nothing from the Worker
// runtime except the ambient D1Database type, so the SELECT/statement-
// building logic can run against a real SQLite database built from
// schema.sql in the test suite instead of a hand-copied paraphrase of it.

export interface SqlStatement {
  sql: string;
  binds: unknown[];
}

export interface CleanupCounts {
  archived: number;
  purged: number;
}

/**
 * expires_at is written by events/ingest.ts and routes/events.worker.ts
 * (create + reschedule) as end_datetime (or start_datetime when there is no
 * end) plus the 7-day retention window. The COALESCE fallback only matters
 * for a row written before migration 0002 backfilled the column.
 */
export const EXPIRED_CONDITION = `
  COALESCE(e.expires_at, datetime(COALESCE(e.end_datetime, e.start_datetime), '+7 days')) < datetime('now')
`;

/**
 * An expired event keeps a live user relationship — and so gets archived
 * instead of deleted — if someone created it, RSVP'd to it, or saved it.
 * Views, reports and classifier tags don't count: none of them are a
 * relationship LOOP-200's past-events view needs to preserve.
 */
const HAS_USER_RELATIONSHIP = `
  (e.created_by_user_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = e.id)
    OR EXISTS (SELECT 1 FROM saved_events s WHERE s.event_id = e.id))
`;

// is_archived = 0 excludes events a previous run of this job (or
// accountDeletion.ts's own archiving) already archived, so a rerun costs a
// no-op scan instead of rewriting rows that are already done.
export const ARCHIVE_CANDIDATES_QUERY = `
  SELECT e.id FROM events e
  WHERE e.is_archived = 0 AND ${EXPIRED_CONDITION} AND ${HAS_USER_RELATIONSHIP}
`;

export const PURGE_CANDIDATES_QUERY = `
  SELECT e.id FROM events e
  WHERE e.is_archived = 0 AND ${EXPIRED_CONDITION} AND NOT ${HAS_USER_RELATIONSHIP}
`;

// D1 inherits SQLite's ~999-bound-parameter ceiling per statement. This job
// has never run before, so its first run can face years of accumulated
// expired events — ids are batched rather than trusted to fit in one
// IN (...) list.
const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * archived_at is COALESCE'd so re-running this job — or this job running
 * after accountDeletion.ts already archived the same row — can't clobber the
 * original archive timestamp.
 */
export function archiveStatements(eventIds: number[]): SqlStatement[] {
  return chunk(eventIds, CHUNK_SIZE).map((ids) => ({
    sql: `UPDATE events
             SET is_archived = 1,
                 archived_at = COALESCE(archived_at, datetime('now')),
                 updated_at = datetime('now')
           WHERE id IN (${ids.map(() => '?').join(', ')})`,
    binds: ids,
  }));
}

// Child rows are deleted explicitly rather than relying on ON DELETE CASCADE
// — D1 gives no guarantee PRAGMA foreign_keys is on (see accountDeletion.ts
// for the same call). event_rsvps and saved_events are deliberately absent:
// PURGE_CANDIDATES_QUERY guarantees zero rows in either table for every id
// that reaches here.
const PURGE_CHILD_TABLES = [
  'event_categories',
  'event_benefits',
  'event_views',
  'event_reports',
  'event_tags',
];

/**
 * Hard-deletes orphaned expired events and every child row that references
 * them. notifications.event_id is detached (SET NULL) rather than deleted,
 * matching its declared ON DELETE SET NULL in schema.sql: a notification
 * about an event nobody ever RSVP'd to or saved still recorded something
 * that happened, and only the now-dangling link should go.
 */
export function purgeStatements(eventIds: number[]): SqlStatement[] {
  const statements: SqlStatement[] = [];

  for (const ids of chunk(eventIds, CHUNK_SIZE)) {
    const placeholders = ids.map(() => '?').join(', ');
    statements.push({
      sql: `UPDATE notifications SET event_id = NULL WHERE event_id IN (${placeholders})`,
      binds: ids,
    });
    for (const table of PURGE_CHILD_TABLES) {
      statements.push({
        sql: `DELETE FROM ${table} WHERE event_id IN (${placeholders})`,
        binds: ids,
      });
    }
    statements.push({ sql: `DELETE FROM events WHERE id IN (${placeholders})`, binds: ids });
  }

  return statements;
}

/**
 * The whole job: find expired events, partition them by user relationship,
 * and run every resulting statement in one D1 batch (one transaction) so a
 * mid-run failure can't leave some events archived and others still pending.
 */
export async function runEventCleanup(db: D1Database): Promise<CleanupCounts> {
  const [archiveRows, purgeRows] = await Promise.all([
    db.prepare(ARCHIVE_CANDIDATES_QUERY).all<{ id: number }>(),
    db.prepare(PURGE_CANDIDATES_QUERY).all<{ id: number }>(),
  ]);

  const archiveIds = archiveRows.results.map((r) => r.id);
  const purgeIds = purgeRows.results.map((r) => r.id);

  const statements = [...archiveStatements(archiveIds), ...purgeStatements(purgeIds)];
  if (statements.length > 0) {
    await db.batch(statements.map((s) => db.prepare(s.sql).bind(...s.binds)));
  }

  return { archived: archiveIds.length, purged: purgeIds.length };
}
