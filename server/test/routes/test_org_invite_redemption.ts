/**
 * Org invites are redeemed by the routes an EXISTING account actually hits.
 *
 * test_org_invites.ts covers redeemPendingOrgInvites itself. This file covers
 * where it is wired, because that is what broke: the only call lived in
 * POST /users/me/profile (the onboarding upsert), so anyone invited after they
 * had finished onboarding never joined. The invite sat at 'pending', the admin
 * saw nothing wrong, and the invitee had an email and no org.
 *
 * Runs the real Hono handlers against SQLite built from schema.sql through the
 * same D1 shim as test_public_profiles.ts. Skips below Node 22 (node:sqlite).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { orgRoutes } from '../../src/routes/orgs.worker';
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
const INVITEE = 1;
const ADMIN = 2;
const ORG = 900;
const INVITEE_EMAIL = 'invitee@utexas.edu';

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
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return {
      meta: { last_row_id: Number(r.lastInsertRowid ?? 0), changes: Number(r.changes ?? 0) },
    };
  }
}
class SqliteD1 {
  constructor(private readonly db: any) {}
  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
  }
  async batch(statements: SqliteD1Statement[]) {
    const out: unknown[] = [];
    for (const s of statements) out.push(await s.run());
    return out;
  }
}

async function signJwt(email: string): Promise<string> {
  const b64 = (s: string) => btoa(s).replace(/=/g, '');
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(
    JSON.stringify({ email, iat: now, exp: now + 60 }),
  )}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '')}`;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('org invite redemption for an existing account', () => {
  let db: any;
  let env: Env;

  async function get(
    app: { request: (url: string, init: RequestInit, env: Env) => Promise<Response> },
    path: string,
  ) {
    const token = await signJwt(INVITEE_EMAIL);
    return app.request(
      `http://longhorn-loop.test${path}`,
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
  }

  const membership = () =>
    db.prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?').get(ORG, INVITEE);
  const inviteStatus = () =>
    db.prepare('SELECT status FROM org_invites WHERE org_id = ?').get(ORG)?.status;

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));
    // The invitee is fully onboarded already -- the case that never redeemed.
    db.exec(`INSERT INTO users (id, email, first_name, last_name, onboarding_completed) VALUES
      (${INVITEE}, '${INVITEE_EMAIL}', 'In', 'Vitee', 1),
      (${ADMIN}, 'admin@utexas.edu', 'Ad', 'Min', 1)`);
    db.exec(`INSERT INTO organizations (id, name, source) VALUES (${ORG}, 'Test Org', 'manual')`);
    db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES (${ORG}, ${ADMIN}, 'admin')`);
    db.exec(`INSERT INTO org_invites (org_id, email, role, invited_by, status, expires_at)
      VALUES (${ORG}, '${INVITEE_EMAIL}', 'admin', ${ADMIN}, 'pending', datetime('now', '+14 days'))`);

    env = {
      DB: new SqliteD1(db) as unknown as D1Database,
      JWT_SECRET,
      RESEND_API_KEY: '',
    } as Env;
  });

  it('GET /users/me accepts the invite', async () => {
    const res = await get(userRoutes, '/me');
    expect(res.status).toBe(200);
    expect(membership()).toEqual({ role: 'admin' });
    expect(inviteStatus()).toBe('accepted');
  });

  it('GET /orgs/mine accepts the invite and lists the org in the same response', async () => {
    // Settings calls this route directly. If it only listed memberships, it
    // could race GET /users/me and return an empty list to the person who was
    // just invited.
    const res = await get(orgRoutes, '/mine');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizations: { id: number; role: string }[] };
    expect(body.organizations).toEqual([expect.objectContaining({ id: ORG, role: 'admin' })]);
    expect(inviteStatus()).toBe('accepted');
  });

  it('hitting both routes still grants once and notifies once', async () => {
    await get(userRoutes, '/me');
    await get(orgRoutes, '/mine');
    await get(userRoutes, '/me');
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM org_members WHERE user_id = ?').get(INVITEE).n,
    ).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(1);
  });
});
