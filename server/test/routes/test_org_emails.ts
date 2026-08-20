/**
 * The two org emails that were specified and never sent (LOOP-245).
 *
 * Both are regression tests for silence, which is the hard kind to catch:
 *
 *   - /orgs/register/verify-president hashed a code into the database and then
 *     dropped it, unless RESEND_DEV_MODE was 'true'. It never is in production,
 *     so no organization could complete a claim no matter what the scrapers
 *     collected. The endpoint returned `{ sent: true }` the whole time.
 *   - POST /orgs/:id/invites created a membership row and returned
 *     `email_sent: false`, so the invited person was never told.
 *
 * Nothing about either failure was visible in the response, which is why the
 * assertions below are mostly about what reached the mail provider.
 *
 * Skips below Node 22 (node:sqlite), same as its siblings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const PRESIDENT = 1; // claims the org
const ADMIN = 2; // already runs an org, invites people
const ORG = 900;

const EMAIL: Record<number, string> = {
  [PRESIDENT]: 'president@utexas.edu',
  [ADMIN]: 'admin@utexas.edu',
};

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
    const r = this.db.prepare(this.sql).run(...this.params);
    return {
      meta: { last_row_id: Number(r.lastInsertRowid ?? 0), changes: Number(r.changes ?? 0) },
    };
  }
}

class SqliteD1 {
  constructor(private readonly db: any) {}
  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.db, sql);
  }
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
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, '');
  const signingInput = `${b64(header)}.${b64(payload)}`;
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

describeOrSkip('org emails (LOOP-245)', () => {
  let db: any;
  let env: Env;
  const realFetch = globalThis.fetch;

  /** Capture what would have gone to Resend without leaving the process. */
  function captureSends() {
    const fn = vi.fn(async () => Response.json({ id: 'sent' }, { status: 200 }));
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  function bodies(spy: ReturnType<typeof captureSends>) {
    return spy.mock.calls.map((call) => JSON.parse((call as any)[1].body));
  }

  async function post(path: string, as: number, body: unknown): Promise<Response> {
    return orgRoutes.request(
      `http://longhorn-loop.test${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await signJwt(EMAIL[as])}`,
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
      (${PRESIDENT}, '${EMAIL[PRESIDENT]}', 'Pat', 'Resident'),
      (${ADMIN}, '${EMAIL[ADMIN]}', 'Adah', 'Minh')`);
    db.exec(
      `INSERT INTO organizations (id, name, verified, president_email, verification_status)
       VALUES (${ORG}, 'Longhorn Chess Club', 0, '${EMAIL[PRESIDENT]}', 'unverified')`,
    );

    env = {
      DB: new SqliteD1(db) as unknown as D1Database,
      JWT_SECRET,
      RESEND_API_KEY: 'test-key',
      EMAIL_FROM: 'Longhorn Loop <noreply@longhorndevelopers.org>',
    } as Env;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  describe('president verification code', () => {
    it('actually sends — it used to only log, and only in dev mode', async () => {
      const spy = captureSends();
      const res = await post('/register/verify-president', PRESIDENT, {
        org_id: ORG,
        email: EMAIL[PRESIDENT],
      });

      expect(res.status).toBe(200);
      // The whole ticket in one assertion: a request went to the mail provider.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(bodies(spy)[0].to).toEqual([EMAIL[PRESIDENT]]);
    });

    it('names the organization, because the recipient never asked for this', async () => {
      // The address came off a public HornsLink page. Without the org name the
      // message is an unexplained code from an unknown sender, which is a
      // phishing report rather than a claim.
      const spy = captureSends();
      await post('/register/verify-president', PRESIDENT, {
        org_id: ORG,
        email: EMAIL[PRESIDENT],
      });

      const sent = bodies(spy)[0];
      expect(sent.subject).toContain('Longhorn Chess Club');
      expect(sent.text).toContain('Longhorn Chess Club');
      expect(sent.text).toMatch(/wasn't you/i);
    });

    it('sends from the verified domain', async () => {
      const spy = captureSends();
      await post('/register/verify-president', PRESIDENT, {
        org_id: ORG,
        email: EMAIL[PRESIDENT],
      });

      expect(bodies(spy)[0].from).toBe('Longhorn Loop <noreply@longhorndevelopers.org>');
    });

    it('escapes the org name — it comes from a scraped page', async () => {
      // Whoever edits a HornsLink listing controls this string and it lands in
      // HTML we send.
      db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(
        '<script>alert(1)</script>',
        ORG,
      );
      const spy = captureSends();
      await post('/register/verify-president', PRESIDENT, {
        org_id: ORG,
        email: EMAIL[PRESIDENT],
      });

      expect(bodies(spy)[0].html).not.toContain('<script>');
      expect(bodies(spy)[0].html).toContain('&lt;script&gt;');
    });

    it('rolls the code row back and answers 502 when the send fails', async () => {
      // Same reasoning as the sign-in path: the row IS the cooldown, so
      // leaving one behind for a code nobody received locks the president out
      // of retrying over someone else's outage.
      globalThis.fetch = vi.fn(async () =>
        Response.json({ message: 'blocked' }, { status: 403 }),
      ) as unknown as typeof fetch;

      const res = await post('/register/verify-president', PRESIDENT, {
        org_id: ORG,
        email: EMAIL[PRESIDENT],
      });

      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe('SEND_FAILED');
      expect(db.prepare('SELECT COUNT(*) AS c FROM verification_codes').get().c).toBe(0);
    });
  });

  describe('editor invite', () => {
    beforeEach(() => {
      db.exec(`INSERT INTO org_members (org_id, user_id, role) VALUES (${ORG}, ${ADMIN}, 'admin')`);
    });

    it('emails the invitee and reports email_sent: true', async () => {
      const spy = captureSends();
      const res = await post(`/${ORG}/invites`, ADMIN, {
        email: 'neweditor@utexas.edu',
        role: 'editor',
      });

      expect(res.status).toBe(201);
      expect((await res.json()).email_sent).toBe(true);
      expect(bodies(spy)[0].to).toEqual(['neweditor@utexas.edu']);
    });

    it('says who invited them and to which org', async () => {
      // "You have an invitation" from an unfamiliar sender is ignorable.
      const spy = captureSends();
      await post(`/${ORG}/invites`, ADMIN, { email: 'neweditor@utexas.edu', role: 'editor' });

      const sent = bodies(spy)[0];
      expect(sent.subject).toContain('Adah Minh');
      expect(sent.subject).toContain('Longhorn Chess Club');
      expect(sent.text).toContain('neweditor@utexas.edu'); // sign in with THIS address
    });

    it('KEEPS the invite row when the email fails, and says so', async () => {
      // Deliberately unlike the verification code. An invite is claimed by
      // signing in with the invited address, not by clicking anything in the
      // email, so the row is useful on its own — the admin can tell them in
      // person. Deleting it because a mail server hiccuped would throw away
      // the durable half of the feature.
      globalThis.fetch = vi.fn(async () =>
        Response.json({ message: 'blocked' }, { status: 403 }),
      ) as unknown as typeof fetch;

      const res = await post(`/${ORG}/invites`, ADMIN, {
        email: 'neweditor@utexas.edu',
        role: 'editor',
      });

      expect(res.status).toBe(201);
      expect((await res.json()).email_sent).toBe(false);
      expect(
        db
          .prepare('SELECT COUNT(*) AS c FROM org_invites WHERE email = ?')
          .get('neweditor@utexas.edu').c,
      ).toBe(1);
    });

    it('never emails a non-UT address', async () => {
      const spy = captureSends();
      const res = await post(`/${ORG}/invites`, ADMIN, {
        email: 'someone@gmail.com',
        role: 'editor',
      });

      expect(res.status).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
