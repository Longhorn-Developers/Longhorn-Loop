/**
 * Public profiles, Follow and Block (LOOP-180).
 *
 * Runs the REAL Hono handlers against a REAL SQLite database built from
 * server/schema.sql through the same thin D1 shim test_events_patch.ts uses,
 * for the same reason: the contract here is "what does the database end up
 * holding, and what comes back out", and a fake that records the parameters it
 * was handed cannot answer either question.
 *
 * The weight is deliberately on the negatives, and on blocking in particular.
 * Blocking is a safety feature: someone uses it because another person is
 * making the app unpleasant or unsafe for them, and a false negative — one
 * read path that still shows the blocked party — is a real-world harm, not a
 * cosmetic bug. Every one of these failures looks fine from the blocker's
 * side, because the leak is always on somebody ELSE's screen.
 *
 * The cases that matter most:
 *   - the block is SYMMETRIC for visibility (either party is hidden from the
 *     other) but NOT for control (only the blocker can lift it);
 *   - a blocked user cannot re-follow, in either direction;
 *   - blocking drops existing follows both ways, so counts drop too;
 *   - a blocked author's events are gone from the feed, the events list and
 *     the event detail — not just from the profile grid.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard, same as its siblings.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventRoutes } from '../../src/routes/events.worker';
import { feedRoutes } from '../../src/routes/feed.worker';
import { orgRoutes } from '../../src/routes/orgs.worker';
import { savedRoutes } from '../../src/routes/saved.worker';
import { settingsRoutes } from '../../src/routes/settings.worker';
import { userRoutes } from '../../src/routes/users.worker';
import type { Env } from '../../src/worker';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const JWT_SECRET = 'test-secret';

const ME = 1; // the viewer in most cases
const TODD = 2; // "Not Todd Jenkins" — the public profile under test
const BYSTANDER = 3; // uninvolved third party, proves blocks don't spill
const ORG = 900;

const EMAIL: Record<number, string> = {
  [ME]: 'me@utexas.edu',
  [TODD]: 'todd@utexas.edu',
  [BYSTANDER]: 'by@utexas.edu',
};

const TODD_UPCOMING = 10;
const TODD_PAST = 11;
const ORG_UPCOMING = 12;
const ORG_PAST = 13;
const ORG_ARCHIVED = 14;
const SCRAPED = 15;

// ---------------------------------------------------------------------------
// D1 shim over node:sqlite (mirrors routes/test_events_patch.ts)
// ---------------------------------------------------------------------------

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

  /**
   * D1's batch() is transactional. node:sqlite has no async batch, so the
   * statements run in sequence — enough for these tests, which care that all
   * of them ran, not that a mid-batch failure rolls back.
   */
  async batch(statements: SqliteD1Statement[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const s of statements) out.push(await s.run());
    return out;
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

describeOrSkip('public profiles + Follow/Block (LOOP-180)', () => {
  let db: any;
  let env: Env;

  async function call(
    app: { request: (url: string, init: RequestInit, env: Env) => Promise<Response> },
    path: string,
    opts: { method?: string; as?: number; body?: unknown } = {},
  ): Promise<Response> {
    const token = opts.as === undefined ? null : await signJwt(EMAIL[opts.as]);
    return app.request(
      `http://longhorn-loop.test${path}`,
      {
        method: opts.method ?? 'GET',
        headers: {
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      env,
    );
  }

  const users = (path: string, opts?: Parameters<typeof call>[2]) => call(userRoutes, path, opts);
  const orgs = (path: string, opts?: Parameters<typeof call>[2]) => call(orgRoutes, path, opts);
  const events = (path: string, opts?: Parameters<typeof call>[2]) => call(eventRoutes, path, opts);
  const feed = (path: string, opts?: Parameters<typeof call>[2]) => call(feedRoutes, path, opts);
  const settings = (path: string, opts?: Parameters<typeof call>[2]) =>
    call(settingsRoutes, path, opts);

  const count = (sql: string, ...binds: unknown[]): number =>
    db.prepare(`SELECT COUNT(*) AS c FROM ${sql}`).get(...binds).c;

  const block = (blocker: number, blocked: number) =>
    users(`/${blocked}/block`, { method: 'POST', as: blocker });

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name, bio, year_classification) VALUES
      (${ME}, '${EMAIL[ME]}', 'Mel', 'Mine', 'My own bio.', 'Senior'),
      (${TODD}, '${EMAIL[TODD]}', 'Not Todd', 'Jenkins', 'Todd''s bio.', 'Junior'),
      (${BYSTANDER}, '${EMAIL[BYSTANDER]}', 'By', 'Stander', NULL, NULL)`);

    db.exec(`INSERT INTO user_majors (user_id, major) VALUES (${TODD}, 'Economics')`);
    db.exec(`INSERT INTO user_tags (user_id, tag) VALUES (${TODD}, 'Coding'), (${TODD}, 'Music')`);
    db.exec(
      `INSERT INTO user_socials (user_id, platform, url)
       VALUES (${TODD}, 'instagram', 'https://instagram.com/todd')`,
    );

    db.exec(
      `INSERT INTO organizations (id, name, profile_picture, verified, bio, category)
       VALUES (${ORG}, 'Longhorn Devs', 'https://cdn.test/org.png', 1,
               'We build things.', 'Academic')`,
    );

    // Two of Todd's own events, one either side of "now", plus an org's, plus
    // an archived org event and a scraped event with no author at all.
    db.exec(`INSERT INTO events
      (id, source, source_event_id, title, start_datetime, end_datetime,
       host_organization_id, host_organization_name, created_by_user_id,
       is_archived, status)
      VALUES
      (${TODD_UPCOMING}, 'user_created', 'e10', 'Todd Upcoming',
       datetime('now', '+2 days'), datetime('now', '+2 days', '+2 hours'),
       NULL, 'Not Todd Jenkins', ${TODD}, 0, 'active'),
      (${TODD_PAST}, 'user_created', 'e11', 'Todd Past',
       datetime('now', '-5 days'), datetime('now', '-5 days', '+2 hours'),
       NULL, 'Not Todd Jenkins', ${TODD}, 0, 'active'),
      (${ORG_UPCOMING}, 'user_created', 'e12', 'Org Upcoming',
       datetime('now', '+3 days'), datetime('now', '+3 days', '+2 hours'),
       ${ORG}, 'Longhorn Devs', ${TODD}, 0, 'active'),
      (${ORG_PAST}, 'user_created', 'e13', 'Org Past',
       datetime('now', '-9 days'), datetime('now', '-9 days', '+2 hours'),
       ${ORG}, 'Longhorn Devs', NULL, 0, 'active'),
      (${ORG_ARCHIVED}, 'user_created', 'e14', 'Org Archived',
       datetime('now', '-30 days'), datetime('now', '-30 days', '+2 hours'),
       ${ORG}, 'Longhorn Devs', NULL, 1, 'active'),
      (${SCRAPED}, 'hornslink', 'e15', 'Scraped Thing',
       datetime('now', '+1 days'), datetime('now', '+1 days', '+2 hours'),
       NULL, 'HornsLink', NULL, 0, 'active')`);

    env = {
      DB: new SqliteD1(db) as unknown as D1Database,
      JWT_SECRET,
      RESEND_API_KEY: '',
    } as Env;
  });

  // -------------------------------------------------------------------------
  // GET /users/me/events — owner event editor metadata
  // -------------------------------------------------------------------------

  describe('GET /users/me/events', () => {
    it('returns the tags and bucket needed to edit a posted event', async () => {
      db.exec(`INSERT INTO event_tags (event_id, bucket_id, tag) VALUES
        (${TODD_UPCOMING}, 'gaming', 'Board Games'),
        (${TODD_UPCOMING}, 'gaming', 'Video Games')`);

      const res = await users('/me/events?tab=posted', { as: TODD });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      const event = body.events.find((row: any) => row.id === TODD_UPCOMING);

      expect(event).toMatchObject({
        discovery_bucket: 'gaming',
        tags: ['Board Games', 'Video Games'],
      });
    });
  });

  // -------------------------------------------------------------------------
  // GET /users/:userId/profile
  // -------------------------------------------------------------------------

  describe('GET /users/:userId/profile', () => {
    it('rejects an unauthenticated caller', async () => {
      // A profile names a person and links to their socials. The same
      // reasoning that auth-gates the attendee list applies here.
      const res = await users(`/${TODD}/profile`);
      expect(res.status).toBe(401);
    });

    it('returns the read-only profile with interests, majors and socials', async () => {
      const res = await users(`/${TODD}/profile`, { as: ME });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;

      expect(body.user).toMatchObject({
        id: TODD,
        first_name: 'Not Todd',
        last_name: 'Jenkins',
        bio: "Todd's bio.",
      });
      expect(body.user.tags).toEqual(['Coding', 'Music']);
      expect(body.user.majors).toEqual(['Economics']);
      expect(body.user.socials).toEqual([
        { platform: 'instagram', url: 'https://instagram.com/todd' },
      ]);
      expect(body.is_following).toBe(false);
      expect(body.is_self).toBe(false);
    });

    it('never exposes the email address', async () => {
      // The self-profile endpoint returns SELECT *, which is fine for the
      // owner. A stranger's copy must not inherit that.
      const body = (await (await users(`/${TODD}/profile`, { as: ME })).json()) as any;
      expect(body.user.email).toBeUndefined();
    });

    it('reports is_self on your own id', async () => {
      const body = (await (await users(`/${ME}/profile`, { as: ME })).json()) as any;
      expect(body.is_self).toBe(true);
    });

    it('404s on a user that does not exist', async () => {
      const res = await users('/4242/profile', { as: ME });
      expect(res.status).toBe(404);
    });

    it('400s on a non-numeric id', async () => {
      const res = await users('/todd/profile', { as: ME });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /users/:userId/profile/events — Upcoming / Past
  // -------------------------------------------------------------------------

  describe('GET /users/:userId/profile/events', () => {
    it('defaults to Upcoming and returns only events that have not ended', async () => {
      const body = (await (await users(`/${TODD}/profile/events`, { as: ME })).json()) as any;
      expect(body.tab).toBe('upcoming');
      expect(body.events.map((e: any) => e.id).sort()).toEqual([TODD_UPCOMING, ORG_UPCOMING]);
      expect(body.counts).toEqual({ upcoming: 2, past: 1 });
    });

    it('returns only ended events on the Past tab', async () => {
      const body = (await (
        await users(`/${TODD}/profile/events?tab=past`, { as: ME })
      ).json()) as any;
      expect(body.events.map((e: any) => e.id)).toEqual([TODD_PAST]);
    });

    it('shows only what they POSTED — never what they saved or RSVP’d to', async () => {
      // Saved and Going are the owner's own collections. A visitor seeing them
      // would turn a private bookmark into a public statement about where
      // somebody is going to be.
      db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES (${TODD}, ${SCRAPED})`);
      db.exec(`INSERT INTO event_rsvps (user_id, event_id) VALUES (${TODD}, ${SCRAPED})`);

      const body = (await (await users(`/${TODD}/profile/events`, { as: ME })).json()) as any;
      expect(body.events.map((e: any) => e.id)).not.toContain(SCRAPED);
    });

    it('rejects an unknown tab rather than silently defaulting', async () => {
      const res = await users(`/${TODD}/profile/events?tab=saved`, { as: ME });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error).toBe('INVALID_TAB');
    });

    it('requires auth', async () => {
      expect((await users(`/${TODD}/profile/events`)).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Follow
  // -------------------------------------------------------------------------

  describe('following a user', () => {
    it('follows, reports it back on the profile, and unfollows', async () => {
      expect((await users(`/${TODD}/follow`, { method: 'POST', as: ME })).status).toBe(200);

      let body = (await (await users(`/${TODD}/profile`, { as: ME })).json()) as any;
      expect(body.is_following).toBe(true);
      expect(body.user.follower_count).toBe(1);

      expect((await users(`/${TODD}/follow`, { method: 'DELETE', as: ME })).status).toBe(200);
      body = (await (await users(`/${TODD}/profile`, { as: ME })).json()) as any;
      expect(body.is_following).toBe(false);
      expect(body.user.follower_count).toBe(0);
    });

    it('is idempotent', async () => {
      await users(`/${TODD}/follow`, { method: 'POST', as: ME });
      await users(`/${TODD}/follow`, { method: 'POST', as: ME });
      expect(count('user_follows WHERE followed_user_id = ?', TODD)).toBe(1);
    });

    it('refuses to follow yourself', async () => {
      const res = await users(`/${ME}/follow`, { method: 'POST', as: ME });
      expect(res.status).toBe(400);
      expect(count('user_follows')).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Blocking — the safety-critical half
  // -------------------------------------------------------------------------

  describe('blocking hides both parties from each other', () => {
    it('404s the blocked profile for the BLOCKER', async () => {
      await block(ME, TODD);
      expect((await users(`/${TODD}/profile`, { as: ME })).status).toBe(404);
    });

    it('404s the blocker’s profile for the BLOCKED party', async () => {
      // The failure that matters. A filter written as "blocker_user_id = me"
      // passes the test above and leaves the blocked person free to keep
      // reading the profile of whoever blocked them.
      await block(ME, TODD);
      expect((await users(`/${ME}/profile`, { as: TODD })).status).toBe(404);
    });

    it('404s the events grid in BOTH directions', async () => {
      // Independently reachable from the profile fetch: an events list that
      // answers while the profile 404s is a complete bypass.
      await block(ME, TODD);
      expect((await users(`/${TODD}/profile/events`, { as: ME })).status).toBe(404);
      expect((await users(`/${ME}/profile/events`, { as: TODD })).status).toBe(404);
    });

    it('reports the block as a plain 404, indistinguishable from a missing user', async () => {
      await block(ME, TODD);
      const res = await users(`/${TODD}/profile`, { as: ME });
      expect(((await res.json()) as any).error).toBe('USER_NOT_FOUND');
    });

    it('leaves everyone else’s view untouched', async () => {
      await block(ME, TODD);
      expect((await users(`/${TODD}/profile`, { as: BYSTANDER })).status).toBe(200);
      expect((await users(`/${ME}/profile`, { as: BYSTANDER })).status).toBe(200);
    });

    it('refuses to block yourself', async () => {
      const res = await users(`/${ME}/block`, { method: 'POST', as: ME });
      expect(res.status).toBe(400);
      expect(count('user_blocks')).toBe(0);
    });

    it('is idempotent', async () => {
      await block(ME, TODD);
      await block(ME, TODD);
      expect(count('user_blocks')).toBe(1);
    });
  });

  describe('blocking drops follows in both directions', () => {
    beforeEach(async () => {
      await users(`/${TODD}/follow`, { method: 'POST', as: ME });
      await users(`/${ME}/follow`, { method: 'POST', as: TODD });
      expect(count('user_follows')).toBe(2);
    });

    it('deletes the follow the BLOCKER had', async () => {
      await block(ME, TODD);
      expect(
        count('user_follows WHERE follower_user_id = ? AND followed_user_id = ?', ME, TODD),
      ).toBe(0);
    });

    it('deletes the follow the BLOCKED party had', async () => {
      // Easy to miss, and the one that leaves a blocked person still counted
      // as a follower of someone who can no longer see them.
      await block(ME, TODD);
      expect(
        count('user_follows WHERE follower_user_id = ? AND followed_user_id = ?', TODD, ME),
      ).toBe(0);
    });

    it('leaves unrelated follows alone', async () => {
      db.exec(
        `INSERT INTO user_follows (follower_user_id, followed_user_id)
         VALUES (${BYSTANDER}, ${TODD})`,
      );
      await block(ME, TODD);
      expect(count('user_follows WHERE follower_user_id = ?', BYSTANDER)).toBe(1);
    });

    it('drops the counts a bystander sees', async () => {
      await block(ME, TODD);
      const body = (await (await users(`/${TODD}/profile`, { as: BYSTANDER })).json()) as any;
      expect(body.user.follower_count).toBe(0);
      expect(body.user.following_count).toBe(0);
    });

    it('excludes a blocked relationship from the counts even if a row survives', async () => {
      // Defence in depth: the delete above is the real mechanism, but a count
      // that would happily re-include a blocked person the moment some other
      // code path re-creates a row is a leak nobody would notice.
      await block(ME, TODD);
      db.exec(
        `INSERT INTO user_follows (follower_user_id, followed_user_id) VALUES (${ME}, ${TODD})`,
      );
      const body = (await (await users(`/${TODD}/profile`, { as: BYSTANDER })).json()) as any;
      expect(body.user.follower_count).toBe(0);
    });
  });

  describe('a blocked user cannot re-follow', () => {
    it('refuses the blocker’s own follow with a 409 they can act on', async () => {
      await block(ME, TODD);
      const res = await users(`/${TODD}/follow`, { method: 'POST', as: ME });
      expect(res.status).toBe(409);
      expect(count('user_follows')).toBe(0);
    });

    it('refuses the BLOCKED party’s follow, as a 404', async () => {
      // 403 would confirm the account exists and is refusing them, which is
      // precisely what the block is meant to withhold.
      await block(ME, TODD);
      const res = await users(`/${ME}/follow`, { method: 'POST', as: TODD });
      expect(res.status).toBe(404);
      expect(count('user_follows')).toBe(0);
    });

    it('still lets an unrelated user follow either of them', async () => {
      await block(ME, TODD);
      expect((await users(`/${TODD}/follow`, { method: 'POST', as: BYSTANDER })).status).toBe(200);
      expect((await users(`/${ME}/follow`, { method: 'POST', as: BYSTANDER })).status).toBe(200);
    });
  });

  describe('unblocking', () => {
    it('restores visibility but NOT the follows the block deleted', async () => {
      await users(`/${TODD}/follow`, { method: 'POST', as: ME });
      await block(ME, TODD);
      await users(`/${TODD}/block`, { method: 'DELETE', as: ME });

      expect((await users(`/${TODD}/profile`, { as: ME })).status).toBe(200);
      // Silently re-following someone you had blocked would be a surprising
      // thing for an unblock to do.
      expect(count('user_follows')).toBe(0);
    });

    it('does NOT let the blocked party lift the block placed on them', async () => {
      // The single worst bug this feature could have: a DELETE that matched
      // either column order would hand the unblock to the wrong person.
      await block(ME, TODD);
      const res = await users(`/${ME}/block`, { method: 'DELETE', as: TODD });
      expect(res.status).toBe(200); // idempotent, deletes nothing
      expect(count('user_blocks')).toBe(1);
      expect((await users(`/${ME}/profile`, { as: TODD })).status).toBe(404);
    });

    it('leaves a mutual block in place when only one side lifts theirs', async () => {
      await block(ME, TODD);
      await block(TODD, ME);
      await users(`/${TODD}/block`, { method: 'DELETE', as: ME });

      expect(count('user_blocks')).toBe(1);
      // Todd's block on Mel survives, so both are still hidden from each other.
      expect((await users(`/${TODD}/profile`, { as: ME })).status).toBe(404);
      expect((await users(`/${ME}/profile`, { as: TODD })).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Blocking on the event read paths
  // -------------------------------------------------------------------------

  describe('a blocked user’s events disappear from every event read', () => {
    const ids = async (res: Response, key = 'events'): Promise<number[]> =>
      ((await res.json()) as any)[key].map((e: any) => e.id);

    it('hides them from GET /events for the blocker', async () => {
      await block(ME, TODD);
      expect(await ids(await events('/', { as: ME }))).not.toContain(TODD_UPCOMING);
    });

    it('hides the blocker’s events from the BLOCKED party', async () => {
      db.exec(
        `INSERT INTO events (id, source, source_event_id, title, start_datetime,
                             created_by_user_id, is_archived, status)
         VALUES (99, 'user_created', 'e99', 'Mine', datetime('now', '+1 days'),
                 ${ME}, 0, 'active')`,
      );
      await block(ME, TODD);
      expect(await ids(await events('/', { as: TODD }))).not.toContain(99);
    });

    it('404s the event detail rather than serving it by deep link', async () => {
      // The feed filter is decoration if the event is still one share link
      // away.
      await block(ME, TODD);
      expect((await events(`/${TODD_UPCOMING}`, { as: ME })).status).toBe(404);
    });

    it('hides them from the ranked feed', async () => {
      await block(ME, TODD);
      const body = (await (await feed('/explore', { as: ME })).json()) as any;
      expect(body.events.map((e: any) => e.id)).not.toContain(TODD_UPCOMING);
    });

    it('leaves them visible to everyone else', async () => {
      await block(ME, TODD);
      expect(await ids(await events('/', { as: BYSTANDER }))).toContain(TODD_UPCOMING);
      expect((await events(`/${TODD_UPCOMING}`, { as: BYSTANDER })).status).toBe(200);
    });

    it('never hides scraped events, which belong to no user', async () => {
      // created_by_user_id is NULL on everything a scraper ingested. Blocking
      // a person must not blank out HornsLink.
      await block(ME, TODD);
      expect(await ids(await events('/', { as: ME }))).toContain(SCRAPED);
    });

    it('drops a blocked attendee from the faces but not from the count', async () => {
      // The count is an aggregate about the event; subtracting the blocked
      // person from it would tell the blocker exactly when they RSVP'd by
      // making the number move.
      db.exec(`INSERT INTO event_rsvps (user_id, event_id) VALUES
        (${TODD}, ${SCRAPED}), (${BYSTANDER}, ${SCRAPED})`);
      await block(ME, TODD);

      const body = (await (await events(`/${SCRAPED}/attendees`, { as: ME })).json()) as any;
      expect(body.attendees.map((a: any) => a.id)).toEqual([BYSTANDER]);
      expect(body.count).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Org public profile
  // -------------------------------------------------------------------------

  describe('the org account profile', () => {
    it('serves a NON-MEMBER, unlike the console', async () => {
      // GET /orgs/:orgId 403s a non-member — which is everyone this screen
      // exists for.
      expect((await orgs(`/${ORG}`, { as: ME })).status).toBe(403);

      const res = await orgs(`/${ORG}/profile`, { as: ME });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.org).toMatchObject({ name: 'Longhorn Devs', bio: 'We build things.' });
      expect(body.is_member).toBe(false);
      expect(body.is_following).toBe(false);
    });

    it('does not leak the console’s engagement totals', async () => {
      const body = (await (await orgs(`/${ORG}/profile`, { as: ME })).json()) as any;
      expect(body.stats).toBeUndefined();
    });

    it('follows and unfollows, moving the follower count', async () => {
      expect((await orgs(`/${ORG}/follow`, { method: 'POST', as: ME })).status).toBe(200);
      let body = (await (await orgs(`/${ORG}/profile`, { as: ME })).json()) as any;
      expect(body.is_following).toBe(true);
      expect(body.org.follower_count).toBe(1);

      await orgs(`/${ORG}/follow`, { method: 'DELETE', as: ME });
      body = (await (await orgs(`/${ORG}/profile`, { as: ME })).json()) as any;
      expect(body.is_following).toBe(false);
      expect(body.org.follower_count).toBe(0);
    });

    it('is idempotent on repeated follows', async () => {
      await orgs(`/${ORG}/follow`, { method: 'POST', as: ME });
      await orgs(`/${ORG}/follow`, { method: 'POST', as: ME });
      expect(count('org_followers WHERE org_id = ?', ORG)).toBe(1);
    });

    it('404s an org that does not exist', async () => {
      expect((await orgs('/4242/profile', { as: ME })).status).toBe(404);
      expect((await orgs('/4242/follow', { method: 'POST', as: ME })).status).toBe(404);
    });

    it('splits the org grid into Upcoming and Past, excluding archived events', async () => {
      const upcoming = (await (await orgs(`/${ORG}/profile/events`, { as: ME })).json()) as any;
      expect(upcoming.events.map((e: any) => e.id)).toEqual([ORG_UPCOMING]);
      // ORG_ARCHIVED is the cleanup job's soft delete, not history: it belongs
      // in neither tab.
      expect(upcoming.counts).toEqual({ upcoming: 1, past: 1 });

      const past = (await (
        await orgs(`/${ORG}/profile/events?tab=past`, { as: ME })
      ).json()) as any;
      expect(past.events.map((e: any) => e.id)).toEqual([ORG_PAST]);
    });

    it('still serves the org grid when a blocked person posted one of its events', async () => {
      // Blocks are between PEOPLE. On an org profile the org is the author,
      // and hiding its events because a blocked member pressed publish would
      // let one person erase an organisation.
      await block(ME, TODD);
      const body = (await (await orgs(`/${ORG}/profile/events`, { as: ME })).json()) as any;
      expect(body.events.map((e: any) => e.id)).toEqual([ORG_UPCOMING]);
    });

    it('requires auth on all three', async () => {
      expect((await orgs(`/${ORG}/profile`)).status).toBe(401);
      expect((await orgs(`/${ORG}/profile/events`)).status).toBe(401);
      expect((await orgs(`/${ORG}/follow`, { method: 'POST' })).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // Frame 471 — followed-org notification toggles
  // -------------------------------------------------------------------------

  describe('followed-org notification settings (Frame 471)', () => {
    it('returns defaults without writing a row', async () => {
      const body = (await (await settings('/followed-orgs', { as: ME })).json()) as any;
      expect(body.settings).toEqual({
        paused: false,
        new_event_posts: true,
        event_detail_changes: true,
      });
      expect(count('followed_org_notification_settings')).toBe(0);
    });

    it('persists one toggle without resetting the others', async () => {
      await settings('/followed-orgs', {
        method: 'PATCH',
        as: ME,
        body: { new_event_posts: false },
      });
      const res = await settings('/followed-orgs', {
        method: 'PATCH',
        as: ME,
        body: { paused: true },
      });
      const body = (await res.json()) as any;
      expect(body.settings).toEqual({
        paused: true,
        // The merge is the point: a PATCH of one switch must not silently
        // restore the other two to their defaults.
        new_event_posts: false,
        event_detail_changes: true,
      });
    });

    it('keeps the other two switches’ values through a pause and un-pause', async () => {
      // paused is stored rather than derived, so un-pausing restores what the
      // user picked instead of turning everything back on.
      await settings('/followed-orgs', {
        method: 'PATCH',
        as: ME,
        body: { event_detail_changes: false, paused: true },
      });
      const body = (await (
        await settings('/followed-orgs', { method: 'PATCH', as: ME, body: { paused: false } })
      ).json()) as any;
      expect(body.settings).toEqual({
        paused: false,
        new_event_posts: true,
        event_detail_changes: false,
      });
    });

    it('is scoped to the caller', async () => {
      await settings('/followed-orgs', { method: 'PATCH', as: ME, body: { paused: true } });
      const body = (await (await settings('/followed-orgs', { as: TODD })).json()) as any;
      expect(body.settings.paused).toBe(false);
    });

    it('requires auth', async () => {
      expect((await settings('/followed-orgs')).status).toBe(401);
      expect((await settings('/followed-orgs', { method: 'PATCH', body: {} })).status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  // The blocker's OWN collections
  // -------------------------------------------------------------------------
  //
  // The least obvious family of read paths, and the one most likely to be
  // missed: these endpoints list events the CALLER already has a relationship
  // with — saved, RSVP'd, or attended in the past — so nothing about them
  // mentions the other person, and every one of them will happily hand back a
  // blocked author's event that was saved before the block.
  //
  // Everything here would still have passed with the profile, feed and event
  // reads filtered, which is exactly why it is tested separately.
  describe('a blocked author’s events leave the blocker’s own collections', () => {
    beforeEach(() => {
      // Mel saved and RSVP'd to one of Todd's upcoming events, and attended a
      // past one, all BEFORE any block existed.
      db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES
        (${ME}, ${TODD_UPCOMING}), (${BYSTANDER}, ${TODD_UPCOMING})`);
      db.exec(`INSERT INTO event_rsvps (user_id, event_id) VALUES
        (${ME}, ${TODD_UPCOMING}), (${ME}, ${TODD_PAST}), (${BYSTANDER}, ${TODD_UPCOMING})`);
    });

    const titles = (rows: any[]) => rows.map((e: any) => e.title);

    it('drops it from the bookmark list', async () => {
      const before = (await (await call(savedRoutes, '/', { as: ME })).json()) as any;
      expect(titles(before.events)).toContain('Todd Upcoming');

      await block(ME, TODD);

      const after = (await (await call(savedRoutes, '/', { as: ME })).json()) as any;
      expect(titles(after.events)).not.toContain('Todd Upcoming');
    });

    it('drops it from the Saved and Going tabs on the profile', async () => {
      await block(ME, TODD);

      for (const tab of ['saved', 'going']) {
        const body = (await (await users(`/me/events?tab=${tab}`, { as: ME })).json()) as any;
        expect(titles(body.events)).not.toContain('Todd Upcoming');
      }
    });

    it('drops it from the tab COUNTS as well as the list', async () => {
      // A count that still includes a hidden event reads as a bug — "Saved
      // (1)" over an empty grid — and quietly tells the blocker that the
      // person they blocked still has something of theirs on screen.
      const before = (await (await users('/me/events?tab=saved', { as: ME })).json()) as any;
      expect(before.counts.saved).toBe(1);

      await block(ME, TODD);

      const after = (await (await users('/me/events?tab=saved', { as: ME })).json()) as any;
      expect(after.counts.saved).toBe(0);
      expect(after.counts.going).toBe(0);
    });

    it('drops it from the Past view', async () => {
      const before = (await (await users('/me/past-events', { as: ME })).json()) as any;
      expect(titles(before.attended)).toContain('Todd Past');

      await block(ME, TODD);

      const after = (await (await users('/me/past-events', { as: ME })).json()) as any;
      expect(titles(after.attended)).not.toContain('Todd Past');
      // History is where a partial block shows through: this is the one
      // collection that still holds events from before the block.
      expect(titles(after.saved)).not.toContain('Todd Past');
    });

    it('hides them from the BLOCKED party’s collections too', async () => {
      // Todd saved one of Mel's events. Mel blocks Todd. Todd is the one who
      // did not act, so a filter keyed only on "rows I created" would leave
      // this visible — the direction that matters most.
      db.exec(`INSERT INTO events
        (id, source, source_event_id, title, start_datetime, end_datetime,
         host_organization_name, created_by_user_id, is_archived, status)
        VALUES (40, 'user_created', 'e40', 'Mel Upcoming',
                datetime('now', '+4 days'), datetime('now', '+4 days', '+2 hours'),
                'Mel Mine', ${ME}, 0, 'active')`);
      db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES (${TODD}, 40)`);

      const before = (await (await call(savedRoutes, '/', { as: TODD })).json()) as any;
      expect(titles(before.events)).toContain('Mel Upcoming');

      await block(ME, TODD);

      const after = (await (await call(savedRoutes, '/', { as: TODD })).json()) as any;
      expect(titles(after.events)).not.toContain('Mel Upcoming');
    });

    it('leaves a bystander’s identical collection untouched', async () => {
      await block(ME, TODD);

      const body = (await (await call(savedRoutes, '/', { as: BYSTANDER })).json()) as any;
      expect(titles(body.events)).toContain('Todd Upcoming');
    });

    it('never touches a scraped event, which has no author to block', async () => {
      db.exec(`INSERT INTO saved_events (user_id, event_id) VALUES (${ME}, ${SCRAPED})`);
      await block(ME, TODD);

      const body = (await (await call(savedRoutes, '/', { as: ME })).json()) as any;
      expect(titles(body.events)).toContain('Scraped Thing');
    });

    it('KEEPS the underlying rows, so unblocking restores the collection', async () => {
      await block(ME, TODD);
      // The bookmark is the caller's own; a block hides the event, it does not
      // throw away what the user chose to keep.
      expect(count('saved_events WHERE user_id = ? AND event_id = ?', ME, TODD_UPCOMING)).toBe(1);

      await users(`/${TODD}/block`, { method: 'DELETE', as: ME });

      const after = (await (await call(savedRoutes, '/', { as: ME })).json()) as any;
      expect(titles(after.events)).toContain('Todd Upcoming');
    });
  });
});
