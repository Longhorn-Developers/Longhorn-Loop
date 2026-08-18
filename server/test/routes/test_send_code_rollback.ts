/**
 * /auth/send-code and /auth/resend-code when Resend is down (LOOP-255).
 *
 * The bug this locks down: the routes wrote the new code row and THEN called
 * Resend, with no try/catch. A failed send therefore left the user with
 *
 *   - a 500 they could not act on,
 *   - `last_sent_at = now`, so the retry they made two seconds later came back
 *     RESEND_TOO_SOON for a full minute, and
 *   - the code they were previously holding overwritten by one that had just
 *     been thrown away.
 *
 * Every assertion below is about state AFTER a failed send, because that is
 * where the damage was and none of it is visible in the response.
 *
 * Runs the real Hono handlers against a real SQLite DB built from schema.sql,
 * through the same D1 shim as routes/test_public_profiles.ts. Resend is the
 * only thing stubbed — global fetch — since it is the dependency whose failure
 * is the entire subject.
 *
 * Skips below Node 22 (node:sqlite), same as its siblings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authRoutes } from '../../src/routes/auth.worker';
import type { Env } from '../../src/worker';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const EMAIL = 'mwalker@utexas.edu';

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
  async batch(statements: SqliteD1Statement[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const s of statements) out.push(await s.run());
    return out;
  }
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('verification code send failures (LOOP-255)', () => {
  let db: any;
  let env: Env;
  const realFetch = globalThis.fetch;

  /** Make every Resend call fail the way a 403 or an outage does. */
  function breakResend() {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ message: 'Domain not verified' }, { status: 403 }),
    ) as unknown as typeof fetch;
  }

  /** Let Resend "succeed" without leaving the process. */
  function workingResend() {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ id: 'sent' }, { status: 200 }),
    ) as unknown as typeof fetch;
  }

  const post = (path: string, body: unknown) =>
    authRoutes.request(
      `http://longhorn-loop.test${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    );

  const row = () =>
    db.prepare('SELECT * FROM verification_codes WHERE email = ?').get(EMAIL) ?? null;

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));
    db.exec(
      `INSERT INTO users (id, email, first_name, last_name) VALUES (1, '${EMAIL}', 'M', 'W')`,
    );

    env = {
      DB: new SqliteD1(db) as unknown as D1Database,
      JWT_SECRET: 'test-secret',
      RESEND_API_KEY: 'test-key',
      // Explicitly NOT dev mode — dev mode short-circuits before Resend and
      // would make every test here pass without exercising anything.
      EMAIL_FROM: 'Longhorn Loop <noreply@longhorndevelopers.org>',
    } as Env;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('answers 502 SEND_FAILED rather than a bare 500', async () => {
    breakResend();
    const res = await post('/send-code', { email: EMAIL });

    // 502 is the honest code: we are fine, the thing we depend on is not.
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('SEND_FAILED');
  });

  it('leaves NO row behind when there was none before', async () => {
    breakResend();
    await post('/send-code', { email: EMAIL });

    // The row is the cooldown. A row for a code that was never delivered is a
    // 60-second lockout earned by someone else's outage.
    expect(row()).toBeNull();
  });

  it('lets the user retry IMMEDIATELY — no RESEND_TOO_SOON', async () => {
    breakResend();
    await post('/send-code', { email: EMAIL });

    // This is the whole point. Before the fix this second call returned 429,
    // so the user watched it fail and then could not try again for a minute.
    workingResend();
    const retry = await post('/send-code', { email: EMAIL });

    expect(retry.status).toBe(200);
    expect((await retry.json()).message).toBe('VERIFICATION_CODE_SENT');
    expect(row()).not.toBeNull();
  });

  it('preserves a still-valid earlier code instead of destroying it', async () => {
    // Someone requests a code, gets it, and 90 seconds later (past the
    // cooldown) taps Resend because it landed in spam. Resend is down now.
    workingResend();
    await post('/send-code', { email: EMAIL });
    const before = row();

    // Age the row past the 60s cooldown without waiting 60 real seconds.
    db.prepare('UPDATE verification_codes SET last_sent_at = ? WHERE email = ?').run(
      before.last_sent_at - 90_000,
      EMAIL,
    );
    const aged = row();

    breakResend();
    const res = await post('/resend-code', { email: EMAIL });
    expect(res.status).toBe(502);

    // The code in their inbox still works. Every column is back where it was —
    // in particular code_hash, so the digits they are looking at still verify,
    // and last_sent_at, so they are not newly rate-limited.
    const after = row();
    expect(after.code_hash).toBe(aged.code_hash);
    expect(after.expires_at).toBe(aged.expires_at);
    expect(after.attempts).toBe(aged.attempts);
    expect(after.last_sent_at).toBe(aged.last_sent_at);
  });

  it('sends from the verified domain, not the Resend sandbox address', async () => {
    // onboarding@resend.dev only ever delivered to the Resend account owner.
    // It looked like it worked in dev for exactly that reason, and would have
    // delivered to zero beta testers. The domain also has to be one UT accepts
    // — longhornloop.me was verified with Resend and still refused at UT's
    // gateway, so "verified" and "deliverable" are not the same property.
    workingResend();
    await post('/send-code', { email: EMAIL });

    const [, init] = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.from).toBe('Longhorn Loop <noreply@longhorndevelopers.org>');
    expect(body.from).not.toContain('resend.dev');
    expect(body.to).toEqual([EMAIL]);
  });

  it('never reaches Resend at all for a non-UT address', async () => {
    breakResend();
    const res = await post('/send-code', { email: 'someone@gmail.com' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_UT_EMAIL');
    // A rejected address must not cost a send. The gate runs before the row
    // write and before the network call.
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS c FROM verification_codes').get().c).toBe(0);
  });

  it('dev mode still short-circuits Resend entirely', async () => {
    breakResend();
    const devEnv = { ...env, RESEND_DEV_MODE: 'true' } as Env;

    const res = await authRoutes.request(
      'http://longhorn-loop.test/send-code',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: EMAIL }),
      },
      devEnv,
    );

    expect(res.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
