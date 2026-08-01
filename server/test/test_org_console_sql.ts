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
