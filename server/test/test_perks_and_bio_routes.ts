/**
 * Round-trip through the REAL handlers for LOOP-259 and LOOP-261.
 *
 * The sibling suites (test_event_benefits_sql.ts, test_org_bio_sql.ts) mirror
 * the route logic and run it against the real schema, which pins the SQL and
 * the validation rules. What they cannot catch is a WIRING failure: a body key
 * the multipart parser never turns into an array, a validator whose result is
 * computed and then dropped, an insert that runs against the wrong id. Every
 * one of those leaves the mirrored tests green.
 *
 * So this file calls `eventRoutes.request()` and `orgRoutes.request()` — the
 * actual Hono apps — over a D1 shim backed by node:sqlite, with a real signed
 * JWT. If the handler does not persist what the client sent, these fail.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventRoutes } from '../src/routes/events.worker';
import { orgRoutes } from '../src/routes/orgs.worker';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

const JWT_SECRET = 'test-secret';
const AUTHOR_EMAIL = 'author@utexas.edu';
const EDITOR_EMAIL = 'editor@utexas.edu';

/**
 * Minimal D1Database shim over node:sqlite.
 *
 * Only the surface these two routes actually use: prepare().bind().run() /
 * .first() / .all(), and the `meta.last_row_id` + `meta.changes` that the
 * handlers read back after a write.
 */
function d1(db: any) {
  const statement = (sql: string, params: unknown[] = []): any => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => {
      const info = db.prepare(sql).run(...params);
      return {
        meta: {
          last_row_id: Number(info.lastInsertRowid ?? 0),
          changes: Number(info.changes ?? 0),
        },
      };
    },
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
  });

  return { prepare: (sql: string) => statement(sql) };
}

/** HS256, matching getAuthUser() in src/lib/utils.ts (standard base64, not url). */
async function signJwt(email: string, secret: string): Promise<string> {
  const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=+$/, '');
  const headerB64 = b64({ alg: 'HS256', typ: 'JWT' });
  const payloadB64 = b64({ email, exp: Math.floor(Date.now() / 1000) + 3600 });
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${headerB64}.${payloadB64}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

describeOrSkip('perks + org bio, through the real routes', () => {
  let raw: any;
  let env: any;
  let authorToken: string;
  let editorToken: string;

  beforeEach(async () => {
    raw = new DatabaseSync!(':memory:');
    raw.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));
    raw.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (1, '${AUTHOR_EMAIL}', 'Ada', 'Author'),
      (2, '${EDITOR_EMAIL}', 'Eli', 'Editor')`);
    raw.exec(`INSERT INTO organizations (id, name) VALUES (1, 'Texas Rowing')`);
    raw.exec(
      `INSERT INTO org_members (org_id, user_id, role) VALUES (1, 1, 'admin'), (1, 2, 'editor')`,
    );

    env = { DB: d1(raw), JWT_SECRET };
    authorToken = await signJwt(AUTHOR_EMAIL, JWT_SECRET);
    editorToken = await signJwt(EDITOR_EMAIL, JWT_SECRET);
  });

  const perksOf = (eventId: number): string[] =>
    raw
      .prepare('SELECT benefit_name FROM event_benefits WHERE event_id = ? ORDER BY benefit_name')
      .all(eventId)
      .map((r: any) => r.benefit_name);

  /** POST /events/create as the app sends it: multipart, perks as a JSON array. */
  const createEvent = async (benefits?: string[]) => {
    const form = new FormData();
    form.append('title', 'Career Fair');
    form.append('start_datetime', '2026-12-03T18:30:00Z');
    form.append('location', 'Inner Campus Drive');
    if (benefits) form.append('benefits', JSON.stringify(benefits));

    const res = await eventRoutes.request(
      '/create',
      { method: 'POST', headers: { Authorization: `Bearer ${authorToken}` }, body: form },
      env,
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  it('persists perks sent through the multipart create form', async () => {
    const { status, body } = await createEvent(['Free Food', 'Credit']);

    expect(status).toBe(201);
    const id = body.event.id;
    // Straight from the database, not from the response, so a handler that
    // echoes its input without writing cannot pass this.
    expect(perksOf(id)).toEqual(['Credit', 'Free Food']);
    // And the response carries them, which is what the detail screen renders.
    expect([...body.event.benefits].sort()).toEqual(['Credit', 'Free Food']);
  });

  it('accepts a create with no venue_type, as the current wizard sends (LOOP-260 regression)', async () => {
    // The wizard has no in-person/online control, so it sends no venue_type.
    // Requiring one made every post from the app fail with a 400 about a field
    // the user cannot see. Absent must default rather than reject.
    const { status, body } = await createEvent(['Free Food']);

    expect(status).toBe(201);
    expect(body.event.venue_type).toBe('in_person');
  });

  it('still rejects a venue_type that is sent but invalid', async () => {
    const form = new FormData();
    form.append('title', 'Career Fair');
    form.append('start_datetime', '2026-12-03T18:30:00Z');
    form.append('venue_type', 'hybrid');

    const res = await eventRoutes.request(
      '/create',
      { method: 'POST', headers: { Authorization: `Bearer ${authorToken}` }, body: form },
      env,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).fields).toHaveProperty('venue_type');
  });

  it('creates an event with no perks when the field is left alone', async () => {
    const { status, body } = await createEvent();

    expect(status).toBe(201);
    expect(perksOf(body.event.id)).toEqual([]);
  });

  it('rejects a malformed perk list with a field error', async () => {
    const form = new FormData();
    form.append('title', 'Career Fair');
    form.append('start_datetime', '2026-12-03T18:30:00Z');
    form.append('benefits', JSON.stringify(['ok', '   ']));

    const res = await eventRoutes.request(
      '/create',
      { method: 'POST', headers: { Authorization: `Bearer ${authorToken}` }, body: form },
      env,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).fields).toHaveProperty('benefits');
  });

  it('replaces perks on PATCH, and leaves them alone when the key is omitted', async () => {
    const { body } = await createEvent(['Free Food', 'Credit']);
    const id = body.event.id;

    const patch = async (payload: Record<string, unknown>) =>
      eventRoutes.request(
        `/${id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${authorToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
        env,
      );

    // Editing something else must not disturb the perks.
    expect((await patch({ title: 'Career Fair 2026' })).status).toBe(200);
    expect(perksOf(id)).toEqual(['Credit', 'Free Food']);

    expect((await patch({ benefits: ['Free Swag'] })).status).toBe(200);
    expect(perksOf(id)).toEqual(['Free Swag']);

    expect((await patch({ benefits: [] })).status).toBe(200);
    expect(perksOf(id)).toEqual([]);
  });

  const bioOf = (orgId: number): string | null =>
    raw.prepare('SELECT bio FROM organizations WHERE id = ?').get(orgId).bio ?? null;

  const patchOrg = (token: string, payload: unknown) =>
    orgRoutes.request(
      '/1',
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      env,
    );

  it('writes the org description for an admin', async () => {
    const res = await patchOrg(authorToken, { bio: 'We row at dawn.' });

    expect(res.status).toBe(200);
    expect((await res.json()).org.bio).toBe('We row at dawn.');
    expect(bioOf(1)).toBe('We row at dawn.');
  });

  it('refuses an editor', async () => {
    const res = await patchOrg(editorToken, { bio: 'Sneaky rewrite.' });

    expect(res.status).toBe(403);
    expect(bioOf(1)).toBeNull();
  });

  it('clears on null and rejects an over-long description', async () => {
    await patchOrg(authorToken, { bio: 'Something.' });
    expect(bioOf(1)).toBe('Something.');

    expect((await patchOrg(authorToken, { bio: null })).status).toBe(200);
    expect(bioOf(1)).toBeNull();

    expect((await patchOrg(authorToken, { bio: 'x'.repeat(300) })).status).toBe(400);
  });

  it('returns the stored description on the console header read', async () => {
    await patchOrg(authorToken, { bio: 'We row at dawn.' });

    const res = await orgRoutes.request(
      '/1',
      { method: 'GET', headers: { Authorization: `Bearer ${authorToken}` } },
      env,
    );

    expect(res.status).toBe(200);
    expect((await res.json()).org.bio).toBe('We row at dawn.');
  });
});
