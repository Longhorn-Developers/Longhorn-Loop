/**
 * Org meeting times (LOOP-319), through orgRoutes against a real SQLite
 * database built from server/schema.sql.
 *
 * The rule that matters: a NON-MEMBER cannot read an org's meetings from the
 * API. The landing page only showing the section to members is presentation;
 * this route is the gate. Plus: editors read but can't write, admins can, and
 * an admin of one org can't touch another org's meeting by id.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
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
const ORG = 900;
const OTHER_ORG = 901;
const USERS = {
  admin: { id: 1, email: 'admin@utexas.edu' },
  editor: { id: 2, email: 'editor@utexas.edu' },
  stranger: { id: 3, email: 'stranger@utexas.edu' },
  otherAdmin: { id: 4, email: 'other@utexas.edu' },
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
}

async function signJwt(email: string): Promise<string> {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=/g, '');
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ email, iat: now, exp: now + 60 })}`;
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

const MEETING = {
  label: 'General meeting',
  day_of_week: 2,
  start_time: '19:00',
  end_time: '20:30',
  location: 'GDC 2.216',
  notes: null,
};

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('org meetings (LOOP-319)', () => {
  let db: any;
  let env: Env;

  async function call(
    who: keyof typeof USERS,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const token = await signJwt(USERS[who].email);
    return orgRoutes.request(
      `http://longhorn-loop.test${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
  }

  beforeEach(() => {
    db = new DatabaseSync!(':memory:');
    db.exec(readFileSync(join(__dirname, '..', '..', 'schema.sql'), 'utf-8'));
    for (const u of Object.values(USERS)) {
      db.prepare(
        `INSERT INTO users (id, email, first_name, last_name) VALUES (?, ?, 'T', 'U')`,
      ).run(u.id, u.email);
    }
    db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?), (?, ?)').run(
      ORG,
      'Robotics Club',
      OTHER_ORG,
      'Chess Club',
    );
    db.prepare(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'admin')`).run(
      ORG,
      USERS.admin.id,
    );
    db.prepare(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'editor')`).run(
      ORG,
      USERS.editor.id,
    );
    db.prepare(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'admin')`).run(
      OTHER_ORG,
      USERS.otherAdmin.id,
    );
    env = { DB: new SqliteD1(db) as unknown as D1Database, JWT_SECRET } as Env;
  });

  it('lets an admin add a meeting, and members read it in week order', async () => {
    const created = await call('admin', 'POST', `/${ORG}/meetings`, MEETING);
    expect(created.status).toBe(201);
    await call('admin', 'POST', `/${ORG}/meetings`, {
      ...MEETING,
      label: 'Build night',
      day_of_week: 0,
    });

    for (const who of ['admin', 'editor'] as const) {
      const res = await call(who, 'GET', `/${ORG}/meetings`);
      expect(res.status).toBe(200);
      const { meetings } = (await res.json()) as { meetings: { label: string }[] };
      expect(meetings.map((m) => m.label)).toEqual(['Build night', 'General meeting']);
    }
  });

  it('never returns meetings to a non-member', async () => {
    await call('admin', 'POST', `/${ORG}/meetings`, MEETING);
    const res = await call('stranger', 'GET', `/${ORG}/meetings`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'NOT_A_MEMBER' });
    expect(JSON.stringify(body)).not.toContain('GDC');
  });

  it('refuses writes from an editor', async () => {
    expect((await call('editor', 'POST', `/${ORG}/meetings`, MEETING)).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM org_meetings').get().n).toBe(0);
  });

  it('validates input', async () => {
    const res = await call('admin', 'POST', `/${ORG}/meetings`, {
      ...MEETING,
      day_of_week: 9,
      end_time: '18:00',
      location: '',
    });
    expect(res.status).toBe(400);
    const { errors } = (await res.json()) as { errors: Record<string, string> };
    expect(Object.keys(errors).sort()).toEqual(['day_of_week', 'end_time', 'location']);
  });

  it('edits and deletes only within the admin’s own org', async () => {
    const created = (await (await call('admin', 'POST', `/${ORG}/meetings`, MEETING)).json()) as {
      meeting: { id: number };
    };
    const id = created.meeting.id;

    // An admin of a DIFFERENT org can't reach it, even with the right id.
    expect((await call('otherAdmin', 'PATCH', `/${ORG}/meetings/${id}`, MEETING)).status).toBe(403);
    expect((await call('otherAdmin', 'DELETE', `/${OTHER_ORG}/meetings/${id}`)).status).toBe(404);

    const edited = await call('admin', 'PATCH', `/${ORG}/meetings/${id}`, {
      ...MEETING,
      location: 'ETC 2.102',
    });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { meeting: { location: string } }).meeting.location).toBe(
      'ETC 2.102',
    );

    expect((await call('admin', 'DELETE', `/${ORG}/meetings/${id}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM org_meetings').get().n).toBe(0);
  });
});
