/**
 * Accepting an org invite.
 *
 * This grants privileges -- an accepted invite lets someone post and edit
 * events in another organisation's name -- so the cases below are the ones
 * that would grant too much, or to the wrong person, rather than the happy
 * path alone.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redeemPendingOrgInvites } from '../src/lib/orgInvites';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

// D1 shim over node:sqlite (mirrors routes/test_public_profiles.ts)
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
    return { meta: { last_row_id: Number(r.lastInsertRowid ?? 0), changes: Number(r.changes ?? 0) } };
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

const STUDENT = 1;
const ADMIN = 2;
const ORG = 900;
const OTHER_ORG = 901;
const EMAIL = 'student@my.utexas.edu';

const describeOrSkip = DatabaseSync ? describe : describe.skip;

describeOrSkip('accepting org invites', () => {
  let raw: any;
  let db: D1Database;

  const members = () =>
    raw.prepare('SELECT org_id, user_id, role FROM org_members ORDER BY org_id').all();
  const inviteStatus = (orgId: number) =>
    raw.prepare('SELECT status FROM org_invites WHERE org_id = ?').get(orgId)?.status;

  const addInvite = (orgId: number, email: string, role = 'editor', extra = '') =>
    raw.exec(
      `INSERT INTO org_invites (org_id, email, role, invited_by, status, expires_at)
       VALUES (${orgId}, '${email}', '${role}', ${ADMIN}, 'pending',
               datetime('now', '${extra || '+14 days'}'))`,
    );

  beforeEach(() => {
    raw = new (DatabaseSync as any)(':memory:');
    raw.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));
    db = new SqliteD1(raw) as unknown as D1Database;

    raw.exec(
      `INSERT INTO users (id, email, first_name, last_name) VALUES
         (${STUDENT}, '${EMAIL}', 'Stu', 'Dent'),
         (${ADMIN}, 'admin@my.utexas.edu', 'Ad', 'Min')`,
    );
    raw.exec(
      `INSERT INTO organizations (id, name, source) VALUES
         (${ORG}, 'Texas Rocketry', 'manual'),
         (${OTHER_ORG}, 'Longhorn Chess', 'manual')`,
    );
  });

  it('turns a pending invite into membership and marks it accepted', () => {
    addInvite(ORG, EMAIL, 'editor');

    return redeemPendingOrgInvites(db, STUDENT, EMAIL).then((granted) => {
      expect(granted).toEqual([{ orgId: ORG, orgName: 'Texas Rocketry', role: 'editor' }]);
      expect(members()).toEqual([{ org_id: ORG, user_id: STUDENT, role: 'editor' }]);
      expect(inviteStatus(ORG)).toBe('accepted');
    });
  });

  it('matches the email case-insensitively', async () => {
    // The admin types it however they like. An invite to "Student@..." and a
    // sign-in as "student@..." are the same person, and a case-sensitive
    // compare silently disagrees.
    addInvite(ORG, 'Student@My.UTexas.edu');
    const granted = await redeemPendingOrgInvites(db, STUDENT, EMAIL);
    expect(granted).toHaveLength(1);
  });

  it('redeems several invites at once', async () => {
    addInvite(ORG, EMAIL, 'editor');
    addInvite(OTHER_ORG, EMAIL, 'admin');
    const granted = await redeemPendingOrgInvites(db, STUDENT, EMAIL);
    expect(granted).toHaveLength(2);
    expect(members()).toHaveLength(2);
  });

  it('notifies the user for each organization they joined', async () => {
    // Membership that appears silently is indistinguishable from a bug.
    addInvite(ORG, EMAIL, 'editor');
    await redeemPendingOrgInvites(db, STUDENT, EMAIL);
    const notes = raw
      .prepare('SELECT user_id, type, title FROM notifications')
      .all();
    expect(notes).toEqual([
      { user_id: STUDENT, type: 'org_invite', title: 'You joined Texas Rocketry' },
    ]);
  });

  describe('what it must NOT do', () => {
    it('ignores an invite addressed to somebody else', async () => {
      addInvite(ORG, 'someone.else@my.utexas.edu');
      const granted = await redeemPendingOrgInvites(db, STUDENT, EMAIL);
      expect(granted).toEqual([]);
      expect(members()).toEqual([]);
      expect(inviteStatus(ORG)).toBe('pending');
    });

    it('ignores an expired invite', async () => {
      addInvite(ORG, EMAIL, 'editor', '-1 day');
      const granted = await redeemPendingOrgInvites(db, STUDENT, EMAIL);
      expect(granted).toEqual([]);
      expect(members()).toEqual([]);
    });

    it('ignores a revoked invite', async () => {
      addInvite(ORG, EMAIL);
      raw.exec(`UPDATE org_invites SET status = 'revoked' WHERE org_id = ${ORG}`);
      const granted = await redeemPendingOrgInvites(db, STUDENT, EMAIL);
      expect(granted).toEqual([]);
      expect(members()).toEqual([]);
    });

    it('never DEMOTES an existing member', async () => {
      // An admin invited again as an editor keeps admin. Without DO NOTHING
      // this is a privilege change nobody asked for, triggered by an invite
      // sent by someone who could not see the member list.
      raw.exec(
        `INSERT INTO org_members (org_id, user_id, role) VALUES (${ORG}, ${STUDENT}, 'admin')`,
      );
      addInvite(ORG, EMAIL, 'editor');
      await redeemPendingOrgInvites(db, STUDENT, EMAIL);
      expect(members()).toEqual([{ org_id: ORG, user_id: STUDENT, role: 'admin' }]);
      // Still consumed, so it stops showing as pending to the admin.
      expect(inviteStatus(ORG)).toBe('accepted');
    });

    it('is idempotent', async () => {
      addInvite(ORG, EMAIL);
      await redeemPendingOrgInvites(db, STUDENT, EMAIL);
      const second = await redeemPendingOrgInvites(db, STUDENT, EMAIL);
      // Runs on every /users/me, so a second pass must grant nothing and,
      // just as importantly, must not send a second notification.
      expect(second).toEqual([]);
      expect(members()).toHaveLength(1);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(1);
    });

    it('writes nothing at all when there is no invite', async () => {
      const granted = await redeemPendingOrgInvites(db, STUDENT, EMAIL);
      expect(granted).toEqual([]);
      expect(raw.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0);
    });
  });
});
