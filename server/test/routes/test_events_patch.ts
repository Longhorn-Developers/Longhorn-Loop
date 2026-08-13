/**
 * PATCH /events/:id — the edit path behind the Events tab's pencil (LOOP-136).
 *
 * Runs the REAL Hono handler against a REAL SQLite database built from
 * server/schema.sql, through a thin D1 shim. The sibling create test uses a
 * hand-written FakeD1 that pattern-matches on SQL strings; that works for an
 * INSERT with a fixed column list, but it would prove nothing here. The whole
 * contract of a partial patch is "the UPDATE touches these columns and no
 * others", and a fake that only records the parameters it was handed cannot
 * tell you what the database ended up holding.
 *
 * The cases that matter are the negative ones. A partial update that quietly
 * nulls a column nobody sent, or an authorization check that leaks across org
 * boundaries, both look completely fine from the client — the request returns
 * 200 and the field the user edited is correct.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard, same as test_org_console_sql.ts.
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

const ADMIN = 1; // admin of ORG
const EDITOR = 2; // editor of ORG
const OUTSIDER = 3; // member of nothing
const RIVAL = 4; // editor of OTHER_ORG only
const CREATOR = 5; // created a personal event with no host org

const EMAIL: Record<number, string> = {
  [ADMIN]: 'admin@utexas.edu',
  [EDITOR]: 'editor@utexas.edu',
  [OUTSIDER]: 'outsider@utexas.edu',
  [RIVAL]: 'rival@utexas.edu',
  [CREATOR]: 'creator@utexas.edu',
};

const ORG_EVENT = 10;
const OTHER_ORG_EVENT = 11;
const PERSONAL_EVENT = 12;

// ---------------------------------------------------------------------------
// D1 shim over node:sqlite
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

describeOrSkip('PATCH /events/:id (LOOP-136)', () => {
  let db: any;
  let env: Env;

  const row = (id: number): Record<string, any> =>
    db.prepare('SELECT * FROM events WHERE id = ?').get(id);

  const categoriesOf = (id: number): string[] =>
    db
      .prepare('SELECT category_id FROM event_categories WHERE event_id = ? ORDER BY category_id')
      .all(id)
      .map((r: any) => r.category_id);

  async function patch(
    eventId: number | string,
    body: Record<string, unknown> | null,
    userId?: number,
  ): Promise<Response> {
    const token = userId === undefined ? null : await signJwt(EMAIL[userId]);
    return eventRoutes.request(
      `http://longhorn-loop.test/${eventId}`,
      {
        method: 'PATCH',
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
    // schema.sql predates migration 0012, which is what writeEventTags writes
    // through. Applying it here keeps the tag-rewrite case honest rather than
    // making the route dodge a column that exists in production.
    db.exec(
      readFileSync(
        join(__dirname, '..', '..', 'migrations', '0012_add_event_tag_source_score.sql'),
        'utf-8',
      ),
    );

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${ADMIN}, '${EMAIL[ADMIN]}', 'Ada', 'Admin'),
      (${EDITOR}, '${EMAIL[EDITOR]}', 'Eli', 'Editor'),
      (${OUTSIDER}, '${EMAIL[OUTSIDER]}', 'No', 'Body'),
      (${RIVAL}, '${EMAIL[RIVAL]}', 'Rex', 'Rival'),
      (${CREATOR}, '${EMAIL[CREATOR]}', 'Cam', 'Creator')`);

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${ORG}, 'Longhorn Devs'), (${OTHER_ORG}, 'Unrelated Org')`);

    db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES
      (${ORG}, ${ADMIN}, 'admin'),
      (${ORG}, ${EDITOR}, 'editor'),
      (${OTHER_ORG}, ${RIVAL}, 'editor')`);

    db.exec(`INSERT INTO events
      (id, source, source_event_id, title, description,
       start_datetime, end_datetime, location_short, location_full,
       host_organization_id, host_organization_name, image_url, rsvp_url,
       theme, expires_at, view_count, rsvp_count, save_count, created_by_user_id)
      VALUES
      (${ORG_EVENT}, 'user_created', 'e10', 'General Meeting', 'Bring a laptop.',
       '2026-09-01T18:00:00.000Z', '2026-09-01T20:00:00.000Z', 'BLT 2.503', 'Belo Center 2.503',
       ${ORG}, 'Longhorn Devs', 'https://cdn.test/flyer.png', 'https://rsvp.test/x',
       'Technology', '2026-09-08T20:00:00.000Z', 1000, 120, 80, ${ADMIN}),
      (${OTHER_ORG_EVENT}, 'user_created', 'e11', 'Not Ours', 'Someone else.',
       '2026-09-02T18:00:00.000Z', '2026-09-02T20:00:00.000Z', 'XYZ 1.101', 'Somewhere Else 1.101',
       ${OTHER_ORG}, 'Unrelated Org', NULL, NULL,
       NULL, '2026-09-09T20:00:00.000Z', 5, 5, 5, ${RIVAL}),
      (${PERSONAL_EVENT}, 'user_created', 'e12', 'Study Jam', 'Just us.',
       '2026-09-03T18:00:00.000Z', NULL, NULL, NULL,
       NULL, 'Cam Creator', NULL, NULL,
       NULL, '2026-09-10T18:00:00.000Z', 0, 0, 0, ${CREATOR})`);

    db.exec(`INSERT INTO event_categories (event_id, category_id, category_name) VALUES
      (${ORG_EVENT}, 'coding', 'Coding'),
      (${ORG_EVENT}, 'hackathons', 'Hackathons')`);

    env = {
      DB: new SqliteD1(db) as unknown as D1Database,
      JWT_SECRET,
      RESEND_API_KEY: '',
    } as Env;
  });

  // -------------------------------------------------------------------------
  // Authorization. Every one of these must leave the row byte-identical: a
  // refusal that still wrote something is worse than no check at all.
  // -------------------------------------------------------------------------

  describe('who may edit', () => {
    it('rejects an unauthenticated caller', async () => {
      const before = row(ORG_EVENT);
      const res = await patch(ORG_EVENT, { title: 'Hijacked' });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'UNAUTHORIZED' });
      expect(row(ORG_EVENT)).toEqual(before);
    });

    it('rejects a user who is not a member of the event’s org', async () => {
      const before = row(ORG_EVENT);
      const res = await patch(ORG_EVENT, { title: 'Hijacked' }, OUTSIDER);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
      expect(row(ORG_EVENT)).toEqual(before);
    });

    it('rejects an editor of a DIFFERENT org', async () => {
      // Membership is org-scoped. Being an editor of OTHER_ORG confers exactly
      // nothing over ORG's events, and this is the check most likely to be
      // written as "is the caller an editor somewhere" by accident.
      const before = row(ORG_EVENT);
      const res = await patch(ORG_EVENT, { title: 'Hijacked' }, RIVAL);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'FORBIDDEN' });
      expect(row(ORG_EVENT)).toEqual(before);
    });

    it('rejects an org member editing another org’s event', async () => {
      const before = row(OTHER_ORG_EVENT);
      const res = await patch(OTHER_ORG_EVENT, { title: 'Hijacked' }, ADMIN);

      expect(res.status).toBe(403);
      expect(row(OTHER_ORG_EVENT)).toEqual(before);
    });

    it('rejects a stranger editing a personal event that has no org', async () => {
      // host_organization_id IS NULL means there is no membership to fall back
      // on, so the creator check has to be the only door.
      const before = row(PERSONAL_EVENT);
      const res = await patch(PERSONAL_EVENT, { title: 'Hijacked' }, ADMIN);

      expect(res.status).toBe(403);
      expect(row(PERSONAL_EVENT)).toEqual(before);
    });

    it('allows an admin of the event’s org', async () => {
      const res = await patch(ORG_EVENT, { title: 'Kickoff Meeting' }, ADMIN);

      expect(res.status).toBe(200);
      expect(row(ORG_EVENT).title).toBe('Kickoff Meeting');
    });

    it('allows an EDITOR of the event’s org', async () => {
      // Editors manage events but not people — the Members tab's admin-only
      // can_manage must not be copied onto this route.
      const res = await patch(ORG_EVENT, { title: 'Editor Was Here' }, EDITOR);

      expect(res.status).toBe(200);
      expect(row(ORG_EVENT).title).toBe('Editor Was Here');
    });

    it('allows the creator of an event with no host org', async () => {
      const res = await patch(PERSONAL_EVENT, { title: 'Study Jam II' }, CREATOR);

      expect(res.status).toBe(200);
      expect(row(PERSONAL_EVENT).title).toBe('Study Jam II');
    });

    it('404s an event that does not exist, without revealing anything else', async () => {
      const res = await patch(9999, { title: 'Ghost' }, ADMIN);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'EVENT_NOT_FOUND' });
    });

    it('rejects a non-numeric event id', async () => {
      const res = await patch('not-a-number', { title: 'x' }, ADMIN);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'INVALID_EVENT_ID' });
    });
  });

  // -------------------------------------------------------------------------
  // Partiality. The overlay knows about six fields; the row has thirty.
  // -------------------------------------------------------------------------

  describe('a partial patch touches nothing it was not sent', () => {
    it('leaves every other column identical when only the title changes', async () => {
      const before = row(ORG_EVENT);

      const res = await patch(ORG_EVENT, { title: 'Renamed' }, ADMIN);
      expect(res.status).toBe(200);

      const after = row(ORG_EVENT);
      // updated_at is allowed to move (and often won't, since datetime('now')
      // is second-granular and the seed row was written in the same second).
      // Everything else must be identical.
      const changed = Object.keys(after)
        .filter((key) => key !== 'updated_at')
        .filter((key) => after[key] !== before[key]);
      expect(changed).toEqual(['title']);
    });

    it('never nulls a column the overlay does not know about', async () => {
      // The overlay has no image or RSVP-link field. A patch built by naively
      // spreading the form over every column would blank both.
      await patch(ORG_EVENT, { title: 'Renamed', description: 'New blurb.' }, ADMIN);

      const after = row(ORG_EVENT);
      expect(after.image_url).toBe('https://cdn.test/flyer.png');
      expect(after.rsvp_url).toBe('https://rsvp.test/x');
      expect(after.host_organization_name).toBe('Longhorn Devs');
      expect(after.source_event_id).toBe('e10');
    });

    it('does not disturb the denormalized signal counters', async () => {
      await patch(ORG_EVENT, { title: 'Renamed' }, ADMIN);

      const after = row(ORG_EVENT);
      expect(after.view_count).toBe(1000);
      expect(after.rsvp_count).toBe(120);
      expect(after.save_count).toBe(80);
    });

    it('leaves the description alone when it is omitted', async () => {
      await patch(ORG_EVENT, { title: 'Renamed' }, ADMIN);
      expect(row(ORG_EVENT).description).toBe('Bring a laptop.');
    });

    it('clears the description when it is explicitly emptied', async () => {
      // "" is a deliberate clear, which is exactly what an omitted key is not.
      await patch(ORG_EVENT, { description: '' }, ADMIN);
      expect(row(ORG_EVENT).description).toBeNull();
    });

    it('accepts an empty body as a no-op rather than an error', async () => {
      const before = row(ORG_EVENT);
      const res = await patch(ORG_EVENT, {}, ADMIN);

      expect(res.status).toBe(200);
      const after = row(ORG_EVENT);
      // With no columns to set, the UPDATE is skipped entirely — even
      // updated_at stays put.
      expect(after).toEqual(before);
    });

    it('rejects a body that is not an object', async () => {
      const res = await patch(ORG_EVENT, null, ADMIN);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'INVALID_BODY' });
    });
  });

  // -------------------------------------------------------------------------
  // Field behaviour
  // -------------------------------------------------------------------------

  describe('datetimes', () => {
    it('recomputes expires_at when the schedule moves', async () => {
      const res = await patch(
        ORG_EVENT,
        {
          start_datetime: '2026-10-01T18:00:00-05:00',
          end_datetime: '2026-10-01T21:00:00-05:00',
        },
        ADMIN,
      );

      expect(res.status).toBe(200);
      const after = row(ORG_EVENT);
      expect(after.start_datetime).toBe('2026-10-01T23:00:00.000Z');
      expect(after.end_datetime).toBe('2026-10-02T02:00:00.000Z');
      // computeExpiresAt = end + 7 days. A rescheduled event that kept its old
      // expires_at would be purged by the cleanup job before it happened.
      expect(after.expires_at).toBe('2026-10-09T02:00:00.000Z');
    });

    it('recomputes expires_at when only the start moves', async () => {
      const res = await patch(ORG_EVENT, { start_datetime: '2026-08-01T18:00:00Z' }, ADMIN);

      expect(res.status).toBe(200);
      const after = row(ORG_EVENT);
      // The stored end is still 2026-09-01T20:00Z, so expiry follows the end.
      expect(after.end_datetime).toBe('2026-09-01T20:00:00.000Z');
      expect(after.expires_at).toBe('2026-09-08T20:00:00.000Z');
    });

    it('rejects an end before the stored start, and writes nothing', async () => {
      const before = row(ORG_EVENT);
      const res = await patch(ORG_EVENT, { end_datetime: '2026-08-01T00:00:00Z' }, ADMIN);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'VALIDATION_ERROR',
        fields: { end_datetime: 'Must be on or after start_datetime' },
      });
      expect(row(ORG_EVENT)).toEqual(before);
    });

    it('rejects a datetime without a timezone', async () => {
      const before = row(ORG_EVENT);
      const res = await patch(ORG_EVENT, { start_datetime: '2026-10-01 18:00' }, ADMIN);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'VALIDATION_ERROR',
        fields: { start_datetime: 'Must be an ISO 8601 datetime with timezone' },
      });
      expect(row(ORG_EVENT)).toEqual(before);
    });

    it('pins the end to the start when the end is explicitly cleared', async () => {
      const res = await patch(ORG_EVENT, { end_datetime: null }, ADMIN);

      expect(res.status).toBe(200);
      const after = row(ORG_EVENT);
      expect(after.end_datetime).toBe(after.start_datetime);
    });
  });

  describe('title and location', () => {
    it('refuses to blank the title', async () => {
      const before = row(ORG_EVENT);
      const res = await patch(ORG_EVENT, { title: '   ' }, ADMIN);

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: 'VALIDATION_ERROR',
        fields: { title: 'Required' },
      });
      expect(row(ORG_EVENT)).toEqual(before);
    });

    it('enforces the same title cap as the create path', async () => {
      const res = await patch(ORG_EVENT, { title: 'x'.repeat(81) }, ADMIN);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        fields: { title: 'Must be 80 characters or fewer' },
      });
    });

    it('moves location_short with location_full', async () => {
      const res = await patch(ORG_EVENT, { location: 'Gates Dell Complex 2.216' }, ADMIN);

      expect(res.status).toBe(200);
      const after = row(ORG_EVENT);
      expect(after.location_full).toBe('Gates Dell Complex 2.216');
      // Stale short text next to a new address is the failure this prevents.
      expect(after.location_short).toBe('Gates Dell Complex 2.216');
    });

    it('truncates an over-long location for the short field', async () => {
      const long = 'The Very Long Building Name Nobody Reads, Room 1.234';
      await patch(ORG_EVENT, { location: long }, ADMIN);

      const after = row(ORG_EVENT);
      expect(after.location_full).toBe(long);
      expect(after.location_short).toBe(`${long.slice(0, 37)}...`);
      expect((after.location_short as string).length).toBe(40);
    });

    it('leaves both location columns alone when neither is sent', async () => {
      await patch(ORG_EVENT, { title: 'Renamed' }, ADMIN);

      const after = row(ORG_EVENT);
      expect(after.location_full).toBe('Belo Center 2.503');
      expect(after.location_short).toBe('BLT 2.503');
    });
  });

  describe('categories', () => {
    it('replaces the whole set when categories are sent', async () => {
      const res = await patch(ORG_EVENT, { categories: ['Coding', 'Startups'] }, ADMIN);

      expect(res.status).toBe(200);
      expect(categoriesOf(ORG_EVENT)).toEqual(['coding', 'startups']);
    });

    it('clears the set when an empty array is sent', async () => {
      await patch(ORG_EVENT, { categories: [] }, ADMIN);
      expect(categoriesOf(ORG_EVENT)).toEqual([]);
    });

    it('leaves the set alone when categories are omitted', async () => {
      await patch(ORG_EVENT, { title: 'Renamed' }, ADMIN);
      expect(categoriesOf(ORG_EVENT)).toEqual(['coding', 'hackathons']);
    });

    it('rejects more categories than the create path allows, writing nothing', async () => {
      const res = await patch(
        ORG_EVENT,
        { categories: Array.from({ length: 21 }, (_, i) => `Tag ${i}`) },
        ADMIN,
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        fields: { categories: 'Must include 20 categories or fewer' },
      });
      expect(categoriesOf(ORG_EVENT)).toEqual(['coding', 'hackathons']);
    });

    it('rewrites event_tags only when a bucket accompanies the categories', async () => {
      const res = await patch(
        ORG_EVENT,
        { discovery_bucket: 'gaming', categories: ['Board Games', 'Not A Tag'] },
        ADMIN,
      );

      expect(res.status).toBe(200);
      const tags = db
        .prepare('SELECT bucket_id, tag, source, score FROM event_tags WHERE event_id = ?')
        .all(ORG_EVENT);
      // 'Board Games' is a real gaming tag; 'Not A Tag' is not, and is dropped
      // exactly as the create path drops it.
      expect(tags).toEqual([{ bucket_id: 'gaming', tag: 'Board Games', source: 'user', score: 1 }]);
      // theme is derived from the bucket, so it moves too.
      expect(row(ORG_EVENT).theme).toBe('Social');
    });

    it('leaves classifier tags untouched when only the title changes', async () => {
      db.exec(
        `INSERT INTO event_tags (event_id, bucket_id, tag, source) VALUES
         (${ORG_EVENT}, 'tech', 'Hackathons', 'semantic')`,
      );

      await patch(ORG_EVENT, { title: 'Renamed' }, ADMIN);

      const tags = db.prepare('SELECT tag FROM event_tags WHERE event_id = ?').all(ORG_EVENT);
      expect(tags).toEqual([{ tag: 'Hackathons' }]);
    });
  });

  describe('response shape', () => {
    it('returns the updated event with its categories attached', async () => {
      const res = await patch(ORG_EVENT, { title: 'Kickoff', categories: ['Coding'] }, ADMIN);

      expect(res.status).toBe(200);
      const json = (await res.json()) as { event: Record<string, unknown> };
      expect(json.event).toMatchObject({
        id: ORG_EVENT,
        title: 'Kickoff',
        // Untouched fields come back too, so the client can replace its cached
        // row wholesale rather than merging.
        image_url: 'https://cdn.test/flyer.png',
      });
      expect(json.event.categories).toEqual([{ id: 'coding', name: 'Coding' }]);
    });
  });
});
