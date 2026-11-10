// Follower / following lists (LOOP-307; the sheet is LOOP-312).
//
// Reads GET /users/:id/followers, GET /users/:id/following and
// GET /orgs/:id/followers. Every list is keyset-paginated with an opaque
// cursor and takes an optional ?q= name search, done on the server so it
// covers people beyond the first page. Shapes mirror server/src/lib/followLists.ts.
//
// Visibility is the Instagram rule for a public account -- any signed-in user
// can open any list -- and the server applies the block filter, so nothing
// here needs to hide rows.
//
// Replaces the LOOP-312 stub and its sample people. The stub kept follow taps
// local because sample ids could collide with real users; real rows follow and
// unfollow through the same endpoints as the profile buttons.

import { api } from '@/app/lib/api';
import type { AvatarConfig } from '@/shared/avatar';

/** Which list. Orgs only have followers. */
export type FollowListKind = 'followers' | 'following';

/** Whose list: a person's, or an org's. */
export type FollowListSubject = { type: 'user'; id: number } | { type: 'org'; id: number };

export interface FollowListUser {
  kind: 'user';
  id: number;
  first_name: string;
  last_name: string;
  year_classification: string | null;
  majors: string[];
  avatar: number | null;
  avatar_config: AvatarConfig | null;
  profile_photo_url: string | null;
  /** Whether the VIEWER follows this person. */
  is_following: boolean;
  /** The viewer's own row; it gets no Follow button. */
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

export function followListPath(subject: FollowListSubject, kind: FollowListKind): string {
  return subject.type === 'org' ? `/orgs/${subject.id}/followers` : `/users/${subject.id}/${kind}`;
}

export async function fetchFollowList(
  subject: FollowListSubject,
  kind: FollowListKind,
  { cursor, q, token }: { cursor?: string | null; q?: string; token: string | null },
): Promise<FollowListPage> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (q?.trim()) params.set('q', q.trim());
  const qs = params.toString();
  return api.get<FollowListPage>(`${followListPath(subject, kind)}${qs ? `?${qs}` : ''}`, {
    token,
  });
}

/** The follow / unfollow call for one row, whichever kind it is. */
export function toggleFollow(
  entry: Pick<FollowListEntry, 'kind' | 'id'>,
  next: boolean,
  token: string | null,
): Promise<unknown> {
  const path = entry.kind === 'org' ? `/orgs/${entry.id}/follow` : `/users/${entry.id}/follow`;
  return next ? api.post(path, { token }) : api.delete(path, { token });
}
