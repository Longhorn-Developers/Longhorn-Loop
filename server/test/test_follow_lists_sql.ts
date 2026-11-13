/**
 * Follower / following lists (LOOP-307), against a real SQLite database built
 * from server/schema.sql.
 *
 * What is worth pinning:
 *   1. BLOCKS, FROM BOTH SIDES. A row blocked with the VIEWER is hidden (in
 *      either direction), and so is a row blocked with the list's OWNER --
 *      that is what the profile's counts exclude, so list and count agree.
 *      The ticket calls this the part most likely to be missed, and it is a
 *      privacy bug if it is.
 *   2. Following = people + orgs, matching following_count.
 *   3. Keyset pages: no row lost or repeated across pages, even with ties on
 *      followed_at.
 *   4. is_following is the VIEWER's relationship, not the owner's.
 *
 * Skips below Node 22 (node:sqlite). CI runs Node 20 and does not run this
 * suite; this is a local guard.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidCursorError,
  listOrgFollowers,
  listUserFollowers,
  listUserFollowing,
  type FollowListEntry,
} from '../src/lib/followLists';

let DatabaseSync: (new (path: string) => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const describeOrSkip = DatabaseSync ? describe : describe.skip;

class Stmt {
  private params: unknown[] = [];
  constructor(
    private readonly raw: any,
    private readonly sql: string,
  ) {}
  bind(...params: unknown[]): Stmt {
    this.params = params;
    return this;
  }
  async first(): Promise<Record<string, unknown> | null> {
    return this.raw.prepare(this.sql).get(...this.params) ?? null;
  }
  async all(): Promise<{ results: Record<string, unknown>[] }> {
    return { results: this.raw.prepare(this.sql).all(...this.params) };
  }
  async run(): Promise<unknown> {
    return this.raw.prepare(this.sql).run(...this.params);
  }
}

const OWNER = 1;
const VIEWER = 2;
const ORG = 900;

describeOrSkip('follow lists (LOOP-307)', () => {
  let raw: any;
  let db: D1Database;

  const user = (id: number, first: string) =>
    raw
      .prepare(
        `INSERT INTO users (id, email, first_name, last_name, year_classification)
         VALUES (?, ?, ?, 'Test', 'Junior')`,
      )
      .run(id, `u${id}@utexas.edu`, first);
  const follows = (follower: number, followed: number, at = '2026-11-01 12:00:00') =>
    raw
      .prepare(
        'INSERT INTO user_follows (follower_user_id, followed_user_id, created_at) VALUES (?, ?, ?)',
      )
      .run(follower, followed, at);
  const block = (blocker: number, blocked: number) =>
    raw
      .prepare('INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)')
      .run(blocker, blocked);
  const names = (entries: FollowListEntry[]) =>
    entries.map((e) => (e.kind === 'user' ? e.first_name : `org:${e.name}`));

  beforeEach(() => {
    raw = new DatabaseSync!(':memory:');
    raw.exec(readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8'));
    db = {
      prepare: (sql: string) => new Stmt(raw, sql),
    } as unknown as D1Database;
    user(OWNER, 'Owner');
    user(VIEWER, 'Viewer');
    raw
      .prepare('INSERT INTO organizations (id, name, category, verified) VALUES (?, ?, ?, 1)')
      .run(ORG, 'Robotics Club', 'Technology');
  });

  it('lists followers newest first, with majors and the viewer-relative follow flag', async () => {
    user(10, 'Maya');
    user(11, 'Sam');
    follows(10, OWNER, '2026-11-01 10:00:00');
    follows(11, OWNER, '2026-11-02 10:00:00');
    follows(VIEWER, 11); // the viewer follows Sam, not Maya
    raw.prepare('INSERT INTO user_majors (user_id, major) VALUES (10, ?)').run('Computer Science');

    const { entries, nextCursor } = await listUserFollowers(db, OWNER, { viewerId: VIEWER });

    expect(names(entries)).toEqual(['Sam', 'Maya']);
    const maya = entries[1];
    expect(maya.kind === 'user' && maya.majors).toEqual(['Computer Science']);
    expect(entries.map((e) => e.is_following)).toEqual([true, false]);
    expect(nextCursor).toBeNull();
  });

  it('hides people blocked with the VIEWER, in either direction', async () => {
    user(10, 'BlockedByViewer');
    user(11, 'BlockedTheViewer');
    user(12, 'Visible');
    for (const id of [10, 11, 12]) follows(id, OWNER);
    block(VIEWER, 10);
    block(11, VIEWER);

    const { entries } = await listUserFollowers(db, OWNER, { viewerId: VIEWER });
    expect(names(entries)).toEqual(['Visible']);
  });

  it('hides people blocked with the OWNER, so the list matches the count', async () => {
    user(10, 'BlockedByOwner');
    user(11, 'Visible');
    follows(10, OWNER);
    follows(11, OWNER);
    block(OWNER, 10);

    const { entries } = await listUserFollowers(db, OWNER, { viewerId: VIEWER });
    expect(names(entries)).toEqual(['Visible']);
  });

  it('Following holds people and orgs, newest follow first', async () => {
    user(10, 'Maya');
    follows(OWNER, 10, '2026-11-01 10:00:00');
    raw
      .prepare('INSERT INTO org_followers (org_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(ORG, OWNER, '2026-11-03 10:00:00');
    raw.prepare('INSERT INTO org_followers (org_id, user_id) VALUES (?, ?)').run(ORG, VIEWER);

    const { entries } = await listUserFollowing(db, OWNER, { viewerId: VIEWER });

    expect(names(entries)).toEqual(['org:Robotics Club', 'Maya']);
    const org = entries[0];
    expect(org.kind === 'org' && org.verified).toBe(true);
    expect(org.is_following).toBe(true); // the VIEWER follows the org
  });

  it('pages without losing or repeating rows, even on tied timestamps', async () => {
    for (let id = 100; id < 107; id++) {
      user(id, `P${id}`);
      follows(id, OWNER, '2026-11-01 12:00:00'); // every follow in the same second
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listUserFollowers(db, OWNER, { viewerId: VIEWER, cursor, limit: 3 });
      seen.push(...names(page.entries));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toHaveLength(7);
  });

  it('searches names, and escapes LIKE wildcards', async () => {
    user(10, 'Maya');
    user(11, 'Sam');
    follows(10, OWNER);
    follows(11, OWNER);

    expect(
      names((await listUserFollowers(db, OWNER, { viewerId: VIEWER, q: 'MAY' })).entries),
    ).toEqual(['Maya']);
    expect((await listUserFollowers(db, OWNER, { viewerId: VIEWER, q: '%' })).entries).toEqual([]);
  });

  it('marks the viewer’s own row so the client shows no Follow button on it', async () => {
    follows(VIEWER, OWNER);
    const { entries } = await listUserFollowers(db, OWNER, { viewerId: VIEWER });
    expect(entries[0].kind === 'user' && entries[0].is_self).toBe(true);
  });

  it('lists an org’s followers with the viewer’s block filter applied', async () => {
    user(10, 'Maya');
    user(11, 'Blocked');
    for (const id of [10, 11]) {
      raw.prepare('INSERT INTO org_followers (org_id, user_id) VALUES (?, ?)').run(ORG, id);
    }
    block(VIEWER, 11);

    const { entries } = await listOrgFollowers(db, ORG, { viewerId: VIEWER });
    expect(names(entries)).toEqual(['Maya']);
  });

  it('rejects a malformed cursor instead of returning page one', async () => {
    await expect(
      listUserFollowers(db, OWNER, { viewerId: VIEWER, cursor: 'not-a-cursor' }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });
});
