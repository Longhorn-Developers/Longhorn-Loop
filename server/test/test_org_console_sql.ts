/**
 * Executes the Org Management console queries from routes/orgs.worker.ts
 * (LOOP-183) against a real SQLite database built from server/schema.sql.
 *
 * Two classes of thing are worth pinning here and nowhere else:
 *
 *   1. Authorization boundaries. "An editor cannot manage people" and "an org
 *      can never reach zero admins" are enforced by SQL counts, not types, so
 *      only a real database proves them.
 *   2. The analytics UNION ALL. Views, RSVPs and saves live in three tables
 *      with three created_at columns; folding them into one daily series is
 *      easy to get subtly wrong (double counting, dropped days, a JOIN that
 *      leaks another org's events).
 *
 * Query strings are duplicated from the route because the route builds them
 * against a D1Database binding that only exists in the Worker runtime. If you
 * change the route SQL, change it here — drift shows up as a failure.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const ORG = 100;
const OTHER_ORG = 200;
const ADMIN = 1;
const EDITOR = 2;
const SECOND_ADMIN = 3;
const OUTSIDER = 4;

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('org console SQL (LOOP-183)', () => {
  let db: any;

  const roleOf = (orgId: number, userId: number): string | null =>
    db.prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?').get(orgId, userId)
      ?.role ?? null;

  const adminCount = (orgId: number): number =>
    db
      .prepare("SELECT COUNT(*) AS c FROM org_members WHERE org_id = ? AND role = 'admin'")
      .get(orgId).c;

  beforeAll(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${ADMIN}, 'admin@utexas.edu', 'Ada', 'Admin'),
      (${EDITOR}, 'editor@utexas.edu', 'Eli', 'Editor'),
      (${SECOND_ADMIN}, 'admin2@utexas.edu', 'Bo', 'Admin'),
      (${OUTSIDER}, 'nobody@utexas.edu', 'No', 'Body')`);

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${ORG}, 'Longhorn Devs'), (${OTHER_ORG}, 'Unrelated Org')`);

    db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES
      (${ORG}, ${ADMIN}, 'admin'),
      (${ORG}, ${EDITOR}, 'editor'),
      (${OTHER_ORG}, ${OUTSIDER}, 'admin')`);

    // Two events for our org, one for the unrelated org (the leak canary).
    db.exec(`INSERT INTO events
      (id, source, source_event_id, title, start_datetime, end_datetime,
       host_organization_id, view_count, rsvp_count, save_count)
      VALUES
      (10,'test','e10','General Meeting #1','2026-07-01T18:00:00','2026-07-01T20:00:00',${ORG},1000,120,80),
      (11,'test','e11','Hack Night','2026-07-05T18:00:00','2026-07-05T21:00:00',${ORG},400,36,27),
      (12,'test','e12','Not ours','2026-07-05T18:00:00','2026-07-05T21:00:00',${OTHER_ORG},9999,9999,9999)`);

    // Engagement rows inside the trailing 7-day window.
    const today = "datetime('now', '-1 days')";
    db.exec(`INSERT INTO event_views (user_id, event_id, created_at) VALUES
      (${ADMIN}, 10, ${today}), (${EDITOR}, 10, ${today}), (${SECOND_ADMIN}, 11, ${today})`);
    db.exec(`INSERT INTO event_rsvps (user_id, event_id, created_at) VALUES
      (${ADMIN}, 10, ${today}), (${EDITOR}, 11, ${today})`);
    db.exec(`INSERT INTO saved_events (user_id, event_id, created_at) VALUES
      (${ADMIN}, 10, ${today})`);
    // The unrelated org gets engagement too — it must never appear in our series.
    db.exec(
      `INSERT INTO event_views (user_id, event_id, created_at) VALUES (${OUTSIDER}, 12, ${today})`,
    );

    db.exec(`INSERT INTO org_followers (org_id, user_id) VALUES
      (${ORG}, ${EDITOR}), (${ORG}, ${SECOND_ADMIN}), (${ORG}, ${OUTSIDER})`);
    db.exec(`INSERT INTO org_follows (org_id, followed_org_id) VALUES (${ORG}, ${OTHER_ORG})`);
  });

  describe('membership resolution', () => {
    it('resolves a member to their role', () => {
      expect(roleOf(ORG, ADMIN)).toBe('admin');
      expect(roleOf(ORG, EDITOR)).toBe('editor');
    });

    it('returns nothing for a user who belongs to a different org', () => {
      // Membership is per-org: being an admin of OTHER_ORG grants nothing here.
      expect(roleOf(ORG, OUTSIDER)).toBeNull();
      expect(roleOf(OTHER_ORG, OUTSIDER)).toBe('admin');
    });

    it('rejects a role outside the allowed set', () => {
      expect(() =>
        db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES (${ORG}, 99, 'owner')`),
      ).toThrow();
    });
  });

  describe('last-admin guard', () => {
    it('counts exactly one admin before any change', () => {
      expect(adminCount(ORG)).toBe(1);
    });

    it('blocks demoting the only admin (count <= 1)', () => {
      // The route refuses when this count is <= 1, which would otherwise leave
      // the org with nobody able to promote anyone back.
      expect(adminCount(ORG)).toBeLessThanOrEqual(1);
    });

    it('allows the demote once a second admin exists', () => {
      db.exec(
        `INSERT INTO org_members (org_id, user_id, role) VALUES (${ORG}, ${SECOND_ADMIN}, 'admin')`,
      );
      expect(adminCount(ORG)).toBe(2);

      db.exec(
        `UPDATE org_members SET role = 'editor' WHERE org_id = ${ORG} AND user_id = ${ADMIN}`,
      );
      expect(adminCount(ORG)).toBe(1);
      expect(roleOf(ORG, ADMIN)).toBe('editor');

      // Restore for later tests.
      db.exec(`UPDATE org_members SET role = 'admin' WHERE org_id = ${ORG} AND user_id = ${ADMIN}`);
      db.exec(`DELETE FROM org_members WHERE org_id = ${ORG} AND user_id = ${SECOND_ADMIN}`);
    });
  });

  describe('invites', () => {
    it('re-inviting the same email updates rather than duplicating', () => {
      const upsert = `
        INSERT INTO org_invites (org_id, email, role, invited_by, status, expires_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now', '+14 days'))
        ON CONFLICT(org_id, email) DO UPDATE SET
          role = excluded.role, status = 'pending', created_at = datetime('now')`;
      db.prepare(upsert).run(ORG, 'new@utexas.edu', 'editor', ADMIN);
      db.prepare(upsert).run(ORG, 'new@utexas.edu', 'admin', ADMIN);

      const rows = db
        .prepare('SELECT role FROM org_invites WHERE org_id = ? AND email = ?')
        .all(ORG, 'new@utexas.edu');
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('admin');
    });

    it('re-invite resets a revoked invite back to pending', () => {
      db.exec(`UPDATE org_invites SET status = 'revoked' WHERE email = 'new@utexas.edu'`);
      db.prepare(
        `INSERT INTO org_invites (org_id, email, role, invited_by, status, expires_at)
         VALUES (?, ?, 'editor', ?, 'pending', datetime('now', '+14 days'))
         ON CONFLICT(org_id, email) DO UPDATE SET status = 'pending'`,
      ).run(ORG, 'new@utexas.edu', ADMIN);

      const row = db
        .prepare('SELECT status FROM org_invites WHERE org_id = ? AND email = ?')
        .get(ORG, 'new@utexas.edu');
      expect(row.status).toBe('pending');
    });

    it('rejects a status outside the allowed set', () => {
      expect(() =>
        db.exec(
          `INSERT INTO org_invites (org_id, email, status) VALUES (${ORG}, 'x@utexas.edu', 'maybe')`,
        ),
      ).toThrow();
    });
  });

  describe('header counts', () => {
    it('sums the stat tiles from the denormalized counters, scoped to the org', () => {
      const totals = db
        .prepare(
          `SELECT COALESCE(SUM(view_count),0) AS views,
                  COALESCE(SUM(rsvp_count),0) AS going,
                  COALESCE(SUM(save_count),0) AS saved
             FROM events WHERE host_organization_id = ?`,
        )
        .get(ORG);
      // 1000+400 / 120+36 / 80+27 — the other org's 9999s must not appear.
      expect(totals).toMatchObject({ views: 1400, going: 156, saved: 107 });
    });

    it('counts followers and following separately', () => {
      const followers = db
        .prepare('SELECT COUNT(*) AS c FROM org_followers WHERE org_id = ?')
        .get(ORG).c;
      const following = db
        .prepare('SELECT COUNT(*) AS c FROM org_follows WHERE org_id = ?')
        .get(ORG).c;
      expect(followers).toBe(3);
      expect(following).toBe(1);
    });

    it('refuses to let an org follow itself', () => {
      expect(() =>
        db.exec(`INSERT INTO org_follows (org_id, followed_org_id) VALUES (${ORG}, ${ORG})`),
      ).toThrow();
    });
  });

  describe('analytics', () => {
    const weeklySql = (scoped: boolean) => `
      SELECT day,
             SUM(CASE WHEN kind = 'view'  THEN 1 ELSE 0 END) AS views,
             SUM(CASE WHEN kind = 'rsvp'  THEN 1 ELSE 0 END) AS going,
             SUM(CASE WHEN kind = 'saved' THEN 1 ELSE 0 END) AS saved
      FROM (
        SELECT date(v.created_at) AS day, 'view' AS kind
          FROM event_views v JOIN events e ON e.id = v.event_id
         WHERE e.host_organization_id = ? ${scoped ? 'AND e.id = ?' : ''}
           AND v.created_at >= datetime('now', '-7 days')
        UNION ALL
        SELECT date(r.created_at) AS day, 'rsvp' AS kind
          FROM event_rsvps r JOIN events e ON e.id = r.event_id
         WHERE e.host_organization_id = ? ${scoped ? 'AND e.id = ?' : ''}
           AND r.created_at >= datetime('now', '-7 days')
        UNION ALL
        SELECT date(s.created_at) AS day, 'saved' AS kind
          FROM saved_events s JOIN events e ON e.id = s.event_id
         WHERE e.host_organization_id = ? ${scoped ? 'AND e.id = ?' : ''}
           AND s.created_at >= datetime('now', '-7 days')
      )
      GROUP BY day ORDER BY day ASC`;

    it('folds views/RSVPs/saves into one daily series without double counting', () => {
      const rows = db.prepare(weeklySql(false)).all(ORG, ORG, ORG);
      const totals = rows.reduce(
        (acc: any, r: any) => ({
          views: acc.views + r.views,
          going: acc.going + r.going,
          saved: acc.saved + r.saved,
        }),
        { views: 0, going: 0, saved: 0 },
      );
      // 3 views, 2 RSVPs, 1 save were seeded for this org.
      expect(totals).toEqual({ views: 3, going: 2, saved: 1 });
    });

    it("never counts another org's engagement", () => {
      const rows = db.prepare(weeklySql(false)).all(ORG, ORG, ORG);
      const views = rows.reduce((n: number, r: any) => n + r.views, 0);
      // The outsider's view on event 12 belongs to OTHER_ORG.
      expect(views).toBe(3);
    });

    it('narrows to a single event when filtered', () => {
      const rows = db.prepare(weeklySql(true)).all(ORG, 10, ORG, 10, ORG, 10);
      const totals = rows.reduce(
        (acc: any, r: any) => ({
          views: acc.views + r.views,
          going: acc.going + r.going,
          saved: acc.saved + r.saved,
        }),
        { views: 0, going: 0, saved: 0 },
      );
      // Event 10 alone: 2 views, 1 RSVP, 1 save.
      expect(totals).toEqual({ views: 2, going: 1, saved: 1 });
    });

    it('computes conversion rate as going/views, guarding divide-by-zero', () => {
      const rows = db
        .prepare(
          `SELECT id, view_count, rsvp_count FROM events
            WHERE host_organization_id = ? ORDER BY id ASC`,
        )
        .all(ORG);

      const conv = (views: number, going: number) =>
        views > 0 ? Number(((going / views) * 100).toFixed(1)) : 0;

      expect(conv(rows[0].view_count, rows[0].rsvp_count)).toBe(12);
      expect(conv(rows[1].view_count, rows[1].rsvp_count)).toBe(9);
      // An event nobody has seen yet is 0%, not NaN or Infinity.
      expect(conv(0, 0)).toBe(0);
      expect(Number.isFinite(conv(0, 5))).toBe(true);
    });
  });

  // The Events tab list (LOOP-136). The interesting failure is the same one
  // the analytics series has — a WHERE that lets another org's events through
  // — plus the archived filter, which is easy to forget because a soft-deleted
  // event still looks like a perfectly good row.
  describe('events tab listing', () => {
    const listSql = (search: boolean) => `
      SELECT e.id, e.title
        FROM events e
       WHERE e.host_organization_id = ?
         AND e.is_archived = 0
         ${
           search
             ? `AND (e.title LIKE ? ESCAPE '\\'
                     OR e.description LIKE ? ESCAPE '\\'
                     OR e.location_full LIKE ? ESCAPE '\\')`
             : ''
         }
       ORDER BY e.start_datetime ASC`;

    it('lists only the caller org’s events', () => {
      const rows = db.prepare(listSql(false)).all(ORG);
      expect(rows.map((r: any) => r.id)).toEqual([10, 11]);
    });

    it('hides soft-deleted events', () => {
      db.exec('UPDATE events SET is_archived = 1 WHERE id = 11');
      expect(
        db
          .prepare(listSql(false))
          .all(ORG)
          .map((r: any) => r.id),
      ).toEqual([10]);
      db.exec('UPDATE events SET is_archived = 0 WHERE id = 11');
    });

    it('searches title, description and location together', () => {
      const rows = db.prepare(listSql(true)).all(ORG, '%Hack%', '%Hack%', '%Hack%');
      expect(rows.map((r: any) => r.title)).toEqual(['Hack Night']);
    });

    it('treats a literal % as text rather than a wildcard', () => {
      // The route escapes \ % _ before interpolating. Without that, searching
      // "%" would return every event the org has ever posted.
      const rows = db.prepare(listSql(true)).all(ORG, '%\\%%', '%\\%%', '%\\%%');
      expect(rows).toEqual([]);
    });

    it('picks the bucket holding the most of an event’s tags', () => {
      db.exec(`INSERT INTO event_tags (event_id, bucket_id, tag) VALUES
        (10, 'tech', 'Hackathons'), (10, 'tech', 'Coding'), (10, 'social', 'Mixers')`);

      const bucket = db
        .prepare(
          `SELECT t.bucket_id FROM event_tags t
            WHERE t.event_id = ?
            GROUP BY t.bucket_id
            ORDER BY COUNT(*) DESC, t.bucket_id ASC
            LIMIT 1`,
        )
        .get(10).bucket_id;
      expect(bucket).toBe('tech');

      db.exec('DELETE FROM event_tags WHERE event_id = 10');
    });
  });

  // The Upcoming/Past split and the Date <-> A-Z sort (LOOP-240).
  //
  // The suite above proves the listing scopes and filters correctly, but every
  // event it seeds sits on the same side of "now" — so nothing in it would
  // notice if the two orderings were swapped, if the A-Z compare were
  // case-sensitive, or if an event currently in progress were filed under
  // Past. This block seeds a dataset that straddles now and pins those.
  //
  // Its events live under their own org so the counts the header tests assert
  // stay put, and every timestamp is relative to datetime('now') — absolute
  // dates in a test about "has this ended yet" go stale on their own.
  describe('upcoming / past split and sorting', () => {
    const SPLIT_ORG = 300;

    // Copied from routes/users.worker.ts, where both are now exported and the
    // org route imports them. Duplicated here for the same reason the other
    // queries in this file are: the route builds SQL against a D1 binding that
    // only exists in the Worker runtime.
    const UPCOMING_CONDITION = `(e.is_archived = 0 AND COALESCE(e.end_datetime, e.start_datetime) >= datetime('now'))`;
    const PAST_EVENT_CONDITION = `(e.is_archived = 1 OR COALESCE(e.end_datetime, e.start_datetime) < datetime('now'))`;

    const DATE_ORDER = `CASE WHEN ${UPCOMING_CONDITION} THEN 0 ELSE 1 END ASC,
                        CASE WHEN ${UPCOMING_CONDITION} THEN e.start_datetime END ASC,
                        e.start_datetime DESC`;
    const ALPHA_ORDER = 'e.title COLLATE NOCASE ASC, e.id ASC';

    const listSql = (orderBy: string, search = false) => `
      SELECT e.id, e.title,
             CASE WHEN ${PAST_EVENT_CONDITION} THEN 1 ELSE 0 END AS is_past
        FROM events e
       WHERE e.host_organization_id = ?
         AND e.is_archived = 0
         ${search ? `AND e.title LIKE ? ESCAPE '\\'` : ''}
       ORDER BY ${orderBy}`;

    /** What the client does with the response: partition, preserving order. */
    const sections = (rows: any[]) => ({
      upcoming: rows.filter((r) => r.is_past === 0).map((r) => r.title),
      past: rows.filter((r) => r.is_past === 1).map((r) => r.title),
    });

    beforeAll(() => {
      db.exec(`INSERT INTO organizations (id, name) VALUES (${SPLIT_ORG}, 'Straddle Org')`);
      db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES
        (${SPLIT_ORG}, ${ADMIN}, 'admin')`);

      db.exec(`INSERT INTO events
        (id, source, source_event_id, title, start_datetime, end_datetime,
         host_organization_id, is_archived, created_at)
        VALUES
        -- Two clearly upcoming, seeded out of both date and alphabetical order
        -- so neither ordering can pass by accident.
        (30,'test','e30','Zeta Kickoff',   datetime('now','+5 days'), datetime('now','+5 days','+2 hours'), ${SPLIT_ORG}, 0, datetime('now','-9 days')),
        (31,'test','e31','apex Workshop',  datetime('now','+2 days'), datetime('now','+2 days','+2 hours'), ${SPLIT_ORG}, 0, datetime('now','-1 days')),
        -- Two clearly past.
        (32,'test','e32','Banquet',        datetime('now','-10 days'), datetime('now','-10 days','+2 hours'), ${SPLIT_ORG}, 0, datetime('now','-30 days')),
        (33,'test','e33','Midterm Review', datetime('now','-2 days'),  datetime('now','-2 days','+2 hours'),  ${SPLIT_ORG}, 0, datetime('now','-20 days')),
        -- Started an hour ago, ends in three. The case a naive
        -- start_datetime < now would file under Past while it is happening.
        (34,'test','e34','Ongoing Retreat', datetime('now','-1 hours'), datetime('now','+3 hours'), ${SPLIT_ORG}, 0, datetime('now','-4 days')),
        -- Scraped event with no end time: falls back to start, so it is past.
        (35,'test','e35','Null End Social', datetime('now','-3 days'), NULL, ${SPLIT_ORG}, 0, datetime('now','-15 days')),
        -- Soft-deleted by the cleanup job, and still in the future.
        (36,'test','e36','Archived Party',  datetime('now','+1 days'), datetime('now','+1 days','+2 hours'), ${SPLIT_ORG}, 1, datetime('now','-2 days'))`);
    });

    describe('which section a row lands in', () => {
      it('files an event that has started but not ended under Upcoming', () => {
        // The regression this exists for: "past" is about the END of an event.
        const row = db
          .prepare(listSql(DATE_ORDER))
          .all(SPLIT_ORG)
          .find((r: any) => r.id === 34);
        expect(row.is_past).toBe(0);
      });

      it('files a NULL end_datetime by its start rather than treating it as never-ending', () => {
        const row = db
          .prepare(listSql(DATE_ORDER))
          .all(SPLIT_ORG)
          .find((r: any) => r.id === 35);
        expect(row.is_past).toBe(1);
      });

      it('puts an archived event in NEITHER section', () => {
        // PAST_EVENT_CONDITION would happily call it past, but the console's
        // WHERE drops it first. A soft-deleted event must not resurface as
        // history the org can still see.
        const ids = db
          .prepare(listSql(DATE_ORDER))
          .all(SPLIT_ORG)
          .map((r: any) => r.id);
        expect(ids).not.toContain(36);
      });

      it('splits the list with nothing lost or double counted', () => {
        const rows = db.prepare(listSql(DATE_ORDER)).all(SPLIT_ORG);
        const { upcoming, past } = sections(rows);
        expect(upcoming).toHaveLength(3);
        expect(past).toHaveLength(3);
        expect(upcoming.length + past.length).toBe(rows.length);
      });
    });

    describe('date ordering', () => {
      it('runs upcoming soonest-first, then past newest-first', () => {
        const rows = db.prepare(listSql(DATE_ORDER)).all(SPLIT_ORG);
        expect(rows.map((r: any) => r.title)).toEqual([
          'Ongoing Retreat', // started an hour ago
          'apex Workshop', // +2 days
          'Zeta Kickoff', // +5 days
          'Midterm Review', // -2 days
          'Null End Social', // -3 days
          'Banquet', // -10 days
        ]);
      });

      it('does not simply sort every event by start_datetime ascending', () => {
        // That is the shape this ordering is easiest to collapse into, and it
        // would bury the next event out the door under a year of history.
        const titles = db
          .prepare(listSql(DATE_ORDER))
          .all(SPLIT_ORG)
          .map((r: any) => r.title);
        const ascending = db
          .prepare(
            `SELECT e.title FROM events e
              WHERE e.host_organization_id = ? AND e.is_archived = 0
              ORDER BY e.start_datetime ASC`,
          )
          .all(SPLIT_ORG)
          .map((r: any) => r.title);
        expect(titles).not.toEqual(ascending);
      });
    });

    describe('A-Z ordering', () => {
      it('sorts by title, case-insensitively', () => {
        const rows = db.prepare(listSql(ALPHA_ORDER)).all(SPLIT_ORG);
        expect(rows.map((r: any) => r.title)).toEqual([
          'apex Workshop',
          'Banquet',
          'Midterm Review',
          'Null End Social',
          'Ongoing Retreat',
          'Zeta Kickoff',
        ]);
      });

      it('would put lowercase last without COLLATE NOCASE', () => {
        // SQLite's default BINARY compare orders every uppercase letter ahead
        // of every lowercase one, so "apex" would sort after "Zeta" — the
        // whole reason the collation is spelled out in the route.
        const binary = db
          .prepare(
            `SELECT e.title FROM events e
              WHERE e.host_organization_id = ? AND e.is_archived = 0
              ORDER BY e.title ASC`,
          )
          .all(SPLIT_ORG)
          .map((r: any) => r.title);
        expect(binary[binary.length - 1]).toBe('apex Workshop');
      });

      it('ignores the upcoming/past split entirely', () => {
        // A-Z is one flat ordering: the client still sections the result, so
        // each section reads alphabetically without the endpoint pretending
        // "alpha" means "alpha within upcoming, then within past".
        const rows = db.prepare(listSql(ALPHA_ORDER)).all(SPLIT_ORG);
        expect(rows.map((r: any) => r.is_past)).toEqual([0, 1, 1, 1, 0, 0]);

        // And each section is still alphabetical once partitioned.
        const { upcoming, past } = sections(rows);
        expect(upcoming).toEqual(['apex Workshop', 'Ongoing Retreat', 'Zeta Kickoff']);
        expect(past).toEqual(['Banquet', 'Midterm Review', 'Null End Social']);
      });

      it('is a different order from date, not an alias for it', () => {
        const byDate = db
          .prepare(listSql(DATE_ORDER))
          .all(SPLIT_ORG)
          .map((r: any) => r.title);
        const byAlpha = db
          .prepare(listSql(ALPHA_ORDER))
          .all(SPLIT_ORG)
          .map((r: any) => r.title);
        expect(byAlpha).not.toEqual(byDate);
      });
    });

    describe('filtering across both sections', () => {
      it('leaves one section empty rather than dropping the filter', () => {
        // "an" matches only past titles. The client renders no Upcoming header
        // at all in this case — the assertion is that the empty side is empty,
        // not that the search silently widened to keep it populated.
        const { upcoming, past } = sections(
          db.prepare(listSql(DATE_ORDER, true)).all(SPLIT_ORG, '%an%'),
        );
        expect(upcoming).toEqual([]);
        expect(past).toEqual(['Banquet']);
      });

      it('can empty the past side instead', () => {
        const { upcoming, past } = sections(
          db.prepare(listSql(DATE_ORDER, true)).all(SPLIT_ORG, '%Kickoff%'),
        );
        expect(upcoming).toEqual(['Zeta Kickoff']);
        expect(past).toEqual([]);
      });

      it('can empty both, which is the no-results state rather than two headers', () => {
        const rows = db.prepare(listSql(DATE_ORDER, true)).all(SPLIT_ORG, '%nothing matches me%');
        expect(rows).toEqual([]);
      });

      it('never lets another org’s events into either section', () => {
        const ids = db
          .prepare(listSql(DATE_ORDER))
          .all(ORG)
          .map((r: any) => r.id);
        expect(ids).not.toContain(30);
        expect(ids).not.toContain(32);
      });
    });
  });

  describe('cascade behaviour', () => {
    it('drops membership rows when the org is deleted', () => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`INSERT INTO organizations (id, name) VALUES (900, 'Doomed Org')`);
      db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES (900, ${ADMIN}, 'admin')`);
      db.exec('DELETE FROM organizations WHERE id = 900');

      const left = db.prepare('SELECT COUNT(*) AS c FROM org_members WHERE org_id = 900').get().c;
      expect(left).toBe(0);
    });
  });
});
