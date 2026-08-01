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
import type { Env } from '../worker';

export const userRoutes = new Hono<{ Bindings: Env }>();

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

  // Replace tags
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

  return c.json({
    user: {
      ...dbUser,
      majors: majors.results.map((r) => r.major),
      tags: tags.results.map((r) => r.tag),
      socials: socials.results,
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

  const { first_name, last_name, avatar, year_classification, bio, tags } = body as Record<
    string,
    unknown
  >;

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
    if (bio.length > 300) return c.json({ error: 'BIO_TOO_LONG' }, 400);
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

  if (sets.length > 0) {
    binds.push(userId);
    await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  }

  // Interests are replace-all, matching the onboarding endpoint.
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
