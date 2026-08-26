/**
 * Expired-event cleanup (LOOP-150), executed against a real SQLite database
 * built from server/schema.sql.
 *
 * Same approach as test_account_deletion_sql.ts: the queries and statement
 * builders live in src/lib/eventCleanup.ts precisely so they can be imported
 * and run here, instead of a hand-copied paraphrase of them that drifts. The
 * D1-specific orchestration (runEventCleanup, which calls db.batch()) is not
 * exercised here — node:sqlite has a different API — so this suite runs the
 * same SELECT-then-statement pipeline runEventCleanup runs, just through
 * node:sqlite instead of a D1Database.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ARCHIVE_CANDIDATES_QUERY,
  PURGE_CANDIDATES_QUERY,
  archiveStatements,
  purgeStatements,
  type SqlStatement,
} from '../src/lib/eventCleanup';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const USER1 = 1;
const USER2 = 2;

// Expired events, one per relationship case.
const EVENT_ORPHANED = 10; // no creator, no rsvp, no save -> purge
const EVENT_VIEWED_ONLY = 11; // viewed/reported/tagged but no relationship -> purge
const EVENT_CREATED = 20; // created_by_user_id set -> archive
const EVENT_RSVPD = 21; // someone RSVP'd -> archive
const EVENT_SAVED = 22; // someone saved -> archive
const EVENT_STALE_ARCHIVED_AT = 23; // created, is_archived=0, but archived_at already set

// Not expired.
const EVENT_FUTURE = 30; // orphaned, but not expired -> untouched

// Already archived by a previous run (or accountDeletion.ts).
const EVENT_ALREADY_ARCHIVED = 40;

const PAST = '2020-01-01 00:00:00';
const FUTURE = '2099-01-01 00:00:00';

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('expired event cleanup (LOOP-150)', () => {
  let db: any;

  const run = (statements: SqlStatement[]) => {
    for (const s of statements) db.prepare(s.sql).run(...(s.binds as any[]));
  };

  const event = (id: number) => db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  const count = (sql: string, ...binds: any[]): number =>
    db.prepare(`SELECT COUNT(*) AS c FROM ${sql}`).get(...binds).c;

  /** The whole job, minus the D1 wrapper: select candidates, build, run. */
  const runCleanup = () => {
    const archiveIds = db
      .prepare(ARCHIVE_CANDIDATES_QUERY)
      .all()
      .map((r: any) => r.id);
    const purgeIds = db
      .prepare(PURGE_CANDIDATES_QUERY)
      .all()
      .map((r: any) => r.id);
    run([...archiveStatements(archiveIds), ...purgeStatements(purgeIds)]);
    return { archived: archiveIds.length, purged: purgeIds.length };
  };

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    // FKs off for the same reason as test_account_deletion_sql.ts: this
    // suite measures whether eventCleanup.ts's own statements do the job,
    // not whether SQLite's ON DELETE CASCADE bails it out.
    db.exec('PRAGMA foreign_keys = OFF');

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${USER1}, 'one@utexas.edu', 'One', 'User'),
      (${USER2}, 'two@utexas.edu', 'Two', 'User')`);

    const insertEvent = (
      id: number,
      title: string,
      expiresAt: string,
      opts: { createdBy?: number; archived?: boolean; archivedAt?: string | null } = {},
    ) => {
      db.prepare(
        `INSERT INTO events
           (id, source, source_event_id, title, start_datetime, expires_at,
            created_by_user_id, is_archived, archived_at)
         VALUES (?, 'app', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        `src-${id}`,
        title,
        PAST,
        expiresAt,
        opts.createdBy ?? null,
        opts.archived ? 1 : 0,
        opts.archivedAt ?? null,
      );
    };

    insertEvent(EVENT_ORPHANED, 'Orphaned', PAST);
    insertEvent(EVENT_VIEWED_ONLY, 'Viewed Only', PAST);
    insertEvent(EVENT_CREATED, 'Created', PAST, { createdBy: USER1 });
    insertEvent(EVENT_RSVPD, "RSVP'd", PAST);
    insertEvent(EVENT_SAVED, 'Saved', PAST);
    insertEvent(EVENT_STALE_ARCHIVED_AT, 'Stale archived_at', PAST, {
      createdBy: USER1,
      archivedAt: '2020-06-01 00:00:00',
    });
    insertEvent(EVENT_FUTURE, 'Future', FUTURE);
    insertEvent(EVENT_ALREADY_ARCHIVED, 'Already archived', PAST, {
      archived: true,
      archivedAt: '2020-03-01 00:00:00',
    });

    db.exec(`INSERT INTO event_rsvps (user_id, event_id) VALUES (${USER2}, ${EVENT_RSVPD})`);
    db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES (${USER2}, ${EVENT_SAVED})`);

    // Engagement that is NOT a relationship: viewing, reporting, and a
    // classifier tag, all on the event that should still be purged.
    db.exec(`INSERT INTO event_views (user_id, event_id) VALUES (${USER1}, ${EVENT_VIEWED_ONLY})`);
    db.exec(
      `INSERT INTO event_reports (user_id, event_id, reasons, description)
       VALUES (${USER1}, ${EVENT_VIEWED_ONLY}, '["spam"]', 'nope')`,
    );
    db.exec(
      `INSERT INTO event_tags (event_id, bucket_id, tag) VALUES (${EVENT_VIEWED_ONLY}, 'social', 'mixer')`,
    );

    // Child rows on the plain orphaned event too, so purge is proven to
    // clean them up, not just proven not to touch EVENT_VIEWED_ONLY's.
    db.exec(
      `INSERT INTO event_categories (event_id, category_id, category_name)
       VALUES (${EVENT_ORPHANED}, 'cat1', 'Category One')`,
    );
    db.exec(
      `INSERT INTO event_benefits (event_id, benefit_name) VALUES (${EVENT_ORPHANED}, 'Free Food')`,
    );
    db.exec(
      `INSERT INTO notifications (user_id, title, event_id) VALUES (${USER1}, 'Heads up', ${EVENT_ORPHANED})`,
    );
  });

  describe('purging orphaned expired events', () => {
    it('deletes an expired event with no creator, RSVP, or save', () => {
      runCleanup();
      expect(event(EVENT_ORPHANED)).toBeUndefined();
    });

    it('purges even when the only engagement is a view, report, or tag', () => {
      runCleanup();
      expect(event(EVENT_VIEWED_ONLY)).toBeUndefined();
    });

    it('cleans up child rows: categories, benefits, views, reports, tags', () => {
      runCleanup();
      expect(count('event_categories WHERE event_id = ?', EVENT_ORPHANED)).toBe(0);
      expect(count('event_benefits WHERE event_id = ?', EVENT_ORPHANED)).toBe(0);
      expect(count('event_views WHERE event_id = ?', EVENT_VIEWED_ONLY)).toBe(0);
      expect(count('event_reports WHERE event_id = ?', EVENT_VIEWED_ONLY)).toBe(0);
      expect(count('event_tags WHERE event_id = ?', EVENT_VIEWED_ONLY)).toBe(0);
    });

    it('detaches notifications instead of deleting them', () => {
      runCleanup();
      const notif = db.prepare("SELECT * FROM notifications WHERE title = 'Heads up'").get();
      expect(notif).toBeDefined();
      expect(notif.event_id).toBeNull();
    });
  });

  describe('archiving expired events with a user relationship', () => {
    it('archives (does not delete) an event the user created', () => {
      runCleanup();
      const e = event(EVENT_CREATED);
      expect(e).toBeDefined();
      expect(e.is_archived).toBe(1);
      expect(e.archived_at).not.toBeNull();
    });

    it("archives an event a user RSVP'd to, and keeps the RSVP row", () => {
      runCleanup();
      const e = event(EVENT_RSVPD);
      expect(e).toBeDefined();
      expect(e.is_archived).toBe(1);
      expect(count('event_rsvps WHERE event_id = ?', EVENT_RSVPD)).toBe(1);
    });

    it('archives an event a user saved, and keeps the saved_events row', () => {
      runCleanup();
      const e = event(EVENT_SAVED);
      expect(e).toBeDefined();
      expect(e.is_archived).toBe(1);
      expect(count('saved_events WHERE event_id = ?', EVENT_SAVED)).toBe(1);
    });

    it('does not rewrite an already-set archived_at', () => {
      runCleanup();
      expect(event(EVENT_STALE_ARCHIVED_AT).archived_at).toBe('2020-06-01 00:00:00');
    });
  });

  describe('leaves everything else alone', () => {
    it('does not touch a non-expired event', () => {
      runCleanup();
      const e = event(EVENT_FUTURE);
      expect(e).toBeDefined();
      expect(e.is_archived).toBe(0);
    });

    it('does not reprocess an event a previous run already archived', () => {
      runCleanup();
      const e = event(EVENT_ALREADY_ARCHIVED);
      expect(e).toBeDefined();
      // Untouched: still the original archived_at, not overwritten or reset.
      expect(e.archived_at).toBe('2020-03-01 00:00:00');
    });
  });

  describe('counts', () => {
    it('reports archived vs. purged for the run', () => {
      const counts = runCleanup();
      // Archived: EVENT_CREATED, EVENT_RSVPD, EVENT_SAVED, EVENT_STALE_ARCHIVED_AT.
      expect(counts.archived).toBe(4);
      // Purged: EVENT_ORPHANED, EVENT_VIEWED_ONLY.
      expect(counts.purged).toBe(2);
    });

    it('is a no-op on the second run — nothing left to archive or purge', () => {
      runCleanup();
      const second = runCleanup();
      expect(second).toEqual({ archived: 0, purged: 0 });
    });
  });

  describe('with foreign keys enforced', () => {
    it('runs without violating a constraint', () => {
      db.exec('PRAGMA foreign_keys = ON');
      expect(() => runCleanup()).not.toThrow();
      expect(event(EVENT_ORPHANED)).toBeUndefined();
      expect(event(EVENT_CREATED).is_archived).toBe(1);
    });
  });
});
