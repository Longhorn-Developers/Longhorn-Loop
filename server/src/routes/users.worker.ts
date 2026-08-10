// User routes for Cloudflare Worker + D1
import { Hono } from 'hono';
import {
  MAX_LINKED_SOCIALS,
  isSocialPlatformId,
  probeSocialUrl,
  socialUrlErrorMessage,
  validateSocialUrl,
} from '../lib/socialLinks';
import { getAuthUser, getUserId } from '../lib/utils';
import { getSocialPlatform } from '../../../shared/socialPlatforms';
import {
  PROFILE_EVENT_FILTERS,
  PROFILE_EVENT_TABS,
  bucketsForFilter,
  isProfileEventFilter,
  isProfileEventTab,
} from '../../../shared/profileEventFilters';
import type { Env } from '../worker';

export const userRoutes = new Hono<{ Bindings: Env }>();

/** Bio cap shown by the Edit Profile counter ("44 / 150"). */
const MAX_BIO = 150;

/**
 * users.unique_classification is written by the onboarding upsert as a JSON
 * string (e.g. '["International"]'). Return it as an array so clients don't
 * each have to parse it, and tolerate a bare string or NULL rather than
 * throwing on data that predates the JSON encoding.
 */
function parseUniqueClassification(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
    return [String(parsed)];
  } catch {
    return [value];
  }
}

/**
 * The "N followers · N following" line on the profile header.
 *
 * `following` deliberately counts BOTH users and orgs. To someone reading
 * their own profile it means "things I follow", and the app lets you follow
 * orgs as well as people — reporting only user follows would show 0 for a
 * student who follows twenty orgs and nobody. Followers is users only,
 * because an org can't follow a person.
 */
async function getFollowCounts(
  db: D1Database,
  userId: number,
): Promise<{ follower_count: number; following_count: number }> {
  const followers = await db
    .prepare('SELECT COUNT(*) AS c FROM user_follows WHERE followed_user_id = ?')
    .bind(userId)
    .first();

  const following = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM user_follows WHERE follower_user_id = ?1)
       + (SELECT COUNT(*) FROM org_followers WHERE user_id = ?1) AS c`,
    )
    .bind(userId)
    .first();

  return {
    follower_count: (followers?.c as number) ?? 0,
    following_count: (following?.c as number) ?? 0,
  };
}

// POST /users/me/agreements
userRoutes.post('/me/agreements', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const {
    agreed_responsible_use,
    agreed_visibility_acknowledgment,
    agreed_community_guidelines,
    notifications_enabled,
  } = await c.req.json();

  if (
    agreed_responsible_use !== true ||
    agreed_visibility_acknowledgment !== true ||
    agreed_community_guidelines !== true
  ) {
    return c.json({ error: 'TERMS_NOT_ACCEPTED' }, 400);
  }

  // Update user record in D1
  await c.env.DB.prepare(
    `UPDATE users SET
       agreed_responsible_use = 1,
       agreed_visibility_acknowledgment = 1,
       agreed_community_guidelines = 1,
       notifications_enabled = ?,
       terms_accepted_at = datetime('now'),
       onboarding_completed = 1
     WHERE email = ?`,
  )
    .bind(notifications_enabled === true ? 1 : 0, user.email)
    .run();

  const updatedUser = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(user.email)
    .first();

  return c.json({ message: 'AGREEMENTS_SAVED', user: updatedUser });
});

// POST /users/me/profile -- save onboarding profile data (majors, tags, avatar, etc.)
userRoutes.post('/me/profile', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const {
    first_name,
    last_name,
    avatar,
    year_classification,
    unique_classification,
    majors,
    tags,
  } = await c.req.json();

  const uniqueClassificationJson = Array.isArray(unique_classification)
    ? JSON.stringify(unique_classification)
    : unique_classification;

  // Upsert user record
  await c.env.DB.prepare(
    `INSERT INTO users (email, first_name, last_name, avatar, year_classification, unique_classification)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       avatar = excluded.avatar,
       year_classification = excluded.year_classification,
       unique_classification = excluded.unique_classification`,
  )
    .bind(user.email, first_name, last_name, avatar, year_classification, uniqueClassificationJson)
    .run();

  // Get user ID
  const dbUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(user.email)
    .first();

  if (!dbUser) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const userId = dbUser.id as number;

  // Replace majors
  await c.env.DB.prepare('DELETE FROM user_majors WHERE user_id = ?').bind(userId).run();
  if (majors && Array.isArray(majors)) {
    for (const major of majors) {
      await c.env.DB.prepare('INSERT INTO user_majors (user_id, major) VALUES (?, ?)')
        .bind(userId, major)
        .run();
    }
  }

  // Replace tags. No cap — the user may pick as many interests as they like.
  await c.env.DB.prepare('DELETE FROM user_tags WHERE user_id = ?').bind(userId).run();
  if (tags && Array.isArray(tags)) {
    for (const tag of tags) {
      await c.env.DB.prepare('INSERT INTO user_tags (user_id, tag) VALUES (?, ?)')
        .bind(userId, tag)
        .run();
    }
  }

  return c.json({ message: 'PROFILE_SAVED' });
});

// GET /users/me -- get current user profile
userRoutes.get('/me', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const dbUser = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(user.email)
    .first();

  if (!dbUser) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const userId = dbUser.id as number;

  // Fetch majors and tags
  const majors = await c.env.DB.prepare('SELECT major FROM user_majors WHERE user_id = ?')
    .bind(userId)
    .all();

  const tags = await c.env.DB.prepare('SELECT tag FROM user_tags WHERE user_id = ?')
    .bind(userId)
    .all();

  // Linked socials (LOOP-181). Ordered by connection time so the icon chips
  // on the profile keep a stable order between renders.
  const socials = await c.env.DB.prepare(
    'SELECT platform, url FROM user_socials WHERE user_id = ? ORDER BY created_at ASC, platform ASC',
  )
    .bind(userId)
    .all();

  const counts = await getFollowCounts(c.env.DB, userId);

  return c.json({
    user: {
      ...dbUser,
      // Stored as a JSON string by the onboarding upsert. Parse it here so
      // every consumer doesn't have to — and so a legacy plain-string value
      // still comes back as an array rather than exploding.
      unique_classification: parseUniqueClassification(dbUser.unique_classification),
      majors: majors.results.map((r) => r.major),
      tags: tags.results.map((r) => r.tag),
      socials: socials.results,
      ...counts,
    },
  });
});

// PATCH /users/me/profile -- Edit Profile save (LOOP-181, extends LOOP-130).
//
// Distinct from POST /me/profile, which is the onboarding upsert and requires
// the full payload. This one applies only the fields present in the body, so
// the Edit Profile screen can save a bio without clearing majors.
userRoutes.patch('/me/profile', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, user.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'INVALID_BODY' }, 400);

  const {
    first_name,
    last_name,
    avatar,
    year_classification,
    unique_classification,
    bio,
    majors,
    tags,
  } = body as Record<string, unknown>;

  // Figma shows a red asterisk on the name field when it's empty or too long.
  // Enforce the same rule here so a crafted request can't bypass it.
  if (first_name !== undefined) {
    if (typeof first_name !== 'string' || !first_name.trim()) {
      return c.json({ error: 'INVALID_FIRST_NAME' }, 400);
    }
    if (first_name.trim().length > 50) return c.json({ error: 'FIRST_NAME_TOO_LONG' }, 400);
  }
  if (last_name !== undefined) {
    if (typeof last_name !== 'string' || !last_name.trim()) {
      return c.json({ error: 'INVALID_LAST_NAME' }, 400);
    }
    if (last_name.trim().length > 50) return c.json({ error: 'LAST_NAME_TOO_LONG' }, 400);
  }
  if (bio !== undefined && bio !== null) {
    if (typeof bio !== 'string') return c.json({ error: 'INVALID_BIO' }, 400);
    // 150 is the cap the Edit Profile counter shows ("44 / 150"). Keep this in
    // step with MAX_BIO in app/profile/edit.tsx.
    if (bio.length > MAX_BIO) return c.json({ error: 'BIO_TOO_LONG', max: MAX_BIO }, 400);
  }

  // Build the UPDATE from only the keys actually supplied.
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (first_name !== undefined) {
    sets.push('first_name = ?');
    binds.push((first_name as string).trim());
  }
  if (last_name !== undefined) {
    sets.push('last_name = ?');
    binds.push((last_name as string).trim());
  }
  if (avatar !== undefined) {
    sets.push('avatar = ?');
    binds.push(avatar);
  }
  if (year_classification !== undefined) {
    sets.push('year_classification = ?');
    binds.push(year_classification);
  }
  if (bio !== undefined) {
    sets.push('bio = ?');
    binds.push(bio === null ? null : (bio as string).trim());
  }
  if (unique_classification !== undefined) {
    if (!Array.isArray(unique_classification)) {
      return c.json({ error: 'INVALID_UNIQUE_CLASSIFICATION' }, 400);
    }
    // Stored JSON-encoded, matching the onboarding upsert's format.
    sets.push('unique_classification = ?');
    binds.push(JSON.stringify(unique_classification.map(String)));
  }

  if (sets.length > 0) {
    binds.push(userId);
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  }

  // Interests and majors are replace-all, matching the onboarding endpoint.
  // Both are only touched when the key is present, so a PATCH that saves just
  // a bio can't wipe either of them.
  if (tags !== undefined) {
    if (!Array.isArray(tags)) return c.json({ error: 'INVALID_TAGS' }, 400);
    await c.env.DB.prepare('DELETE FROM user_tags WHERE user_id = ?').bind(userId).run();
    for (const tag of tags) {
      await c.env.DB.prepare(
        'INSERT INTO user_tags (user_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(userId, String(tag))
        .run();
    }
  }

  if (majors !== undefined) {
    if (!Array.isArray(majors)) return c.json({ error: 'INVALID_MAJORS' }, 400);
    await c.env.DB.prepare('DELETE FROM user_majors WHERE user_id = ?').bind(userId).run();
    for (const major of majors) {
      await c.env.DB.prepare(
        'INSERT INTO user_majors (user_id, major) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(userId, String(major))
        .run();
    }
  }

  return c.json({ message: 'PROFILE_UPDATED' });
});

// GET /users/me/socials -- list the current user's linked socials (LOOP-181)
userRoutes.get('/me/socials', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, user.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT platform, url, created_at FROM user_socials WHERE user_id = ? ORDER BY created_at ASC, platform ASC',
  )
    .bind(userId)
    .all();

  return c.json({ socials: results, max: MAX_LINKED_SOCIALS });
});

// POST /users/me/socials -- connect an app (LOOP-181)
//
// Body: { platform: SocialPlatformId, url: string }
//
// Error codes map 1:1 to the Figma error states:
//   ALREADY_LINKED -> "Instagram has already been linked"
//   LINK_NOT_FOUND -> "Instagram link was not found" + Try again
//   MAX_SOCIALS    -> the "+" button should already be hidden at 3
userRoutes.post('/me/socials', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, user.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  const platform = body && typeof body.platform === 'string' ? body.platform : '';
  const rawUrl = body && typeof body.url === 'string' ? body.url : '';

  if (!isSocialPlatformId(platform)) return c.json({ error: 'UNKNOWN_PLATFORM' }, 400);

  const platformLabel = getSocialPlatform(platform)?.label ?? platform;

  const validated = validateSocialUrl(platform, rawUrl);
  if (!validated.ok) {
    return c.json(
      { error: validated.error, message: socialUrlErrorMessage(validated.error, platformLabel) },
      400,
    );
  }

  // Check the cap and the duplicate together so we spend one query, and so a
  // user at 3 who re-submits an already-linked app gets ALREADY_LINKED (the
  // more specific, more useful error) rather than MAX_SOCIALS.
  const { results: existing } = await c.env.DB.prepare(
    'SELECT platform FROM user_socials WHERE user_id = ?',
  )
    .bind(userId)
    .all();

  if (existing.some((r) => r.platform === platform)) {
    return c.json(
      { error: 'ALREADY_LINKED', message: `${platformLabel} has already been linked` },
      409,
    );
  }
  if (existing.length >= MAX_LINKED_SOCIALS) {
    return c.json(
      { error: 'MAX_SOCIALS', message: `You can link ${MAX_LINKED_SOCIALS} apps.` },
      409,
    );
  }

  // Only a definitive 404/410 blocks the save -- see probeSocialUrl for why
  // timeouts and 403s are allowed through.
  const probe = await probeSocialUrl(validated.url);
  if (probe === 'not_found') {
    return c.json({ error: 'LINK_NOT_FOUND', message: `${platformLabel} link was not found` }, 422);
  }

  await c.env.DB.prepare('INSERT INTO user_socials (user_id, platform, url) VALUES (?, ?, ?)')
    .bind(userId, platform, validated.url)
    .run();

  return c.json({ social: { platform, url: validated.url } }, 201);
});

// DELETE /users/me/socials/:platform -- remove a connected app (LOOP-181)
userRoutes.delete('/me/socials/:platform', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, user.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const platform = c.req.param('platform');
  if (!isSocialPlatformId(platform)) return c.json({ error: 'UNKNOWN_PLATFORM' }, 400);

  await c.env.DB.prepare('DELETE FROM user_socials WHERE user_id = ? AND platform = ?')
    .bind(userId, platform)
    .run();

  // Idempotent: removing something already gone is a success, so repeated
  // taps on the x badge can't produce an error toast.
  return c.json({ removed: true });
});

// ---------------------------------------------------------------------------
// My Events collections — Going / Saved / Posted (Profile Main frame)
// ---------------------------------------------------------------------------

/**
 * Each tab is a different relationship to an event, not a different time range.
 *
 * Scope: these show events that HAVEN'T ended. History lives on the Past
 * Events screen (LOOP-200), which covers the same three relationships for
 * ended events — so an event moves from Going to Past when it finishes rather
 * than appearing in both.
 */
const MY_EVENT_TABS = {
  going: {
    join: 'JOIN event_rsvps r ON r.event_id = e.id AND r.user_id = ?',
    where: '1 = 1',
  },
  saved: {
    join: 'JOIN saved_events s ON s.event_id = e.id AND s.user_id = ?',
    where: '1 = 1',
  },
  posted: {
    join: '',
    where: 'e.created_by_user_id = ?',
  },
} as const;

type MyEventTab = keyof typeof MY_EVENT_TABS;

/** Not ended, and not archived by the cleanup job. */
const UPCOMING_CONDITION = `(e.is_archived = 0 AND COALESCE(e.end_datetime, e.start_datetime) >= datetime('now'))`;

// GET /users/me/events -- the My Events section of the profile.
//
// Query params:
//   tab    going | saved | posted   (default going)
//   q      free-text search over title / description / host
//   filter all | general | academic | social   (chip row)
//   sort   date | recent            (default date = soonest first)
//
// Returns { tab, events, counts } — counts covers all three tabs so the
// segmented control can render "Going (2) Saved (3) Posted (2)" without three
// extra round trips.
userRoutes.get('/me/events', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const rawTab = c.req.query('tab') ?? 'going';
  if (!isProfileEventTab(rawTab)) {
    return c.json({ error: 'INVALID_TAB', valid: PROFILE_EVENT_TABS }, 400);
  }
  const tab = rawTab as MyEventTab;

  const rawFilter = c.req.query('filter') ?? 'all';
  if (!isProfileEventFilter(rawFilter)) {
    return c.json({ error: 'INVALID_FILTER', valid: PROFILE_EVENT_FILTERS }, 400);
  }

  const sort = c.req.query('sort') === 'recent' ? 'recent' : 'date';
  const search = (c.req.query('q') ?? '').trim();

  const { join, where } = MY_EVENT_TABS[tab];

  // Binds are positional, so they must be pushed in the order the placeholders
  // appear in the SQL below: is_saved subquery (SELECT), then the tab's own
  // user_id (JOIN for going/saved, WHERE for posted), then search, then buckets.
  const binds: unknown[] = [userId, userId];

  let searchClause = '';
  if (search) {
    // Escape LIKE wildcards — someone searching for "50% off" shouldn't have
    // the % silently match everything.
    const escaped = search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    searchClause = ` AND (e.title LIKE ? ESCAPE '\\'
                          OR e.description LIKE ? ESCAPE '\\'
                          OR e.host_organization_name LIKE ? ESCAPE '\\')`;
    binds.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
  }

  const buckets = bucketsForFilter(rawFilter);
  let bucketClause = '';
  if (buckets.length > 0) {
    bucketClause = ` AND EXISTS (
                       SELECT 1 FROM event_tags t
                       WHERE t.event_id = e.id
                         AND t.bucket_id IN (${buckets.map(() => '?').join(', ')})
                     )`;
    binds.push(...buckets);
  }

  const orderBy =
    sort === 'recent' ? 'e.created_at DESC' : 'COALESCE(e.start_datetime, e.end_datetime) ASC';

  const { results } = await c.env.DB.prepare(
    `SELECT e.*,
            o.profile_picture AS org_profile_picture,
            o.verified AS org_verified,
            EXISTS (
              SELECT 1 FROM saved_events sv WHERE sv.event_id = e.id AND sv.user_id = ?
            ) AS is_saved
     FROM events e
     ${join}
     LEFT JOIN organizations o ON e.host_organization_id = o.id
     WHERE ${where}
       AND ${UPCOMING_CONDITION}
       ${searchClause}
       ${bucketClause}
     ORDER BY ${orderBy}
     LIMIT 100`,
  )
    .bind(...binds)
    .all();

  // Counts ignore search and filter: the chip row narrows what's listed, but
  // the tab labels should keep showing how many events are in each collection.
  const counts: Record<string, number> = {};
  for (const key of PROFILE_EVENT_TABS) {
    const t = MY_EVENT_TABS[key as MyEventTab];
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM events e ${t.join}
       WHERE ${t.where} AND ${UPCOMING_CONDITION}`,
    )
      .bind(userId)
      .first();
    counts[key] = (row?.c as number) ?? 0;
  }

  return c.json({
    tab,
    events: (results as Record<string, unknown>[]).map((e) => ({
      ...e,
      is_saved: Number(e.is_saved) === 1,
      org_verified: Number(e.org_verified) === 1,
    })),
    counts,
  });
});

// POST /users/:userId/follow -- follow another user.
//
// The Follow *button* belongs to LOOP-180 (public profiles), but the follower
// counts on this ticket's header are meaningless without a way to create a
// follow, and leaving the endpoint out would mean LOOP-180 reinventing it.
userRoutes.post('/:userId/follow', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const followerId = await getUserId(c.env.DB, auth.email);
  if (!followerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);
  if (targetId === followerId) return c.json({ error: 'CANNOT_FOLLOW_SELF' }, 400);

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  await c.env.DB.prepare(
    `INSERT INTO user_follows (follower_user_id, followed_user_id) VALUES (?, ?)
     ON CONFLICT DO NOTHING`,
  )
    .bind(followerId, targetId)
    .run();

  return c.json({ following: true });
});

// DELETE /users/:userId/follow -- unfollow. Idempotent.
userRoutes.delete('/:userId/follow', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const followerId = await getUserId(c.env.DB, auth.email);
  if (!followerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);

  await c.env.DB.prepare(
    'DELETE FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?',
  )
    .bind(followerId, targetId)
    .run();

  return c.json({ following: false });
});

// ---------------------------------------------------------------------------
// Past events (LOOP-200)
// ---------------------------------------------------------------------------

/**
 * An event counts as "past" once it has ended, OR once the cleanup job
 * (LOOP-150) has archived it.
 *
 * end_datetime is nullable on scraped events, so fall back to start_datetime
 * rather than treating a NULL end as "never ends" — otherwise a scraped event
 * with no end time would never appear in history.
 */
const PAST_EVENT_CONDITION = `(e.is_archived = 1 OR COALESCE(e.end_datetime, e.start_datetime) < datetime('now'))`;

/**
 * The three relationships that make an event part of a user's history. Each
 * carries the timestamp we sort by, so "newest-ended first" is expressible in
 * one shared query shape.
 *
 * Deliberately scoped to the user's OWN relationship: an event nobody touched
 * is still free for the cleanup job to purge, and must never surface here.
 */
const PAST_GROUPS = {
  created: {
    join: '',
    where: 'e.created_by_user_id = ?',
  },
  attended: {
    join: 'JOIN event_rsvps r ON r.event_id = e.id AND r.user_id = ?',
    where: '1 = 1',
  },
  saved: {
    join: 'JOIN saved_events s ON s.event_id = e.id AND s.user_id = ?',
    where: '1 = 1',
  },
} as const;

type PastGroup = keyof typeof PAST_GROUPS;

const PAST_GROUP_NAMES = Object.keys(PAST_GROUPS) as PastGroup[];

async function fetchPastEvents(db: D1Database, userId: number, group: PastGroup, limit: number) {
  const { join, where } = PAST_GROUPS[group];

  const { results } = await db
    .prepare(
      `SELECT e.*, o.profile_picture as org_profile_picture
       FROM events e
       ${join}
       LEFT JOIN organizations o ON e.host_organization_id = o.id
       WHERE ${where}
         AND ${PAST_EVENT_CONDITION}
       ORDER BY COALESCE(e.end_datetime, e.start_datetime) DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all();

  return results;
}

// GET /users/me/past-events -- the Past view on the profile (LOOP-200).
//
// Without ?group=, returns all three collections in one round trip so the
// screen can render its tab bar with counts before the user picks a tab.
// With ?group=created|attended|saved, returns just that one.
//
// Query params: group, limit (default 50, max 100).
userRoutes.get('/me/past-events', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, user.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 100);

  const requested = c.req.query('group');
  if (requested) {
    if (!PAST_GROUP_NAMES.includes(requested as PastGroup)) {
      return c.json({ error: 'INVALID_GROUP', valid: PAST_GROUP_NAMES }, 400);
    }
    const events = await fetchPastEvents(c.env.DB, userId, requested as PastGroup, limit);
    return c.json({ group: requested, events });
  }

  const [created, attended, saved] = await Promise.all(
    PAST_GROUP_NAMES.map((group) => fetchPastEvents(c.env.DB, userId, group, limit)),
  );

  return c.json({ created, attended, saved });
});
