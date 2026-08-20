/**
 * Account deletion cascade (LOOP-131), executed against a real SQLite database
 * built from server/schema.sql.
 *
 * Unlike test_org_console_sql.ts, this does NOT re-type the route's SQL. The
 * statements live in src/lib/accountDeletion.ts precisely so they can be
 * imported and run here — that module touches nothing from the Worker runtime.
 * A hand-copied paraphrase would be worse than no test: the copy would keep
 * passing after someone edited the real cascade.
 *
 * The cases that earn their keep are the negative ones. "It deleted the user"
 * is trivially true of `DELETE FROM users`; what actually goes wrong is
 * collateral — another student's RSVPs disappearing, an org's event history
 * vanishing with the editor who posted it, a counter left advertising
 * attendees who no longer exist, or a mistyped code taking the account anyway.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DELETE_CODE_MAX_ATTEMPTS,
  ORG_SUCCESSION_QUERY,
  type OrgAdminSuccession,
  type SqlStatement,
  accountDeletionStatements,
  checkDeletionCode,
  deleteAccountCodeKey,
  hashCode,
} from '../src/lib/accountDeletion';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

// The departing user, and a bystander whose data must survive untouched.
const LEAVER = 1;
const LEAVER_EMAIL = 'leaver@utexas.edu';
const BYSTANDER = 2;
const BYSTANDER_EMAIL = 'stays@utexas.edu';
const EDITOR_OLD = 3;
const EDITOR_NEW = 4;
const CO_ADMIN = 5;

const ORG = 100; // leaver is sole admin, has editors
const ORG_SHARED = 200; // leaver shares admin with CO_ADMIN
const ORG_ALONE = 300; // leaver is the only member at all

// Events: one hosted by an org, one the leaver created with no org, one that
// belongs entirely to the bystander.
const EVENT_ORG = 10;
const EVENT_SOLO = 11;
const EVENT_OTHER = 12;

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('account deletion cascade (LOOP-131)', () => {
  let db: any;

  const run = (statements: SqlStatement[]) => {
    for (const s of statements) db.prepare(s.sql).run(...(s.binds as any[]));
  };

  const count = (sql: string, ...binds: any[]): number =>
    db.prepare(`SELECT COUNT(*) AS c FROM ${sql}`).get(...binds).c;

  const event = (id: number) => db.prepare('SELECT * FROM events WHERE id = ?').get(id);

  /** Reads the org-succession facts the route reads, the way the route reads them. */
  const succession = (userId: number): OrgAdminSuccession[] =>
    db
      .prepare(ORG_SUCCESSION_QUERY)
      .all(userId, userId, userId)
      .map((row: any) => ({
        orgId: Number(row.org_id),
        otherAdmins: Number(row.other_admins),
        successorUserId: row.successor_user_id === null ? null : Number(row.successor_user_id),
      }));

  /** The whole flow, as the confirm route runs it. */
  const deleteLeaver = () =>
    run(accountDeletionStatements(LEAVER, LEAVER_EMAIL, succession(LEAVER)));

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));

    // Foreign keys OFF, deliberately, and this is the whole point of the file.
    //
    // node:sqlite enables them by default, which would make SQLite's own
    // ON DELETE CASCADE clean up most of these tables the instant the users
    // row went — and every "it removed X" assertion below would pass whether
    // or not the shipped statement for X exists. D1 gives no guarantee the
    // pragma is on, so the cascade has to be complete on its own. Turning FKs
    // off is what makes these tests measure the code instead of SQLite.
    // (The 'survives with FKs on' case at the bottom covers the other half:
    // that the statement ORDER doesn't violate a constraint when they ARE on.)
    db.exec('PRAGMA foreign_keys = OFF');

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${LEAVER},     '${LEAVER_EMAIL}',     'Lee',  'Leaver'),
      (${BYSTANDER},  '${BYSTANDER_EMAIL}',  'Bee',  'Stander'),
      (${EDITOR_OLD}, 'oldeditor@utexas.edu','Olive','Editor'),
      (${EDITOR_NEW}, 'neweditor@utexas.edu','Newt', 'Editor'),
      (${CO_ADMIN},   'coadmin@utexas.edu',  'Cody', 'Admin')`);

    db.exec(`INSERT INTO organizations (id, name, verified, verification_status) VALUES
      (${ORG},        'Longhorn Devs', 1, 'pending_review'),
      (${ORG_SHARED}, 'Shared Org',    1, 'pending_review'),
      (${ORG_ALONE},  'Lonely Org',    1, 'pending_review')`);

    db.exec(`INSERT INTO org_members (org_id, user_id, role, created_at) VALUES
      (${ORG},        ${LEAVER},     'admin',  '2026-01-01 00:00:00'),
      (${ORG},        ${EDITOR_NEW}, 'editor', '2026-06-01 00:00:00'),
      (${ORG},        ${EDITOR_OLD}, 'editor', '2026-02-01 00:00:00'),
      (${ORG_SHARED}, ${LEAVER},     'admin',  '2026-01-01 00:00:00'),
      (${ORG_SHARED}, ${CO_ADMIN},   'admin',  '2026-03-01 00:00:00'),
      (${ORG_ALONE},  ${LEAVER},     'admin',  '2026-01-01 00:00:00')`);

    db.exec(`INSERT INTO events
        (id, source, source_event_id, title, start_datetime, host_organization_id,
         created_by_user_id, rsvp_count, save_count, view_count)
      VALUES
        (${EVENT_ORG},   'app', 'e-org',   'Org Night',   '2099-01-01T00:00:00Z', ${ORG},  ${LEAVER},    2, 2, 2),
        (${EVENT_SOLO},  'app', 'e-solo',  'Solo Picnic', '2099-01-02T00:00:00Z', NULL,    ${LEAVER},    2, 1, 1),
        (${EVENT_OTHER}, 'app', 'e-other', 'Their Event', '2099-01-03T00:00:00Z', NULL,    ${BYSTANDER}, 1, 1, 1)`);

    // Both users engage with the same events, so any over-broad WHERE shows up
    // as the bystander's rows disappearing.
    db.exec(`INSERT INTO event_rsvps (user_id, event_id) VALUES
      (${LEAVER}, ${EVENT_ORG}), (${LEAVER}, ${EVENT_SOLO}),
      (${BYSTANDER}, ${EVENT_ORG}), (${BYSTANDER}, ${EVENT_SOLO}),
      (${BYSTANDER}, ${EVENT_OTHER})`);
    db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES
      (${LEAVER}, ${EVENT_ORG}), (${LEAVER}, ${EVENT_SOLO}),
      (${BYSTANDER}, ${EVENT_ORG}), (${BYSTANDER}, ${EVENT_OTHER})`);
    db.exec(`INSERT INTO event_views (user_id, event_id) VALUES
      (${LEAVER}, ${EVENT_ORG}), (${LEAVER}, ${EVENT_SOLO}),
      (${BYSTANDER}, ${EVENT_ORG}), (${BYSTANDER}, ${EVENT_OTHER})`);

    db.exec(`INSERT INTO event_reports (user_id, event_id, reasons, description) VALUES
      (${LEAVER}, ${EVENT_OTHER}, '["spam"]', 'nope'),
      (${BYSTANDER}, ${EVENT_SOLO}, '["spam"]', 'also nope')`);

    db.exec(`INSERT INTO user_socials (user_id, platform, url) VALUES
      (${LEAVER}, 'instagram', 'https://instagram.com/leaver'),
      (${BYSTANDER}, 'instagram', 'https://instagram.com/stays')`);
    db.exec(`INSERT INTO user_majors (user_id, major) VALUES
      (${LEAVER}, 'CS'), (${BYSTANDER}, 'CS')`);
    db.exec(`INSERT INTO user_tags (user_id, tag) VALUES
      (${LEAVER}, 'music'), (${BYSTANDER}, 'music')`);
    db.exec(`INSERT INTO user_settings (user_id, dark_mode) VALUES
      (${LEAVER}, 1), (${BYSTANDER}, 1)`);
    db.exec(`INSERT INTO notifications (user_id, title) VALUES
      (${LEAVER}, 'Hello'), (${BYSTANDER}, 'Hello')`);
    db.exec(`INSERT INTO org_followers (org_id, user_id) VALUES
      (${ORG}, ${LEAVER}), (${ORG}, ${BYSTANDER})`);

    // Follows in both directions, plus one between two other people.
    db.exec(`INSERT INTO user_follows (follower_user_id, followed_user_id) VALUES
      (${LEAVER}, ${BYSTANDER}),
      (${BYSTANDER}, ${LEAVER}),
      (${BYSTANDER}, ${CO_ADMIN})`);

    // An invite TO the leaver, and one the leaver SENT to somebody else.
    db.exec(`INSERT INTO org_invites (org_id, email, role, invited_by) VALUES
      (${ORG_SHARED}, '${LEAVER_EMAIL}', 'editor', ${CO_ADMIN}),
      (${ORG}, 'someone@utexas.edu', 'editor', ${LEAVER})`);

    db.exec(`INSERT INTO feedback (user_id, kind, message) VALUES
      (${LEAVER}, 'bug', 'It broke')`);

    // A login code, this flow's delete code, an org-claim code, and the
    // bystander's login code.
    db.prepare(
      `INSERT INTO verification_codes (email, code_hash, expires_at, last_sent_at)
       VALUES (?, 'h', 9999999999999, 0)`,
    ).run(LEAVER_EMAIL);
    db.prepare(
      `INSERT INTO verification_codes (email, code_hash, expires_at, last_sent_at)
       VALUES (?, 'h', 9999999999999, 0)`,
    ).run(deleteAccountCodeKey(LEAVER_EMAIL));
    db.prepare(
      `INSERT INTO verification_codes (email, code_hash, expires_at, last_sent_at)
       VALUES (?, 'h', 9999999999999, 0)`,
    ).run(`org:${ORG}:${LEAVER_EMAIL}`);
    db.prepare(
      `INSERT INTO verification_codes (email, code_hash, expires_at, last_sent_at)
       VALUES (?, 'h', 9999999999999, 0)`,
    ).run(BYSTANDER_EMAIL);
  });

  describe('the user is gone', () => {
    it('removes the users row and every table hanging off it', () => {
      deleteLeaver();

      expect(count('users WHERE id = ?', LEAVER)).toBe(0);
      for (const table of [
        'event_rsvps',
        'saved_events',
        'event_views',
        'event_reports',
        'notifications',
        'user_socials',
        'user_majors',
        'user_tags',
        'user_settings',
        'org_followers',
        'org_members',
      ]) {
        expect({ table, rows: count(`${table} WHERE user_id = ?`, LEAVER) }).toEqual({
          table,
          rows: 0,
        });
      }
    });

    it('removes follows in BOTH directions', () => {
      deleteLeaver();
      expect(count('user_follows WHERE follower_user_id = ?', LEAVER)).toBe(0);
      // The one that is easy to miss: people who followed THEM.
      expect(count('user_follows WHERE followed_user_id = ?', LEAVER)).toBe(0);
      // Unrelated follows are untouched.
      expect(count('user_follows WHERE follower_user_id = ?', BYSTANDER)).toBe(1);
    });

    it('removes pending invites addressed to them, by email', () => {
      // org_invites is keyed by email, not user_id — an invite written before
      // the invitee had an account is only reachable by address.
      deleteLeaver();
      expect(count('org_invites WHERE LOWER(email) = ?', LEAVER_EMAIL)).toBe(0);
    });

    it('keeps invites they sent, with the sender detached', () => {
      deleteLeaver();
      const invite = db
        .prepare("SELECT * FROM org_invites WHERE email = 'someone@utexas.edu'")
        .get();
      // Revoking a pending invite because the inviter left would silently
      // disband a team the org still wants.
      expect(invite).toBeDefined();
      expect(invite.invited_by).toBeNull();
      expect(invite.status).toBe('pending');
    });

    it('clears every verification code for the address, in all three namespaces', () => {
      deleteLeaver();
      expect(count('verification_codes WHERE email = ?', LEAVER_EMAIL)).toBe(0);
      expect(count('verification_codes WHERE email = ?', deleteAccountCodeKey(LEAVER_EMAIL))).toBe(
        0,
      );
      expect(count('verification_codes WHERE email = ?', `org:${ORG}:${LEAVER_EMAIL}`)).toBe(0);
      // A live code left behind could be redeemed against a recycled address.
      expect(count('verification_codes')).toBe(1);
    });

    it('keeps their feedback, detached', () => {
      deleteLeaver();
      const row = db.prepare("SELECT * FROM feedback WHERE kind = 'bug'").get();
      // A bug report must not vanish the moment the reporter leaves — that's
      // exactly when the team still needs it (schema.sql says so too).
      expect(row).toBeDefined();
      expect(row.user_id).toBeNull();
      expect(row.message).toBe('It broke');
    });
  });

  describe('nobody else is touched', () => {
    it("leaves the bystander's rows exactly as they were", () => {
      deleteLeaver();

      expect(count('users WHERE id = ?', BYSTANDER)).toBe(1);
      expect(count('event_rsvps WHERE user_id = ?', BYSTANDER)).toBe(3);
      expect(count('saved_events WHERE user_id = ?', BYSTANDER)).toBe(2);
      expect(count('event_views WHERE user_id = ?', BYSTANDER)).toBe(2);
      expect(count('event_reports WHERE user_id = ?', BYSTANDER)).toBe(1);
      expect(count('user_socials WHERE user_id = ?', BYSTANDER)).toBe(1);
      expect(count('user_majors WHERE user_id = ?', BYSTANDER)).toBe(1);
      expect(count('user_tags WHERE user_id = ?', BYSTANDER)).toBe(1);
      expect(count('user_settings WHERE user_id = ?', BYSTANDER)).toBe(1);
      expect(count('notifications WHERE user_id = ?', BYSTANDER)).toBe(1);
      expect(count('org_followers WHERE user_id = ?', BYSTANDER)).toBe(1);
      expect(count('verification_codes WHERE email = ?', BYSTANDER_EMAIL)).toBe(1);
    });

    it('leaves an event that was never theirs completely alone', () => {
      const before = event(EVENT_OTHER);
      deleteLeaver();
      const after = event(EVENT_OTHER);

      expect(after.created_by_user_id).toBe(BYSTANDER);
      expect(after.is_archived).toBe(0);
      expect(after.rsvp_count).toBe(before.rsvp_count);
      expect(after.save_count).toBe(before.save_count);
      expect(after.view_count).toBe(before.view_count);
    });
  });

  describe("events the user created don't vanish", () => {
    it('leaves an org-hosted event with the org, detached from the author', () => {
      deleteLeaver();
      const e = event(EVENT_ORG);

      expect(e).toBeDefined();
      expect(e.created_by_user_id).toBeNull();
      expect(e.host_organization_id).toBe(ORG);
      // The org still owns it, so it stays in feeds.
      expect(e.is_archived).toBe(0);
    });

    it('archives an event with no org rather than deleting it', () => {
      deleteLeaver();
      const e = event(EVENT_SOLO);

      // Nobody is left who could edit or cancel it, so it leaves the feeds —
      // but the people who RSVP'd keep it in their history (LOOP-200).
      expect(e).toBeDefined();
      expect(e.created_by_user_id).toBeNull();
      expect(e.is_archived).toBe(1);
      expect(e.archived_at).not.toBeNull();
    });

    it('does not rewrite archived_at on an event the cleanup job already archived', () => {
      db.exec(
        `UPDATE events SET is_archived = 1, archived_at = '2020-01-01 00:00:00' WHERE id = ${EVENT_SOLO}`,
      );
      deleteLeaver();
      expect(event(EVENT_SOLO).archived_at).toBe('2020-01-01 00:00:00');
    });
  });

  describe('denormalized counters', () => {
    it('drops each counter by exactly the rows removed, and no further', () => {
      deleteLeaver();

      // EVENT_ORG had 2 RSVPs (leaver + bystander); one leaves.
      const org = event(EVENT_ORG);
      expect(org.rsvp_count).toBe(1);
      expect(org.save_count).toBe(1);
      expect(org.view_count).toBe(1);

      // EVENT_SOLO: the leaver's save/view were the only ones.
      const solo = event(EVENT_SOLO);
      expect(solo.rsvp_count).toBe(1);
      expect(solo.save_count).toBe(0);
      expect(solo.view_count).toBe(0);
    });

    it('leaves counters agreeing with the rows that remain', () => {
      deleteLeaver();
      for (const [counter, table] of [
        ['rsvp_count', 'event_rsvps'],
        ['save_count', 'saved_events'],
        ['view_count', 'event_views'],
      ]) {
        const rows = db
          .prepare(
            `SELECT e.id, e.${counter} AS counter,
                    (SELECT COUNT(*) FROM ${table} t WHERE t.event_id = e.id) AS actual
             FROM events e`,
          )
          .all();
        for (const r of rows) {
          expect({ counter, id: r.id, value: r.counter }).toEqual({
            counter,
            id: r.id,
            value: r.actual,
          });
        }
      }
    });

    it('never drives a counter negative', () => {
      // A counter that has already drifted below the true row count must not
      // be pushed further down by the compensation.
      db.exec(`UPDATE events SET save_count = 0 WHERE id = ${EVENT_SOLO}`);
      deleteLeaver();
      expect(event(EVENT_SOLO).save_count).toBe(0);
    });
  });

  describe('orgs are never orphaned', () => {
    const roleOf = (orgId: number, userId: number): string | null =>
      db.prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?').get(orgId, userId)
        ?.role ?? null;

    const adminCount = (orgId: number): number =>
      count("org_members WHERE org_id = ? AND role = 'admin'", orgId);

    it('promotes the LONGEST-SERVING editor when the sole admin leaves', () => {
      deleteLeaver();
      // EDITOR_OLD joined in February, EDITOR_NEW in June. Seniority wins, and
      // the seed inserts them in the opposite order so row order can't be what
      // decides it.
      expect(roleOf(ORG, EDITOR_OLD)).toBe('admin');
      expect(roleOf(ORG, EDITOR_NEW)).toBe('editor');
      expect(adminCount(ORG)).toBe(1);
    });

    it('promotes nobody when another admin remains', () => {
      deleteLeaver();
      expect(roleOf(ORG_SHARED, CO_ADMIN)).toBe('admin');
      expect(adminCount(ORG_SHARED)).toBe(1);
    });

    it('returns an org with no members left to unclaimed, and keeps the org', () => {
      deleteLeaver();
      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(ORG_ALONE);

      // The org row is scraped from HornsLink and exists independently of any
      // account, so it stays — but leaving it flagged claimed-and-verified
      // with zero members is a state no one can recover through the UI.
      expect(org).toBeDefined();
      expect(org.verified).toBe(0);
      expect(org.verification_status).toBe('unverified');
      expect(count('org_members WHERE org_id = ?', ORG_ALONE)).toBe(0);
    });

    it('leaves a claimed org with a surviving admin verified', () => {
      deleteLeaver();
      const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(ORG_SHARED);
      expect(org.verified).toBe(1);
      expect(org.verification_status).toBe('pending_review');
    });

    it('breaks a seniority tie deterministically by user id', () => {
      db.exec(`UPDATE org_members SET created_at = '2026-02-01 00:00:00'
               WHERE org_id = ${ORG} AND user_id = ${EDITOR_NEW}`);
      deleteLeaver();
      expect(roleOf(ORG, EDITOR_OLD)).toBe('admin');
      expect(roleOf(ORG, EDITOR_NEW)).toBe('editor');
    });

    it('never leaves an org this user administered with zero admins', () => {
      deleteLeaver();
      for (const orgId of [ORG, ORG_SHARED]) {
        expect({ orgId, admins: adminCount(orgId) }).toEqual({ orgId, admins: 1 });
      }
    });
  });

  describe('with foreign keys enforced', () => {
    it('runs in order without violating a constraint, and still empties the account', () => {
      // The other half of the pragma story. With FKs ON, a cascade that
      // deleted the users row before detaching feedback.user_id — or promoted
      // an admin after emptying org_members — would throw here.
      db.exec('PRAGMA foreign_keys = ON');
      expect(() => deleteLeaver()).not.toThrow();

      expect(count('users WHERE id = ?', LEAVER)).toBe(0);
      expect(count('users WHERE id = ?', BYSTANDER)).toBe(1);
      expect(event(EVENT_ORG).host_organization_id).toBe(ORG);
      expect(
        db.prepare("SELECT user_id FROM feedback WHERE kind = 'bug'").get().user_id,
      ).toBeNull();
    });
  });

  describe('a wrong code deletes nothing', () => {
    const CODE = '482915';
    const snapshot = () => ({
      users: count('users'),
      rsvps: count('event_rsvps'),
      events: count('events'),
      members: count('org_members'),
      soloArchived: event(EVENT_SOLO).is_archived,
      orgRsvpCount: event(EVENT_ORG).rsvp_count,
    });

    /** The confirm route, minus the HTTP: check, then cascade only if it passed. */
    const attempt = async (submitted: string, now = Date.now()) => {
      const key = deleteAccountCodeKey(LEAVER_EMAIL);
      const record = db
        .prepare('SELECT code_hash, expires_at, attempts FROM verification_codes WHERE email = ?')
        .get(key);
      const check = checkDeletionCode(record ?? null, await hashCode(submitted), now);

      if (!check.ok) {
        if (check.voids) db.prepare('DELETE FROM verification_codes WHERE email = ?').run(key);
        if (check.countsAsAttempt) {
          db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?').run(
            key,
          );
        }
        return check;
      }

      deleteLeaver();
      return check;
    };

    beforeEach(async () => {
      db.prepare('UPDATE verification_codes SET code_hash = ?, expires_at = ? WHERE email = ?').run(
        await hashCode(CODE),
        Date.now() + 10 * 60 * 1000,
        deleteAccountCodeKey(LEAVER_EMAIL),
      );
    });

    it('leaves the database byte-for-byte unchanged on a mistyped code', async () => {
      const before = snapshot();
      const result = await attempt('000000');

      expect(result.ok).toBe(false);
      expect(snapshot()).toEqual(before);
    });

    it('costs an attempt, so six digits cannot be brute-forced', async () => {
      const key = deleteAccountCodeKey(LEAVER_EMAIL);
      const attempts = () =>
        db.prepare('SELECT attempts FROM verification_codes WHERE email = ?').get(key).attempts;

      for (let i = 0; i < DELETE_CODE_MAX_ATTEMPTS; i++) await attempt('000000');
      expect(attempts()).toBe(DELETE_CODE_MAX_ATTEMPTS);

      // The next try is refused before the hash is even compared, and voids
      // the request — even though this one is the RIGHT code.
      const before = snapshot();
      const result = await attempt(CODE);
      expect(result.ok).toBe(false);
      expect(snapshot()).toEqual(before);
      expect(
        db.prepare('SELECT 1 FROM verification_codes WHERE email = ?').get(key),
      ).toBeUndefined();
    });

    it('refuses an expired code without deleting anything', async () => {
      const before = snapshot();
      const result = await attempt(CODE, Date.now() + 11 * 60 * 1000);

      expect(result.ok).toBe(false);
      expect(snapshot()).toEqual(before);
    });

    it('refuses when no deletion was ever requested', async () => {
      db.prepare('DELETE FROM verification_codes WHERE email = ?').run(
        deleteAccountCodeKey(LEAVER_EMAIL),
      );
      const before = snapshot();
      const result = await attempt(CODE);

      expect(result.ok).toBe(false);
      expect(snapshot()).toEqual(before);
    });

    it('deletes on the right code', async () => {
      const result = await attempt(CODE);
      expect(result.ok).toBe(true);
      expect(count('users WHERE id = ?', LEAVER)).toBe(0);
    });

    it('cannot be satisfied by a login code for the same address', async () => {
      // The namespaced key is what stops a code emailed for SIGNING IN from
      // authorizing an irreversible deletion.
      const loginHash = db
        .prepare('SELECT code_hash FROM verification_codes WHERE email = ?')
        .get(LEAVER_EMAIL).code_hash;
      const deleteHash = db
        .prepare('SELECT code_hash FROM verification_codes WHERE email = ?')
        .get(deleteAccountCodeKey(LEAVER_EMAIL)).code_hash;

      expect(deleteAccountCodeKey(LEAVER_EMAIL)).not.toBe(LEAVER_EMAIL);
      expect(loginHash).not.toBe(deleteHash);
    });
  });
});
