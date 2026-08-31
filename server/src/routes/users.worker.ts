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
import { redeemPendingOrgInvites } from '../lib/orgInvites';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  extensionForMimeType,
  isFileLike,
  MAX_IMAGE_BYTES,
} from '../lib/images';
import {
  DELETE_CODE_LENGTH,
  DELETE_CODE_RESEND_COOLDOWN_MS,
  DELETE_CODE_TTL_MS,
  type DeletionCodeRecord,
  ORG_SUCCESSION_QUERY,
  type OrgAdminSuccession,
  accountDeletionStatements,
  checkDeletionCode,
  deleteAccountCodeKey,
  hashCode,
} from '../lib/accountDeletion';
import { MAX_BIO, normalizeBio } from '../../../shared/bio';
import { parseStoredAvatarConfig, serializeAvatarConfig } from '../../../shared/avatar';
import { getSocialPlatform } from '../../../shared/socialPlatforms';
import {
  PROFILE_EVENT_FILTERS,
  PROFILE_EVENT_TABS,
  PUBLIC_PROFILE_TABS,
  bucketsForFilter,
  isProfileEventFilter,
  isProfileEventTab,
  isPublicProfileTab,
} from '../../../shared/profileEventFilters';
import {
  blockStatements,
  blockedAuthorFilter,
  blockedUserFilter,
  isBlockedBetween,
} from '../lib/blocks';
import type { Env } from '../worker';

export const userRoutes = new Hono<{ Bindings: Env }>();

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
 *
 * Blocked relationships are excluded (LOOP-180), keyed on `userId`'s own
 * blocks so the same numbers serve both the owner's profile and a visitor's
 * view of it. Blocking already deletes the follow rows in both directions, so
 * in a consistent database this filter subtracts nothing — it is here because
 * a counter that silently re-counts a blocked person the moment some other
 * code path re-creates a row is the kind of leak nobody would notice, and the
 * cost is one NOT EXISTS against a two-column primary key.
 */
async function getFollowCounts(
  db: D1Database,
  userId: number,
): Promise<{ follower_count: number; following_count: number }> {
  const notBlockedFollower = blockedUserFilter(userId, 'f.follower_user_id');
  const followers = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM user_follows f
        WHERE f.followed_user_id = ?${notBlockedFollower.sql}`,
    )
    .bind(userId, ...notBlockedFollower.params)
    .first();

  const notBlockedFollowed = blockedUserFilter(userId, 'f.followed_user_id');
  const following = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM user_follows f
           WHERE f.follower_user_id = ?${notBlockedFollowed.sql})
       + (SELECT COUNT(*) FROM org_followers WHERE user_id = ?) AS c`,
    )
    .bind(userId, ...notBlockedFollowed.params, userId)
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

function readFormValue(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === 'string' ? value : null;
}

function readFormArray(form: FormData, key: string): string[] | null {
  const raw = readFormValue(form, key);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Not JSON — fall through to comma-splitting below.
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

interface ProfileSubmission {
  first_name: string | null;
  last_name: string | null;
  /** JSON string or already-parsed object; serializeAvatarConfig accepts both. */
  avatar_config: unknown;
  year_classification: string | null;
  unique_classification: string[] | null;
  majors: string[] | null;
  tags: string[] | null;
  uploadedPhoto: File | null;
}

/**
 * Onboarding's profile submit now carries an optional photo, so this accepts
 * multipart/form-data (mirrors POST /events/create's readCreateEventBody) as
 * well as the original plain JSON.
 */
async function readProfileSubmission(request: Request): Promise<ProfileSubmission | null> {
  const contentType = request.headers.get('Content-Type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) return null;

    const photoValue = form.get('photo');
    const uploadedPhoto =
      photoValue && isFileLike(photoValue) && photoValue.size > 0 ? photoValue : null;

    return {
      first_name: readFormValue(form, 'first_name'),
      last_name: readFormValue(form, 'last_name'),
      avatar_config: readFormValue(form, 'avatar_config'),
      year_classification: readFormValue(form, 'year_classification'),
      unique_classification: readFormArray(form, 'unique_classification'),
      majors: readFormArray(form, 'majors'),
      tags: readFormArray(form, 'tags'),
      uploadedPhoto,
    };
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  return {
    first_name: typeof b.first_name === 'string' ? b.first_name : null,
    last_name: typeof b.last_name === 'string' ? b.last_name : null,
    avatar_config: b.avatar_config ?? null,
    year_classification: typeof b.year_classification === 'string' ? b.year_classification : null,
    unique_classification: Array.isArray(b.unique_classification)
      ? b.unique_classification.map(String)
      : null,
    majors: Array.isArray(b.majors) ? b.majors.map(String) : null,
    tags: Array.isArray(b.tags) ? b.tags.map(String) : null,
    uploadedPhoto: null,
  };
}

/** Validates and stores an uploaded avatar photo under its own R2 prefix. */
async function storeAvatarPhoto(
  env: Env,
  userId: number,
  file: File,
): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    return { error: 'Must be a JPEG, PNG, GIF, or WebP image' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: 'Must be 5 MB or smaller' };
  }
  if (!env.EVENT_IMAGES || !env.EVENT_IMAGE_PUBLIC_BASE_URL) {
    return { error: 'Image upload storage is not configured' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = extensionForMimeType(file.type, file.name);
  const key = `users/avatars/${userId}/${crypto.randomUUID()}.${extension}`;
  await env.EVENT_IMAGES.put(key, bytes, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { userId: String(userId) },
  });

  const publicBaseUrl = env.EVENT_IMAGE_PUBLIC_BASE_URL.replace(/\/+$/g, '');
  return { url: `${publicBaseUrl}/${key}` };
}

// POST /users/me/profile -- save onboarding profile data (majors, tags,
// avatar customization, etc). Accepts multipart/form-data when a photo is
// attached, or plain JSON otherwise (see readProfileSubmission).
userRoutes.post('/me/profile', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!user) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const submission = await readProfileSubmission(c.req.raw);
  if (!submission) return c.json({ error: 'INVALID_BODY' }, 400);

  const {
    first_name,
    last_name,
    avatar_config,
    year_classification,
    unique_classification,
    majors,
    tags,
    uploadedPhoto,
  } = submission;

  const uniqueClassificationJson = unique_classification
    ? JSON.stringify(unique_classification)
    : null;

  // Upsert user record. Replaces the six-preset `avatar` integer with the
  // Bevo customization recipe (migration 0018) — `avatar` itself is untouched
  // here and stays whatever Edit Profile's preset picker last set it to.
  await c.env.DB.prepare(
    `INSERT INTO users (email, first_name, last_name, year_classification, unique_classification, avatar_config)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       year_classification = excluded.year_classification,
       unique_classification = excluded.unique_classification,
       avatar_config = excluded.avatar_config`,
  )
    .bind(
      user.email,
      first_name,
      last_name,
      year_classification,
      uniqueClassificationJson,
      serializeAvatarConfig(avatar_config),
    )
    .run();

  // Get user ID
  const dbUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(user.email)
    .first();

  if (!dbUser) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const userId = dbUser.id as number;

  /**
   * Accept any org invite waiting on this address.
   *
   * HERE, and not only at sign-up. An invite is very often sent to somebody
   * who ALREADY has an account, and that person has no reason to verify their
   * email ever again -- so hooking redemption to the auth flow would leave
   * exactly the common case unhandled. /users/me is the route every signed-in
   * client hits, which makes it the one place that catches an invite whenever
   * it arrives.
   *
   * Cheap when there is nothing to do: one indexed lookup on
   * idx_org_invites_email that returns no rows, and no writes at all.
   */
  await redeemPendingOrgInvites(c.env.DB, userId, user.email);

  // A photo takes precedence over the Bevo config on display (client-side),
  // but both are stored — removing the photo later should fall back to
  // whichever Bevo the user configured rather than to nothing.
  if (uploadedPhoto) {
    const stored = await storeAvatarPhoto(c.env, userId, uploadedPhoto);
    if ('error' in stored) {
      return c.json({ error: 'INVALID_PHOTO', message: stored.error }, 400);
    }
    await c.env.DB.prepare('UPDATE users SET profile_photo_url = ? WHERE id = ?')
      .bind(stored.url, userId)
      .run();
  }

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
      avatar_config: parseStoredAvatarConfig(dbUser.avatar_config),
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
    // Checked against the raw value: normalizing only ever shortens, so a
    // client that ignores maxLength shouldn't be able to sneak past the cap by
    // padding with whitespace.
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
    binds.push(normalizeBio(bio as string | null));
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
    // Nobody needs a list of parties they already went to.
    upcomingOnly: true,
  },
  saved: {
    join: 'JOIN saved_events s ON s.event_id = e.id AND s.user_id = ?',
    where: '1 = 1',
    upcomingOnly: true,
  },
  posted: {
    join: '',
    where: 'e.created_by_user_id = ?',
    /**
     * Posted keeps your past events. It is not a to-do list, it is the record
     * of what you have hosted -- an event vanishing the hour it starts reads
     * as "the app lost my event", which is exactly how this was reported.
     *
     * It also matters for the Manage Event sheet: edit, announce and delete
     * all hang off a card in this grid, so an upcoming-only filter takes the
     * cancel button away at the precise moment a host needs it -- the event
     * has started and something has gone wrong.
     *
     * Archived events stay hidden either way; those are the deleted ones.
     */
    upcomingOnly: false,
  },
} as const;

type MyEventTab = keyof typeof MY_EVENT_TABS;

/**
 * Not ended, and not archived by the cleanup job.
 *
 * Exported for the org console's Events tab (LOOP-240), which groups its list
 * into Upcoming and Past. Nothing about "when is an event over" is specific to
 * the profile, and a second copy would be a copy that drifts — the nullable
 * end_datetime fallback below is exactly the kind of detail one side would
 * quietly get wrong. The SQL assumes the events table is aliased `e`.
 */
export const UPCOMING_CONDITION = `(e.is_archived = 0 AND COALESCE(e.end_datetime, e.start_datetime) >= datetime('now'))`;

/**
 * Posted's window: everything you have hosted that you have not deleted.
 *
 * Cancelled counts as deleted here. Delete on the Manage Event sheet sets
 * status = 'cancelled' rather than archiving (LOOP-277), so a window that only
 * checked is_archived would leave a cancelled event sitting in the host's own
 * grid with a Manage button on it.
 */
const NOT_ARCHIVED_CONDITION = `(e.is_archived = 0 AND e.status != 'cancelled')`;

/** The time window for a tab, honouring its own upcomingOnly. */
function windowFor(tab: MyEventTab): string {
  return MY_EVENT_TABS[tab].upcomingOnly ? UPCOMING_CONDITION : NOT_ARCHIVED_CONDITION;
}

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

  // Blocking (LOOP-180). Your OWN collections are filtered too, which is worth
  // spelling out because it is the least obvious of the block's read paths:
  // the Going and Saved tabs list events you already had a relationship with,
  // so without this a person you blocked keeps appearing in your own profile
  // via an event you saved before you blocked them. Mutual invisibility has to
  // mean the screens you look at most, not only the ones that name them.
  //
  // The rows are not deleted on block — a saved_events or event_rsvps row is
  // yours, and un-blocking should put the event back rather than having
  // silently discarded it.
  const blocked = blockedAuthorFilter(userId);
  binds.push(...blocked.params);

  // Date sort on a list that now spans both sides of "now" needs to say which
  // side comes first, or a host opens Posted on last semester's events. Upcoming
  // ascending (soonest first), then past descending (most recent first) --
  // the two halves each run away from today. Going and Saved are upcoming-only,
  // so the first term is constant there and this collapses to what it was.
  const dateOrder = MY_EVENT_TABS[tab].upcomingOnly
    ? 'COALESCE(e.start_datetime, e.end_datetime) ASC'
    : `CASE WHEN COALESCE(e.end_datetime, e.start_datetime) >= datetime('now') THEN 0 ELSE 1 END,
       CASE WHEN COALESCE(e.end_datetime, e.start_datetime) >= datetime('now')
            THEN COALESCE(e.start_datetime, e.end_datetime) END ASC,
       COALESCE(e.start_datetime, e.end_datetime) DESC`;

  const orderBy = sort === 'recent' ? 'e.created_at DESC' : dateOrder;

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
       AND ${windowFor(tab)}
       ${searchClause}
       ${bucketClause}
       ${blocked.sql}
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
    // Same block filter as the list. A count that includes events the list
    // below refuses to show reads as a bug — "Saved (3)" over two cards.
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS c FROM events e ${t.join}
       WHERE ${t.where} AND ${windowFor(key as MyEventTab)} ${blocked.sql}`,
    )
      .bind(userId, ...blocked.params)
      .first();
    counts[key] = (row?.c as number) ?? 0;
  }

  // Perks. This was the one event read path that never returned them: GET
  // /events, GET /events/:id and the home feed all attach benefits, so the
  // same event showed its Free Food tag in the carousels and a blank corner
  // on your own profile. ProfileEventCard had nothing to render.
  //
  // One query for the whole page rather than one per event. The list is
  // capped at 100, and the per-event loop in GET /events is already the
  // slowest thing about that route -- no reason to copy it here.
  const rows = results as Record<string, unknown>[];
  const benefitsByEvent = new Map<number, string[]>();
  const tagsByEvent = new Map<number, string[]>();
  const bucketCountsByEvent = new Map<number, Map<string, number>>();
  if (rows.length > 0) {
    const eventIds = rows.map((e) => Number(e.id));
    const benefitRows = await c.env.DB.prepare(
      `SELECT event_id, benefit_name FROM event_benefits
       WHERE event_id IN (${eventIds.map(() => '?').join(',')})`,
    )
      .bind(...eventIds)
      .all<{ event_id: number; benefit_name: string }>();
    for (const r of benefitRows.results) {
      const list = benefitsByEvent.get(r.event_id);
      if (list) list.push(r.benefit_name);
      else benefitsByEvent.set(r.event_id, [r.benefit_name]);
    }

    // The Posted tab opens the shared event editor, which needs the current
    // tag selection and its discovery bucket. Keep this batched like perks so
    // a full profile grid does not issue one query per event.
    const tagRows = await c.env.DB.prepare(
      `SELECT event_id, bucket_id, tag FROM event_tags
       WHERE event_id IN (${eventIds.map(() => '?').join(',')})
       ORDER BY tag`,
    )
      .bind(...eventIds)
      .all<{ event_id: number; bucket_id: string; tag: string }>();

    for (const row of tagRows.results) {
      const tags = tagsByEvent.get(row.event_id);
      if (tags) tags.push(row.tag);
      else tagsByEvent.set(row.event_id, [row.tag]);

      const counts = bucketCountsByEvent.get(row.event_id) ?? new Map<string, number>();
      counts.set(row.bucket_id, (counts.get(row.bucket_id) ?? 0) + 1);
      bucketCountsByEvent.set(row.event_id, counts);
    }
  }

  return c.json({
    tab,
    events: rows.map((e) => ({
      ...e,
      is_saved: Number(e.is_saved) === 1,
      org_verified: Number(e.org_verified) === 1,
      benefits: benefitsByEvent.get(Number(e.id)) ?? [],
      tags: tagsByEvent.get(Number(e.id)) ?? [],
      discovery_bucket:
        [...(bucketCountsByEvent.get(Number(e.id)) ?? new Map<string, number>()).entries()].sort(
          ([aBucket, aCount], [bBucket, bCount]) =>
            bCount - aCount || aBucket.localeCompare(bBucket),
        )[0]?.[0] ?? null,
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

  // A block prevents re-following in BOTH directions (LOOP-180). Reported as
  // 404 rather than 403 for the direction where the target blocked the caller:
  // the caller cannot see that profile at all, so acknowledging that it exists
  // and is refusing them would be the leak the block exists to prevent. The
  // caller's own block is a 409 they can act on — unblock, then follow.
  const block = await isBlockedBetween(c.env.DB, followerId, targetId);
  if (block.iBlockedThem) {
    return c.json({ error: 'BLOCKED', message: 'Unblock this person before following them.' }, 409);
  }
  if (block.theyBlockedMe) return c.json({ error: 'USER_NOT_FOUND' }, 404);

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
 *
 * Exported for the same reason as UPCOMING_CONDITION above (LOOP-240). Note
 * the two are exact complements, so a caller that has already excluded
 * archived rows — the org console does — gets "has ended" out of this and
 * loses nothing. The SQL assumes the events table is aliased `e`.
 */
export const PAST_EVENT_CONDITION = `(e.is_archived = 1 OR COALESCE(e.end_datetime, e.start_datetime) < datetime('now'))`;

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

  // Blocked authors are hidden here as well as on the live collections
  // (LOOP-180). History is exactly where a partial block shows through: the
  // Past view is the one screen that still holds events from before the block
  // was placed.
  const blocked = blockedAuthorFilter(userId);

  const { results } = await db
    .prepare(
      `SELECT e.*, o.profile_picture as org_profile_picture
       FROM events e
       ${join}
       LEFT JOIN organizations o ON e.host_organization_id = o.id
       WHERE ${where}
         AND ${PAST_EVENT_CONDITION}
         ${blocked.sql}
       ORDER BY COALESCE(e.end_datetime, e.start_datetime) DESC
       LIMIT ?`,
    )
    .bind(userId, ...blocked.params, limit)
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

// ---------------------------------------------------------------------------
// Delete Account (LOOP-131)
// ---------------------------------------------------------------------------
//
// Two steps, because the delete is irreversible and a single authenticated
// POST is one mis-tap (or one unlocked phone) away from destroying somebody's
// account: /delete/request emails a code, /delete/confirm spends it and runs
// the cascade.
//
// DEVIATION FROM THE TICKET, agreed with the product owner. The acceptance
// criteria ask for a password field. This app has no passwords — the only
// credential anyone has is an emailed verification code (see auth.worker.ts),
// so "re-enter your password" is unimplementable as written. An emailed code
// is the same control the criteria were reaching for: proof that the person
// holding the session also holds the mailbox.
//
// The cascade itself lives in lib/accountDeletion.ts so the test suite can run
// the shipped statements against a real database; see the header there.

/**
 * Deliberately its own sender rather than a call into auth.worker.ts's
 * verification email: the copy has to say what is about to happen. A message
 * that reads "your verification code" gives someone whose session was hijacked
 * no reason to react, which is the one case this email exists to catch.
 *
 * Dev mode mirrors auth.worker.ts — log instead of sending, so the flow is
 * testable before Resend has a verified sending domain.
 */
async function deliverDeletionCode(email: string, code: string, env: Env): Promise<void> {
  if (env.RESEND_DEV_MODE === 'true') {
    console.log(`[delete-account] code for ${email}: ${code}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Longhorn Loop <onboarding@resend.dev>',
      to: [email],
      subject: 'Confirm deleting your Longhorn Loop account',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #BF5700;">Longhorn Loop</h2>
          <p>Someone asked to permanently delete the account for ${email}. To confirm, enter this code in the app:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
            ${code}
          </div>
          <p style="color: #666; font-size: 14px;">This code expires in 10 minutes. <strong>If this wasn't you, do not enter it</strong> — your account is untouched until the code is used, but you should sign out on any device you don't recognize.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    console.error('Resend error (delete-account):', await res.text());
    throw new Error('Failed to send deletion code');
  }
}

// POST /users/me/delete/request -- email a confirmation code.
//
// Returns { sent: true, email }. 429 RESEND_TOO_SOON if one was sent within
// the last minute, matching the cooldown on /auth/send-code.
userRoutes.post('/me/delete/request', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const email = auth.email.trim().toLowerCase();
  const key = deleteAccountCodeKey(email);

  const existing = await c.env.DB.prepare(
    'SELECT last_sent_at FROM verification_codes WHERE email = ?',
  )
    .bind(key)
    .first();

  if (existing && Date.now() - Number(existing.last_sent_at) < DELETE_CODE_RESEND_COOLDOWN_MS) {
    return c.json(
      {
        error: 'RESEND_TOO_SOON',
        message: 'We just sent a code. Check your email, then try again.',
      },
      429,
    );
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));

  await c.env.DB.prepare(
    `INSERT INTO verification_codes (email, code_hash, expires_at, verified, used_at, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, NULL, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash    = excluded.code_hash,
       expires_at   = excluded.expires_at,
       verified     = 0,
       used_at      = NULL,
       attempts     = 0,
       last_sent_at = excluded.last_sent_at`,
  )
    .bind(key, await hashCode(code), Date.now() + DELETE_CODE_TTL_MS, Date.now())
    .run();

  try {
    await deliverDeletionCode(email, code, c.env);
  } catch {
    // Roll the row back. The cooldown is keyed on last_sent_at, so leaving a
    // row behind after a send that failed would lock the user out of retrying
    // for a minute over an email they never received.
    await c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(key).run();
    return c.json(
      { error: 'SEND_FAILED', message: 'We could not send that email. Try again.' },
      502,
    );
  }

  return c.json({ sent: true, email });
});

// POST /users/me/delete/confirm -- verify the code, then hard-delete.
//
// Body: { code }. Returns { deleted: true }. A wrong code deletes NOTHING and
// burns an attempt; five wrong codes void the request entirely and the user
// has to start over, which is what stops a stolen session from brute-forcing
// six digits.
userRoutes.post('/me/delete/confirm', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  const code = body && typeof body.code === 'string' ? body.code.trim() : '';

  const email = auth.email.trim().toLowerCase();
  const key = deleteAccountCodeKey(email);

  if (!new RegExp(`^\\d{${DELETE_CODE_LENGTH}}$`).test(code)) {
    return c.json(
      { error: 'INVALID_CODE', message: 'That code isn’t right. Check it and try again.' },
      400,
    );
  }

  const record: DeletionCodeRecord | null = await c.env.DB.prepare(
    'SELECT code_hash, expires_at, attempts FROM verification_codes WHERE email = ?',
  )
    .bind(key)
    .first();

  const check = checkDeletionCode(record, await hashCode(code), Date.now());

  if (!check.ok) {
    if (check.voids) {
      await c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(key).run();
    }
    if (check.countsAsAttempt) {
      await c.env.DB.prepare(
        'UPDATE verification_codes SET attempts = attempts + 1 WHERE email = ?',
      )
        .bind(key)
        .run();
    }
    return c.json({ error: check.error, message: check.message }, check.status);
  }

  // Read membership BEFORE the cascade: once org_members is emptied there is
  // no way to tell which orgs this user was the last admin of.
  const { results } = await c.env.DB.prepare(ORG_SUCCESSION_QUERY)
    .bind(userId, userId, userId)
    .all();

  const succession: OrgAdminSuccession[] = (results as Record<string, unknown>[]).map((row) => ({
    orgId: Number(row.org_id),
    otherAdmins: Number(row.other_admins),
    successorUserId: row.successor_user_id === null ? null : Number(row.successor_user_id),
  }));

  const statements = accountDeletionStatements(userId, email, succession);

  // batch() runs the whole cascade in one implicit transaction. A partial
  // cascade is the failure that matters here: an orphaned user_settings row is
  // harmless, but a deleted users row with live event_rsvps rows shows phantom
  // attendees on somebody else's event forever.
  await c.env.DB.batch(statements.map((s) => c.env.DB.prepare(s.sql).bind(...s.binds)));

  // The JWT is stateless and stays valid until it expires, but every route
  // resolves the caller through getUserId(), which now returns null — so the
  // token can no longer reach anything. The client drops it on success.
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Public profiles — somebody else's profile (LOOP-180)
// ---------------------------------------------------------------------------
//
// Figma: "Profile Main" frame, public user profile ("Not Todd Jenkins"),
// reviewed 2026-06-08. The read-only counterpart to app/(tabs)/profile.tsx:
// same header and card components, Follow + Block where Edit Profile was, and
// an Upcoming / Past toggle where Going / Saved / Posted was.
//
// Registered at the bottom of the file so every literal /me/... route is
// declared first. Hono matches in definition order (the same reason
// orgs.worker.ts pins /mine and /search above /:orgId), and while none of the
// paths below actually collide with a /me route today, "/:userId/..." declared
// above them is one new /me/<something> away from swallowing it. As a
// consequence GET /users/me/profile — which does not exist; the self profile
// is GET /users/me — falls through to /:userId/profile and answers
// INVALID_USER_ID rather than 404ing on an unrouted path.
//
// AUTH IS REQUIRED on all four. A profile names a person, carries their bio
// and links out to their socials, and the same reasoning that auth-gates
// GET /events/:id/attendees applies with more force here. It is also what
// makes blocking enforceable: with no caller there is no pair to test.

/** The subset of a user row a stranger may see. Notably not `email`. */
const PUBLIC_USER_COLUMNS =
  'id, first_name, last_name, avatar, avatar_config, profile_photo_url, bio, year_classification, unique_classification';

// GET /users/:userId/profile
//
// Returns { user, is_following, is_self, blocked }. A block in EITHER
// direction answers 404 USER_NOT_FOUND: mutual invisibility means the blocked
// party must not be able to tell a block from a deleted account, and the
// blocker should not have to look at a profile they blocked either.
userRoutes.get('/:userId/profile', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const viewerId = await getUserId(c.env.DB, auth.email);
  if (!viewerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);

  const dbUser = await c.env.DB.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(targetId)
    .first();
  if (!dbUser) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const block = await isBlockedBetween(c.env.DB, viewerId, targetId);
  if (block.blocked) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const [majors, tags, socials] = await Promise.all([
    c.env.DB.prepare('SELECT major FROM user_majors WHERE user_id = ?').bind(targetId).all(),
    c.env.DB.prepare('SELECT tag FROM user_tags WHERE user_id = ?').bind(targetId).all(),
    c.env.DB.prepare(
      'SELECT platform, url FROM user_socials WHERE user_id = ? ORDER BY created_at ASC, platform ASC',
    )
      .bind(targetId)
      .all(),
  ]);

  const counts = await getFollowCounts(c.env.DB, targetId);

  const following = await c.env.DB.prepare(
    'SELECT 1 FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?',
  )
    .bind(viewerId, targetId)
    .first();

  return c.json({
    user: {
      ...dbUser,
      unique_classification: parseUniqueClassification(dbUser.unique_classification),
      majors: majors.results.map((r) => r.major),
      tags: tags.results.map((r) => r.tag),
      socials: socials.results,
      ...counts,
    },
    is_following: !!following,
    // The client redirects to the owner's own profile on this rather than
    // rendering a Follow button pointed at yourself.
    is_self: targetId === viewerId,
    // Always false on a 200 — a real block 404s above. Present so the client
    // has one field to read after an unblock refetch.
    blocked: false,
  });
});

// GET /users/:userId/profile/events?tab=upcoming|past
//
// The "Not Todd Events" grid. Returns { tab, events, counts }, counts covering
// both tabs so the segmented toggle can label itself in one round trip.
//
// SCOPE: events this person POSTED. Not what they RSVP'd to or saved — those
// are the Going and Saved collections on the owner's own profile, and a
// visitor seeing them would turn a private bookmark into a public statement
// about where somebody is going to be. See PublicProfileTab in
// shared/profileEventFilters.ts.
userRoutes.get('/:userId/profile/events', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const viewerId = await getUserId(c.env.DB, auth.email);
  if (!viewerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);

  const rawTab = c.req.query('tab') ?? 'upcoming';
  if (!isPublicProfileTab(rawTab)) {
    return c.json({ error: 'INVALID_TAB', valid: PUBLIC_PROFILE_TABS }, 400);
  }

  const target = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  // Checked here as well as on the profile fetch. The two endpoints are
  // independently reachable, and an events list that answers while the profile
  // 404s is a complete bypass of the block.
  const block = await isBlockedBetween(c.env.DB, viewerId, targetId);
  if (block.blocked) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const condition = rawTab === 'past' ? PAST_EVENT_CONDITION : UPCOMING_CONDITION;
  // Soonest-first for Upcoming, most-recent-first for Past: in both cases the
  // event nearest to now is the one worth showing at the top.
  const order = rawTab === 'past' ? 'DESC' : 'ASC';

  const { results } = await c.env.DB.prepare(
    `SELECT e.*,
            o.profile_picture AS org_profile_picture,
            o.verified        AS org_verified
       FROM events e
       LEFT JOIN organizations o ON e.host_organization_id = o.id
      WHERE e.created_by_user_id = ?
        AND ${condition}
      ORDER BY COALESCE(e.start_datetime, e.end_datetime) ${order}
      LIMIT 100`,
  )
    .bind(targetId)
    .all();

  const countRow = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN ${UPCOMING_CONDITION} THEN 1 ELSE 0 END) AS upcoming,
       SUM(CASE WHEN ${PAST_EVENT_CONDITION} THEN 1 ELSE 0 END) AS past
     FROM events e
     WHERE e.created_by_user_id = ?`,
  )
    .bind(targetId)
    .first();

  return c.json({
    tab: rawTab,
    events: (results as Record<string, unknown>[]).map((e) => ({
      ...e,
      org_verified: Number(e.org_verified) === 1,
    })),
    counts: {
      upcoming: Number(countRow?.upcoming ?? 0),
      past: Number(countRow?.past ?? 0),
    },
  });
});

// POST /users/:userId/block -- the Block action on the Follow control.
//
// Idempotent, and destructive on purpose: it drops the follow relationship in
// BOTH directions. See lib/blocks.ts for why the statements live there and why
// they go through batch().
userRoutes.post('/:userId/block', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const blockerId = await getUserId(c.env.DB, auth.email);
  if (!blockerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);
  if (targetId === blockerId) return c.json({ error: 'CANNOT_BLOCK_SELF' }, 400);

  const target = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const statements = blockStatements(blockerId, targetId);
  await c.env.DB.batch(statements.map((s) => c.env.DB.prepare(s.sql).bind(...s.binds)));

  // following is reported as false because the block just made it so — the
  // client's Follow button has to fall back to its unfollowed state even
  // though nobody pressed it.
  return c.json({ blocked: true, following: false });
});

// DELETE /users/:userId/block -- unblock. Idempotent.
//
// Does NOT restore the follows the block dropped. They were deleted, not
// suspended, and silently re-following someone you blocked would be a
// surprising thing for an unblock to do.
userRoutes.delete('/:userId/block', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const blockerId = await getUserId(c.env.DB, auth.email);
  if (!blockerId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const targetId = parseInt(c.req.param('userId'), 10);
  if (Number.isNaN(targetId)) return c.json({ error: 'INVALID_USER_ID' }, 400);

  // Scoped to the caller's OWN block row. A DELETE that matched either column
  // order would let the blocked party lift the block placed on them, which is
  // the single worst bug this feature could have.
  await c.env.DB.prepare(
    'DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?',
  )
    .bind(blockerId, targetId)
    .run();

  return c.json({ blocked: false });
});
