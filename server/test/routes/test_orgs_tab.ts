/**
 * The Orgs tab's server additions (LOOP-331 / LOOP-332 / LOOP-334).
 *
 *   GET /orgs/following                 the "Following" half of Your Orgs
 *   GET /orgs/search  followers_this_week  the Trending card's "+N this week"
 *   GET /orgs/:id/profile  member_count, leadership  the People tab
 *
 * Same real-route, real-SQLite setup as test_org_search.ts. The case that
 * matters most is leadership's shape: the profile route is readable by any
 * signed-in student, so it must carry officer NAMES and nothing that
 * identifies an account (email, user id) -- those stay behind the
 * members-only /members route.
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
const ADMIN = 2;
const EDITOR = 3;
const EMAIL = 'me@utexas.edu';

const FOLLOWED_ORG = 920;
const OTHER_ORG = 921;
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

describeOrSkip('Orgs tab server additions (LOOP-331/332/334)', () => {
  let db: any;
  let env: Env;

  async function get(path: string, asUser = true): Promise<Response> {
    const token = asUser ? await signJwt(EMAIL) : null;
    return orgRoutes.request(
      `http://longhorn-loop.test${path}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      env,
    );
  }

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));

    db.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES
      (${ME}, '${EMAIL}', 'Mel', 'Mine'),
      (${ADMIN}, 'priya@utexas.edu', 'Priya', 'Shah'),
      (${EDITOR}, 'jordan@utexas.edu', 'Jordan', 'Lee')`);
    db.exec(`INSERT INTO organizations (id, name, category) VALUES
      (${FOLLOWED_ORG}, 'Zeta Builders', 'Tech'),
      (${OTHER_ORG}, 'Alpha Rowing', 'Sports')`);

    env = {
      DB: new SqliteD1(db) as unknown as D1Database,
      JWT_SECRET,
      RESEND_API_KEY: '',
    } as Env;
  });

  it('GET /following rejects an unauthenticated caller', async () => {
    expect((await get('/following', false)).status).toBe(401);
  });

  it('GET /following lists only orgs the caller follows, with all-time follower counts', async () => {
    db.exec(`INSERT INTO org_followers (org_id, user_id) VALUES
      (${FOLLOWED_ORG}, ${ME}), (${FOLLOWED_ORG}, ${ADMIN}), (${OTHER_ORG}, ${ADMIN})`);

    const res = await get('/following');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.organizations.map((o: any) => o.id)).toEqual([FOLLOWED_ORG]);
    expect(body.organizations[0]).toMatchObject({
      name: 'Zeta Builders',
      category: 'Tech',
      verified: false,
      follower_count: 2,
    });
  });

  // /following is declared after /mine and before /:orgId. If it ever moves
  // below /:orgId, "following" is parsed as an org id and this 400s.
  it('GET /following is not swallowed by /:orgId', async () => {
    const body = (await (await get('/following')).json()) as any;
    expect(body.error).toBeUndefined();
    expect(Array.isArray(body.organizations)).toBe(true);
  });

  it('search returns followers_this_week from the trailing 7 days only', async () => {
    db.exec(`INSERT INTO org_followers (org_id, user_id, created_at) VALUES
      (${FOLLOWED_ORG}, ${ME}, datetime('now', '-1 day')),
      (${FOLLOWED_ORG}, ${ADMIN}, datetime('now', '-30 days'))`);

    const body = (await (await get('/search?limit=100')).json()) as any;
    const row = body.organizations.find((o: any) => o.id === FOLLOWED_ORG);
    expect(row.follower_count).toBe(2);
    expect(row.followers_this_week).toBe(1);
  });

  it('profile carries member_count and leadership, admins first, names only', async () => {
    db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES
      (${FOLLOWED_ORG}, ${EDITOR}, 'editor'),
      (${FOLLOWED_ORG}, ${ADMIN}, 'admin')`);

    const res = await get(`/${FOLLOWED_ORG}/profile`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.org.member_count).toBe(2);
    expect(body.leadership).toEqual([
      { first_name: 'Priya', last_name: 'Shah', role: 'admin' },
      { first_name: 'Jordan', last_name: 'Lee', role: 'editor' },
    ]);
    // The viewer is not on the team: the page is still readable.
    expect(body.is_member).toBe(false);
  });

  it('profile reports an empty team rather than omitting the fields', async () => {
    const body = (await (await get(`/${OTHER_ORG}/profile`)).json()) as any;
    expect(body.org.member_count).toBe(0);
    expect(body.leadership).toEqual([]);
  });
});
