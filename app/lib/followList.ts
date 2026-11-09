// Follower / following lists for the profile sheet (LOOP-312 step 4).
//
// ============================================================================
//  STUB -- LOOP-307 SEAM. There is no endpoint that returns who follows a
//  user or who they follow; the counts are computed server-side but the
//  people behind them are not exposed anywhere. Everything the sheet needs
//  from the backend goes through `fetchFollowList` below, so wiring the real
//  thing is: replace its body with the api.get call in the comment, flip
//  FOLLOW_LIST_IS_STUB to false, and delete DEV_SAMPLE.
// ============================================================================
//
// WHAT THE STUB RETURNS, AND WHY IT DIFFERS BY BUILD.
//   * Release builds get an empty list, and the sheet says the list is on its
//     way. Shipping invented people in a real profile would be a lie the user
//     can tap on.
//   * Dev builds get DEV_SAMPLE so the rows, the Follow Back / Following
//     states and the search can be checked against the Figma.
//
// SAMPLE IDS ARE NEGATIVE so they can never collide with a real users.id. That
// matters more than it looks: dev builds talk to the PRODUCTION Worker by
// default (app/config/api.ts), so a sample row whose Follow button hit
// POST /users/:id/follow with a plausible id would follow a real student. The
// sheet also checks FOLLOW_LIST_IS_STUB and keeps follow taps local while it is
// true, so neither safeguard depends on the other.
//
// The row shape is what LOOP-307 asks for -- "avatar, name, year/major", the
// same fields as the public-user row -- plus whether the viewer follows that
// person, which is what decides Follow Back vs Following.

import type { AvatarConfig } from '@/shared/avatar';

export type FollowListKind = 'followers' | 'following';

export interface FollowListEntry {
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
}

/** True until LOOP-307 lands. The sheet keeps follow taps local while set. */
export const FOLLOW_LIST_IS_STUB = true;

function sample(
  id: number,
  first: string,
  last: string,
  year: string,
  major: string,
  isFollowing: boolean,
): FollowListEntry {
  return {
    id,
    first_name: first,
    last_name: last,
    year_classification: year,
    majors: [major],
    avatar: null,
    avatar_config: null,
    profile_photo_url: null,
    is_following: isFollowing,
  };
}

// Names and subtitles from the Figma "Followers Tab" frame.
const DEV_SAMPLE: Record<FollowListKind, FollowListEntry[]> = {
  followers: [
    sample(-1, 'Maya', 'Chen', 'Sophomore', 'Computer Science', false),
    sample(-2, 'Sam', 'Rivera', 'Junior', 'Business', true),
    sample(-3, 'Alex', 'Kim', 'Freshman', 'Design', true),
    sample(-4, 'Priya', 'Shah', 'Senior', 'Biology', false),
    sample(-5, 'Jordan', 'Lee', 'Sophomore', 'Aerospace Engineering', true),
    sample(-6, 'Ethan', 'Brooks', 'Junior', 'Finance', false),
    sample(-7, 'Nina', 'Patel', 'Freshman', 'Neuroscience', true),
  ],
  following: [
    sample(-2, 'Sam', 'Rivera', 'Junior', 'Business', true),
    sample(-3, 'Alex', 'Kim', 'Freshman', 'Design', true),
    sample(-5, 'Jordan', 'Lee', 'Sophomore', 'Aerospace Engineering', true),
    sample(-7, 'Nina', 'Patel', 'Freshman', 'Neuroscience', true),
  ],
};

/**
 * The one call the sheet makes for its data.
 *
 * TODO(LOOP-307): replace the body with
 *   const res = await api.get<{ users: FollowListEntry[] }>(`/users/${userId}/${kind}`, { token });
 *   return res.users;
 * (keyset-paginated per the ticket -- the sheet will want useInfiniteQuery
 * once there is a cursor to page on).
 */
export async function fetchFollowList(
  userId: number,
  kind: FollowListKind,
  token: string | null,
): Promise<FollowListEntry[]> {
  void userId;
  void token;
  return __DEV__ ? DEV_SAMPLE[kind] : [];
}
