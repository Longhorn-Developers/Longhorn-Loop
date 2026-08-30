/**
 * DELETE /events/:id and POST /events/:id/announcements — the two destructive
 * halves of the Manage Event sheet.
 *
 * Delete sets `status = 'cancelled'`. It does NOT archive and does NOT drop the
 * row: is_archived cannot tell an attendee that an event was cancelled apart
 * from one that merely expired, and someone who RSVP'd deserves that
 * distinction (LOOP-277).
 *
 * Same harness as test_events_patch.ts: the REAL Hono handlers against a REAL
 * SQLite database built from schema.sql, through a thin D1 shim. That matters
 * more here than anywhere else in the suite, because every claim worth making
 * about delete is a claim about state the response does not show you.
 *
 * The response to a successful delete is `{ ok: true }` whether the event was
 * archived, hard-deleted, or left untouched while somebody else's event
 * disappeared. So the assertions below are about the database:
 *
 *   - the row still EXISTS and is archived, rather than being deleted, because
 *     a hard delete would cascade through RSVPs, saves and notifications and
 *     take the "your event was cancelled" notice down with it;
 *   - the audience — RSVP'd *and* saved, deduped — each got exactly one
 *     notification;
 *   - a second delete notifies nobody, since double-tapping a slow button
 *     should not tell everyone their event was cancelled twice.
 *
 * And the authorization cases, which look identical to a client either way:
 * an outsider and a rival org's editor must not be able to archive an event
 * they can't edit. Delete reuses canEditEvent precisely so this can never be
 * looser than the pencil, and these lock that together.
 *
 * Skips below Node 22 (node:sqlite), same as its siblings.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventRoutes } from '../../src/routes/events.worker';
import type { Env } from '../../src/worker';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const JWT_SECRET = 'test-secret';

const ORG = 100;
const OTHER_ORG = 200;

const ADMIN = 1;
const EDITOR = 2;
const OUTSIDER = 3;
const RIVAL = 4;
const CREATOR = 5;
const ATTENDEE = 6; // RSVP'd
const SAVER = 7; // saved only
const BOTH = 8; // RSVP'd AND saved -- must be notified once, not twice

const EMAIL: Record<number, string> = {
  [ADMIN]: 'admin@utexas.edu',
  [EDITOR]: 'editor@utexas.edu',
  [OUTSIDER]: 'outsider@utexas.edu',
  [RIVAL]: 'rival@utexas.edu',
  [CREATOR]: 'creator@utexas.edu',
  [ATTENDEE]: 'attendee@utexas.edu',
  [SAVER]: 'saver@utexas.edu',
  [BOTH]: 'both@utexas.edu',
};

const ORG_EVENT = 10;
const PERSONAL_EVENT = 12;

class SqliteD1Statement {
  private params: unknown[] = [];

  constructor(
    private readonly db: any,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    this.params = params;
    return this;
  }

  async first(): Promise<Record<string, unknown> | null> {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }

  async all(): Promise<{ results: Record<string, unknown>[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
    const result = this.db.prepare(this.sql).run(...this.params);
    return {
      meta: {
        last_row_id: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.changes ?? 0),
      },
    };
  }
}

class SqliteD1 {
  constructor(private readonly db: any) {}
  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.db, sql);
  }
}

async function signJwt(email: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '');
  return `${signingInput}.${sigB64}`;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('Manage Event: delete + announcements', () => {
  let db: any;
  let env: Env;

  const row = (id: number): Record<string, any> =>
    db.prepare('SELECT * FROM events WHERE id = ?').get(id);

  const notifications = (): Record<string, any>[] =>
    db.prepare('SELECT * FROM notifications ORDER BY user_id').all();

  async function del(eventId: number | string, userId?: number): Promise<Response> {
    const token = userId === undefined ? null : await signJwt(EMAIL[userId]);
    return eventRoutes.request(
      `http://longhorn-loop.test/${eventId}`,
      {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      },
      env,
    );
  }

  async function announce(
    eventId: number | string,
    body: Record<string, unknown> | null,
    userId?: number,
  ): Promise<Response> {
    const token = userId === undefined ? null : await signJwt(EMAIL[userId]);
    return eventRoutes.request(
      `http://longhorn-loop.test/${eventId}/announcements`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    );
  }

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${ADMIN}, '${EMAIL[ADMIN]}', 'Ada', 'Admin'),
      (${EDITOR}, '${EMAIL[EDITOR]}', 'Eli', 'Editor'),
      (${OUTSIDER}, '${EMAIL[OUTSIDER]}', 'No', 'Body'),
      (${RIVAL}, '${EMAIL[RIVAL]}', 'Rex', 'Rival'),
      (${CREATOR}, '${EMAIL[CREATOR]}', 'Cam', 'Creator'),
      (${ATTENDEE}, '${EMAIL[ATTENDEE]}', 'Ann', 'Attendee'),
      (${SAVER}, '${EMAIL[SAVER]}', 'Sam', 'Saver'),
      (${BOTH}, '${EMAIL[BOTH]}', 'Bo', 'Both')`);

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${ORG}, 'Longhorn Devs'), (${OTHER_ORG}, 'Unrelated Org')`);

    db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES
      (${ORG}, ${ADMIN}, 'admin'),
      (${ORG}, ${EDITOR}, 'editor'),
      (${OTHER_ORG}, ${RIVAL}, 'editor')`);

    db.exec(`INSERT INTO events
      (id, source, source_event_id, title, start_datetime,
       host_organization_id, host_organization_name, created_by_user_id)
      VALUES
      (${ORG_EVENT}, 'user_created', 'e10', 'General Meeting', '2099-01-01T18:00:00',
       ${ORG}, 'Longhorn Devs', NULL),
      (${PERSONAL_EVENT}, 'user_created', 'e12', 'Study Jam', '2099-01-01T18:00:00',
       NULL, 'Cam', ${CREATOR})`);

    // Audience for ORG_EVENT: one RSVP, one save, one person who did both.
    db.exec(`INSERT INTO event_rsvps (event_id, user_id) VALUES
      (${ORG_EVENT}, ${ATTENDEE}), (${ORG_EVENT}, ${BOTH})`);
    db.exec(`INSERT INTO saved_events (event_id, user_id) VALUES
      (${ORG_EVENT}, ${SAVER}), (${ORG_EVENT}, ${BOTH})`);

    env = { DB: new SqliteD1(db), JWT_SECRET } as unknown as Env;
  });

  describe('DELETE /events/:id', () => {
    it('cancels rather than deleting, so the row and its RSVPs survive', async () => {
      const res = await del(ORG_EVENT, ADMIN);
      expect(res.status).toBe(200);

      const after = row(ORG_EVENT);
      expect(after).toBeDefined();
      expect(after.status).toBe('cancelled');
      // Explicitly NOT archived. Archiving is what the cleanup job does to
      // events that have simply expired, and conflating the two is the bug
      // this endpoint was rewritten to avoid.
      expect(after.is_archived).toBe(0);

      // A hard delete would have cascaded these away.
      const rsvps = db
        .prepare('SELECT COUNT(*) AS c FROM event_rsvps WHERE event_id = ?')
        .get(ORG_EVENT);
      expect(rsvps.c).toBe(2);
    });

    it('notifies the RSVP and save audience exactly once each', async () => {
      const res = await del(ORG_EVENT, ADMIN);
      expect((await res.json()).notified).toBe(3);

      const rows = notifications();
      expect(rows.map((r) => r.user_id)).toEqual([ATTENDEE, SAVER, BOTH]);
      // BOTH rsvp'd AND saved. One notification, not two.
      expect(rows).toHaveLength(3);
      expect(rows[0].type).toBe('event_cancelled');
      expect(rows[0].event_id).toBe(ORG_EVENT);
    });

    it('is idempotent: a second delete notifies nobody again', async () => {
      await del(ORG_EVENT, ADMIN);
      const before = notifications().length;

      const res = await del(ORG_EVENT, ADMIN);
      expect(res.status).toBe(200);
      expect((await res.json()).alreadyCancelled).toBe(true);
      expect(notifications()).toHaveLength(before);
    });

    it('lets an org editor delete, matching who may edit', async () => {
      expect((await del(ORG_EVENT, EDITOR)).status).toBe(200);
      expect(row(ORG_EVENT).status).toBe('cancelled');
    });

    it('lets the creator delete their own personal event', async () => {
      expect((await del(PERSONAL_EVENT, CREATOR)).status).toBe(200);
      expect(row(PERSONAL_EVENT).status).toBe('cancelled');
    });

    it('refuses an outsider, a rival org editor, and the anonymous caller', async () => {
      expect((await del(ORG_EVENT, OUTSIDER)).status).toBe(403);
      expect((await del(ORG_EVENT, RIVAL)).status).toBe(403);
      expect((await del(ORG_EVENT)).status).toBe(401);
      // Nothing moved, and nobody was told anything.
      expect(row(ORG_EVENT).status).toBe('active');
      expect(notifications()).toHaveLength(0);
    });

    it('404s an event that does not exist', async () => {
      expect((await del(9999, ADMIN)).status).toBe(404);
    });
  });

  describe('POST /events/:id/announcements', () => {
    it('stores the announcement and notifies the audience', async () => {
      const res = await announce(ORG_EVENT, { body: 'Room change: BLT 2.503' }, ADMIN);
      expect(res.status).toBe(200);
      expect((await res.json()).notified).toBe(3);

      const stored = db.prepare('SELECT * FROM event_announcements').all();
      expect(stored).toHaveLength(1);
      expect(stored[0].body).toBe('Room change: BLT 2.503');
      expect(stored[0].notify).toBe(1);
      expect(stored[0].author_user_id).toBe(ADMIN);

      const rows = notifications();
      expect(rows).toHaveLength(3);
      expect(rows[0].type).toBe('event_announcement');
      expect(rows[0].subtitle).toBe('Room change: BLT 2.503');
    });

    it('notify:false still stores it, but tells nobody', async () => {
      const res = await announce(ORG_EVENT, { body: 'Minor note', notify: false }, ADMIN);
      expect((await res.json()).notified).toBe(0);

      expect(db.prepare('SELECT * FROM event_announcements').all()).toHaveLength(1);
      expect(notifications()).toHaveLength(0);
    });

    it('rejects empty, whitespace-only and over-length bodies', async () => {
      expect((await announce(ORG_EVENT, { body: '' }, ADMIN)).status).toBe(400);
      expect((await announce(ORG_EVENT, { body: '   ' }, ADMIN)).status).toBe(400);
      expect((await announce(ORG_EVENT, { body: 'x'.repeat(201) }, ADMIN)).status).toBe(400);
      expect(db.prepare('SELECT * FROM event_announcements').all()).toHaveLength(0);
    });

    it('refuses anyone who could not edit the event', async () => {
      expect((await announce(ORG_EVENT, { body: 'hi' }, OUTSIDER)).status).toBe(403);
      expect((await announce(ORG_EVENT, { body: 'hi' }, RIVAL)).status).toBe(403);
      expect((await announce(ORG_EVENT, { body: 'hi' })).status).toBe(401);
      expect(notifications()).toHaveLength(0);
    });

    it('refuses a cancelled event -- it has nothing left to announce', async () => {
      await del(ORG_EVENT, ADMIN);
      const res = await announce(ORG_EVENT, { body: 'still on!' }, ADMIN);
      expect(res.status).toBe(409);
    });
  });
});
