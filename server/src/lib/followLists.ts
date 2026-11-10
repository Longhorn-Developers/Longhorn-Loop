// Follower and following lists (LOOP-307).
//
// WHO CAN SEE THEM: any signed-in user, the Instagram rule for a public
// account. Loop has no private accounts, so that is every account. Orgs the
// same. Decided 2026-11-09; the deciding factor was cost, and each list page
// is one query on an index that already existed (idx_user_follows_followed,
// and the primary keys of user_follows and org_followers).
//
// BLOCKS, BOTH WAYS AND FROM TWO SIDES. A row is hidden when there is a block
// between it and the VIEWER -- mutual invisibility means a blocked person must
// not turn up in anyone's list you open -- and also when there is a block
// between it and the list's OWNER, which is what getFollowCounts already
// excludes, so the list and the number on the profile agree. A viewer blocked
// with the owner never gets this far: the route 404s, as the profile does.
//
// A USER'S "FOLLOWING" HOLDS PEOPLE AND ORGS. following_count is
// user_follows + org_followers (see getFollowCounts in users.worker.ts), so
// the list is the union of both, newest follow first, each row tagged with
// its kind. Followers are always people: an org can't follow a person.
//
// KEYSET PAGINATION on (followed_at, kind, id), newest first, the same opaque
// cursor shape as GET /orgs/search. Offset paging would skip or repeat rows as
// people follow and unfollow between pages.

import { blockedUserFilter } from './blocks';
import { decodeCursor, encodeCursor } from './cursor';
import { parseStoredAvatarConfig } from '../../../shared/avatar';

export const FOLLOW_LIST_PAGE_SIZE = 30;
/** Longest search string accepted; longer is truncated, never an error. */
const MAX_QUERY_LENGTH = 80;

export interface FollowListUser {
  kind: 'user';
  id: number;
  first_name: string;
  last_name: string;
  year_classification: string | null;
  majors: string[];
  avatar: number | null;
  avatar_config: unknown;
  profile_photo_url: string | null;
  /** Whether the VIEWER follows this person. */
  is_following: boolean;
  /** The viewer's own row: the client shows no Follow button on it. */
  is_self: boolean;
}

export interface FollowListOrg {
  kind: 'org';
  id: number;
  name: string;
  category: string | null;
  profile_picture: string | null;
  verified: boolean;
  /** Whether the VIEWER follows this org. */
  is_following: boolean;
}

export type FollowListEntry = FollowListUser | FollowListOrg;

export interface FollowListPage {
  entries: FollowListEntry[];
  nextCursor: string | null;
}

export class InvalidCursorError extends Error {}

interface Options {
  viewerId: number;
  cursor?: string | null;
  q?: string | null;
  limit?: number;
}

type Cursor = { k: [string, string, number] };

function parseCursor(raw: string | null | undefined): Cursor['k'] | null {
  if (!raw) return null;
  const decoded = decodeCursor<Cursor>(raw);
  const k = decoded?.k;
  if (
    !Array.isArray(k) ||
    k.length !== 3 ||
    typeof k[0] !== 'string' ||
    (k[1] !== 'user' && k[1] !== 'org') ||
    typeof k[2] !== 'number'
  ) {
    throw new InvalidCursorError();
  }
  return k;
}

/** LIKE pattern for a name search, with LIKE's own wildcards escaped. */
function likePattern(q: string | null | undefined): string | null {
  const trimmed = (q ?? '').trim().slice(0, MAX_QUERY_LENGTH).toLowerCase();
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * The outer query every list shares: keyset + order + limit around a derived
 * table `t` with columns (kind, id, ..., followed_at).
 */
function pageQuery(inner: string, cursor: Cursor['k'] | null): { sql: string; binds: unknown[] } {
  // Newest first; kind and id only break ties between follows made in the
  // same second, so the order is total and the cursor is unambiguous.
  const keyset = cursor
    ? `WHERE t.followed_at < ?
          OR (t.followed_at = ? AND t.kind < ?)
          OR (t.followed_at = ? AND t.kind = ? AND t.id < ?)`
    : '';
  const binds = cursor ? [cursor[0], cursor[0], cursor[1], cursor[0], cursor[1], cursor[2]] : [];
  return {
    sql: `SELECT * FROM (${inner}) AS t ${keyset}
          ORDER BY t.followed_at DESC, t.kind DESC, t.id DESC
          LIMIT ?`,
    binds,
  };
}

// Column list shared by both halves of the following union, so the two SELECTs
// line up position for position.
const USER_COLUMNS = (viewerParam: string) => `
  'user' AS kind, u.id AS id,
  u.first_name AS first_name, u.last_name AS last_name, NULL AS org_name,
  u.year_classification AS year_classification, NULL AS category,
  u.avatar AS avatar, u.avatar_config AS avatar_config,
  u.profile_photo_url AS profile_photo_url, NULL AS org_picture, 0 AS verified,
  EXISTS (SELECT 1 FROM user_follows v
           WHERE v.follower_user_id = ${viewerParam} AND v.followed_user_id = u.id) AS is_following`;

const ORG_COLUMNS = (viewerParam: string) => `
  'org' AS kind, o.id AS id,
  NULL AS first_name, NULL AS last_name, o.name AS org_name,
  NULL AS year_classification, o.category AS category,
  NULL AS avatar, NULL AS avatar_config,
  NULL AS profile_photo_url, o.profile_picture AS org_picture, o.verified AS verified,
  EXISTS (SELECT 1 FROM org_followers v
           WHERE v.org_id = o.id AND v.user_id = ${viewerParam}) AS is_following`;

interface Row {
  kind: 'user' | 'org';
  id: number;
  first_name: string | null;
  last_name: string | null;
  org_name: string | null;
  year_classification: string | null;
  category: string | null;
  avatar: number | null;
  avatar_config: string | null;
  profile_photo_url: string | null;
  org_picture: string | null;
  verified: number;
  is_following: number;
  followed_at: string;
}

async function finish(
  db: D1Database,
  rows: Row[],
  limit: number,
  viewerId: number,
): Promise<FollowListPage> {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ k: [last.followed_at, last.kind, last.id] })
      : null;

  // Majors in one query for the whole page, rather than one per row.
  const userIds = page.filter((r) => r.kind === 'user').map((r) => r.id);
  const majors = new Map<number, string[]>();
  if (userIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT user_id, major FROM user_majors
          WHERE user_id IN (${userIds.map(() => '?').join(', ')})
          ORDER BY user_id, major`,
      )
      .bind(...userIds)
      .all<{ user_id: number; major: string }>();
    for (const r of results ?? []) {
      majors.set(r.user_id, [...(majors.get(r.user_id) ?? []), r.major]);
    }
  }

  const entries: FollowListEntry[] = page.map((r) =>
    r.kind === 'user'
      ? {
          kind: 'user',
          id: r.id,
          first_name: r.first_name ?? '',
          last_name: r.last_name ?? '',
          year_classification: r.year_classification,
          majors: majors.get(r.id) ?? [],
          avatar: r.avatar,
          avatar_config: parseStoredAvatarConfig(r.avatar_config),
          profile_photo_url: r.profile_photo_url,
          is_following: !!r.is_following,
          is_self: r.id === viewerId,
        }
      : {
          kind: 'org',
          id: r.id,
          name: r.org_name ?? '',
          category: r.category,
          profile_picture: r.org_picture,
          verified: Number(r.verified) === 1,
          is_following: !!r.is_following,
        },
  );
  return { entries, nextCursor };
}

/** People who follow `ownerId`. */
export async function listUserFollowers(
  db: D1Database,
  ownerId: number,
  { viewerId, cursor, q, limit = FOLLOW_LIST_PAGE_SIZE }: Options,
): Promise<FollowListPage> {
  const k = parseCursor(cursor);
  const like = likePattern(q);
  const ownerBlock = blockedUserFilter(ownerId, 'u.id');
  const viewerBlock = blockedUserFilter(viewerId, 'u.id');

  const inner = `
    SELECT ${USER_COLUMNS('?')}, f.created_at AS followed_at
      FROM user_follows f
      JOIN users u ON u.id = f.follower_user_id
     WHERE f.followed_user_id = ?${ownerBlock.sql}${viewerBlock.sql}
       ${like ? `AND lower(u.first_name || ' ' || u.last_name) LIKE ? ESCAPE '\\'` : ''}`;
  const page = pageQuery(inner, k);

  const { results } = await db
    .prepare(page.sql)
    .bind(
      viewerId,
      ownerId,
      ...ownerBlock.params,
      ...viewerBlock.params,
      ...(like ? [like] : []),
      ...page.binds,
      limit + 1,
    )
    .all<Row>();
  return finish(db, results ?? [], limit, viewerId);
}

/** People AND orgs that `ownerId` follows, matching following_count. */
export async function listUserFollowing(
  db: D1Database,
  ownerId: number,
  { viewerId, cursor, q, limit = FOLLOW_LIST_PAGE_SIZE }: Options,
): Promise<FollowListPage> {
  const k = parseCursor(cursor);
  const like = likePattern(q);
  const ownerBlock = blockedUserFilter(ownerId, 'u.id');
  const viewerBlock = blockedUserFilter(viewerId, 'u.id');

  const inner = `
    SELECT ${USER_COLUMNS('?')}, f.created_at AS followed_at
      FROM user_follows f
      JOIN users u ON u.id = f.followed_user_id
     WHERE f.follower_user_id = ?${ownerBlock.sql}${viewerBlock.sql}
       ${like ? `AND lower(u.first_name || ' ' || u.last_name) LIKE ? ESCAPE '\\'` : ''}
    UNION ALL
    SELECT ${ORG_COLUMNS('?')}, ofl.created_at AS followed_at
      FROM org_followers ofl
      JOIN organizations o ON o.id = ofl.org_id
     WHERE ofl.user_id = ?
       ${like ? `AND lower(o.name) LIKE ? ESCAPE '\\'` : ''}`;
  const page = pageQuery(inner, k);

  const { results } = await db
    .prepare(page.sql)
    .bind(
      viewerId,
      ownerId,
      ...ownerBlock.params,
      ...viewerBlock.params,
      ...(like ? [like] : []),
      viewerId,
      ownerId,
      ...(like ? [like] : []),
      ...page.binds,
      limit + 1,
    )
    .all<Row>();
  return finish(db, results ?? [], limit, viewerId);
}

/** People who follow org `orgId`. */
export async function listOrgFollowers(
  db: D1Database,
  orgId: number,
  { viewerId, cursor, q, limit = FOLLOW_LIST_PAGE_SIZE }: Options,
): Promise<FollowListPage> {
  const k = parseCursor(cursor);
  const like = likePattern(q);
  const viewerBlock = blockedUserFilter(viewerId, 'u.id');

  const inner = `
    SELECT ${USER_COLUMNS('?')}, ofl.created_at AS followed_at
      FROM org_followers ofl
      JOIN users u ON u.id = ofl.user_id
     WHERE ofl.org_id = ?${viewerBlock.sql}
       ${like ? `AND lower(u.first_name || ' ' || u.last_name) LIKE ? ESCAPE '\\'` : ''}`;
  const page = pageQuery(inner, k);

  const { results } = await db
    .prepare(page.sql)
    .bind(viewerId, orgId, ...viewerBlock.params, ...(like ? [like] : []), ...page.binds, limit + 1)
    .all<Row>();
  return finish(db, results ?? [], limit, viewerId);
}
