/**
 * GET /orgs/search -- cursor pagination and request validation (LOOP-264).
 *
 * Runs the REAL route (not a mirror) against a REAL SQLite database built
 * from server/schema.sql, through the same thin D1 shim test_events_patch.ts
 * uses. Filtering, ranking and sort-key ORDER BY are pinned in the SQL mirror
 * at test/test_org_search_sql.ts instead; what belongs here is everything
 * that lives in the TypeScript around that query and can't be exercised by
 * re-deriving SQL by hand: cursor encode/decode, the keyset WHERE it drives,
 * and the 400s that guard against feeding it garbage.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard, same as its siblings.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { orgRoutes } from '../../src/routes/orgs.worker';
import type { Env } from '../../src/worker';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const JWT_SECRET = 'test-secret';
const ME = 1;
const EMAIL = 'me@utexas.edu';

// Five zero-signal orgs (no followers, no events) so trending ties fall
// through to the name/id tie-break -- deterministic, without needing
// follower fixtures just to test pagination mechanics.
const PAGE_ORG_IDS = [901, 902, 903, 904, 905];

const VERIFIED_ORG = 910;
const UNVERIFIED_ORG = 911;
const SPORTS_ORG = 912;
const UPCOMING_ORG = 913;
const NO_EVENTS_ORG = 914;

// ---------------------------------------------------------------------------
// D1 shim over node:sqlite (mirrors test/routes/test_public_profiles.ts)
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

describeOrSkip('GET /orgs/search -- pagination and validation (LOOP-264)', () => {
  let db: any;
  let env: Env;

  async function search(query = '', asUser = true): Promise<Response> {
    const token = asUser ? await signJwt(EMAIL) : null;
    return orgRoutes.request(
      `http://longhorn-loop.test/search${query}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      env,
    );
  }

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES (${ME}, '${EMAIL}', 'Mel', 'Mine')`);

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${PAGE_ORG_IDS[0]}, 'Cursor Org A'),
      (${PAGE_ORG_IDS[1]}, 'Cursor Org B'),
      (${PAGE_ORG_IDS[2]}, 'Cursor Org C'),
      (${PAGE_ORG_IDS[3]}, 'Cursor Org D'),
      (${PAGE_ORG_IDS[4]}, 'Cursor Org E')`);

    db.exec(`INSERT INTO organizations (id, name, verified) VALUES
      (${VERIFIED_ORG}, 'Filter Verified Org', 1),
      (${UNVERIFIED_ORG}, 'Filter Unverified Org', 0)`);

    db.exec(
      `INSERT INTO organizations (id, name, category) VALUES (${SPORTS_ORG}, 'Filter Sports Org', 'Sports')`,
    );

    db.exec(`INSERT INTO organizations (id, name) VALUES
      (${UPCOMING_ORG}, 'Filter Upcoming Org'),
      (${NO_EVENTS_ORG}, 'Filter No Events Org')`);
    db.exec(`INSERT INTO events
      (id, source, source_event_id, title, start_datetime, host_organization_id, status)
      VALUES (990, 'hornslink', 'ev990', 'Future Active', datetime('now', '+3 days'), ${UPCOMING_ORG}, 'active')`);

    env = {
      DB: new SqliteD1(db) as unknown as D1Database,
      JWT_SECRET,
      RESEND_API_KEY: '',
    } as Env;
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await search('', false);
    expect(res.status).toBe(401);
  });

  it('returns the directory (not an empty list) with no q, per Default Behavior', async () => {
    const res = await search();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.sort).toBe('trending');
    expect(body.organizations.length).toBeGreaterThan(0);
  });

  it('rejects an unknown sort', async () => {
    const res = await search('?sort=popularity');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_SORT');
  });

  it('rejects an unknown category', async () => {
    const res = await search('?category=Blorp');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_CATEGORY');
  });

  it('rejects a garbage cursor', async () => {
    const res = await search('?cursor=not-valid-base64-json');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_CURSOR');
  });

  it('rejects a well-formed cursor from a different sort', async () => {
    const first = await search('?sort=trending&limit=1');
    const { nextCursor } = (await first.json()) as any;
    expect(nextCursor).toBeTruthy();

    // The cursor pins a position in trending's column order; reusing it under
    // az would compare values that mean different things column-for-column.
    const res = await search(`?sort=az&cursor=${encodeURIComponent(nextCursor)}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_CURSOR');
  });

  it('paginates through every org exactly once, in the same order as one unpaginated page', async () => {
    const wholeBody = (await (await search('?limit=100')).json()) as any;
    const wholeIds = wholeBody.organizations
      .map((o: any) => o.id)
      .filter((id: number) => PAGE_ORG_IDS.includes(id));

    const collected: number[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const res = await search(`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      collected.push(...body.organizations.map((o: any) => o.id));
      cursor = body.nextCursor;
      guard++;
    } while (cursor && guard < 20);

    const collectedPageOrgIds = collected.filter((id) => PAGE_ORG_IDS.includes(id));
    expect(collectedPageOrgIds).toEqual(wholeIds);
    // No id repeated across pages.
    expect(new Set(collectedPageOrgIds).size).toBe(collectedPageOrgIds.length);
  });

  it('verified=true keeps only verified orgs', async () => {
    const body = (await (await search('?verified=true&limit=100')).json()) as any;
    const ids = body.organizations.map((o: any) => o.id);
    expect(ids).toContain(VERIFIED_ORG);
    expect(ids).not.toContain(UNVERIFIED_ORG);
  });

  it('category filters to the selected category', async () => {
    const body = (await (await search('?category=Sports&limit=100')).json()) as any;
    const ids = body.organizations.map((o: any) => o.id);
    expect(ids).toContain(SPORTS_ORG);
    expect(ids).not.toContain(VERIFIED_ORG);
  });

  it('hasUpcomingEvents keeps only orgs with a future, active event', async () => {
    const body = (await (await search('?hasUpcomingEvents=true&limit=100')).json()) as any;
    const ids = body.organizations.map((o: any) => o.id);
    expect(ids).toContain(UPCOMING_ORG);
    expect(ids).not.toContain(NO_EVENTS_ORG);
  });
});
