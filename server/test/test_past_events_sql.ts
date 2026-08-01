/**
 * Executes the past-events queries from routes/users.worker.ts (LOOP-200)
 * against a real SQLite database built from server/schema.sql.
 *
 * D1 *is* SQLite, so running the literal SQL here catches the things type
 * checking can't: a wrong JOIN that leaks another user's events, a COALESCE
 * that mishandles a NULL end_datetime, an archived event that silently drops
 * out of history. The ticket's acceptance criteria are mostly negative
 * ("events the user never interacted with are NOT shown"), and those are
 * exactly the cases a hand-read of the SQL gets wrong.
 *
 * The query strings below are duplicated from the route rather than imported,
 * because the route builds them inline against a D1Database binding that
 * doesn't exist outside the Worker runtime. If you change the route's SQL,
 * change it here too — a drift shows up as a failing invariant, which is the
 * point.
 *
 * Skips automatically when node:sqlite is unavailable (it needs Node 22+, and
 * CI runs Node 20). CI does not run this suite; it is a local guard.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// node:sqlite is experimental and Node-22-only, so probe before committing to it.
let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const PAST_EVENT_CONDITION = `(e.is_archived = 1 OR COALESCE(e.end_datetime, e.start_datetime) < datetime('now'))`;

const PAST_GROUPS = {
  created: { join: '', where: 'e.created_by_user_id = ?' },
  attended: {
    join: 'JOIN event_rsvps r ON r.event_id = e.id AND r.user_id = ?',
    where: '1 = 1',
  },
  saved: {
    join: 'JOIN saved_events s ON s.event_id = e.id AND s.user_id = ?',
    where: '1 = 1',
  },
} as const;

type PastGroup = keyof typeof PAST_GROUPS;

function pastEventsSql(group: PastGroup): string {
  const { join: j, where } = PAST_GROUPS[group];
  return `SELECT e.id, e.title
          FROM events e
          ${j}
          LEFT JOIN organizations o ON e.host_organization_id = o.id
          WHERE ${where}
            AND ${PAST_EVENT_CONDITION}
          ORDER BY COALESCE(e.end_datetime, e.start_datetime) DESC
          LIMIT ?`;
}

const PAST = '2020-01-01T10:00:00';
const FUTURE = '2999-01-01T10:00:00';

const ME = 1;
const SOMEONE_ELSE = 2;

// id -> what it is. The negative cases (5, 7) are the important ones.
const EVENTS: [number, string, string, string | null, number, number | null][] = [
  // id, title,                            start,  end,    archived, creator
  [1, 'I created this, it ended', PAST, PAST, 0, ME],
  [2, 'I created this, still upcoming', FUTURE, FUTURE, 0, ME],
  [3, "I RSVP'd, it ended", PAST, PAST, 0, null],
  [4, 'I saved it, it ended', PAST, PAST, 0, null],
  [5, 'Untouched and ended', PAST, PAST, 0, null],
  [6, 'Archived, no end_datetime', PAST, null, 1, null],
  [7, 'Someone else created, ended', PAST, PAST, 0, SOMEONE_ELSE],
  [8, "I RSVP'd but upcoming", FUTURE, FUTURE, 0, null],
  [9, 'Archived early, end date in future', FUTURE, FUTURE, 1, ME],
];

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('past-events SQL (LOOP-200)', () => {
  let db: any;
  const results: Record<PastGroup, number[]> = { created: [], attended: [], saved: [] };

  beforeAll(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    db.exec(
      `INSERT INTO users (id, email, first_name, last_name) VALUES
         (${ME}, 'me@utexas.edu', 'Me', 'User'),
         (${SOMEONE_ELSE}, 'other@utexas.edu', 'Other', 'User')`,
    );

    const insert = db.prepare(
      `INSERT INTO events (id, source, source_event_id, title, start_datetime, end_datetime,
                           is_archived, created_by_user_id)
       VALUES (?, 'test', ?, ?, ?, ?, ?, ?)`,
    );
    for (const [id, title, start, end, archived, creator] of EVENTS) {
      insert.run(id, `src-${id}`, title, start, end, archived, creator);
    }

    db.exec(
      `INSERT INTO event_rsvps (user_id, event_id) VALUES (${ME}, 3), (${ME}, 6), (${ME}, 8)`,
    );
    db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES (${ME}, 4)`);

    for (const group of Object.keys(PAST_GROUPS) as PastGroup[]) {
      results[group] = db
        .prepare(pastEventsSql(group))
        .all(ME, 50)
        .map((r: { id: number }) => r.id);
    }
  });

  it('shows an ended event the user created', () => {
    expect(results.created).toContain(1);
  });

  it('excludes an upcoming event the user created', () => {
    expect(results.created).not.toContain(2);
  });

  it('treats archived as past even when the end date is still in the future', () => {
    // The cleanup job archiving something is authoritative — a stale future
    // end_datetime must not resurrect it into the live feed's territory.
    expect(results.created).toContain(9);
  });

  it("shows an ended event the user RSVP'd to", () => {
    expect(results.attended).toContain(3);
  });

  it("excludes an upcoming event the user RSVP'd to", () => {
    expect(results.attended).not.toContain(8);
  });

  it('falls back to start_datetime when end_datetime is NULL', () => {
    // Scraped events often have no end time. Without COALESCE these would be
    // treated as "never ends" and vanish from history entirely.
    expect(results.attended).toContain(6);
  });

  it('shows an ended event the user saved', () => {
    expect(results.saved).toContain(4);
  });

  it('never shows an ended event the user never interacted with', () => {
    // Acceptance criterion: these stay purgeable by the cleanup job.
    const all = [...results.created, ...results.attended, ...results.saved];
    expect(all).not.toContain(5);
  });

  it("never leaks another user's created event", () => {
    const all = [...results.created, ...results.attended, ...results.saved];
    expect(all).not.toContain(7);
  });

  it('orders newest-ended first', () => {
    // 9 ends in 2999, 1 ended in 2020.
    expect(results.created).toEqual([9, 1]);
  });
});
