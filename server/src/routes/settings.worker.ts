// User settings + feedback routes (LOOP-184).
//
// Settings storage is deliberately a single row per user with typed columns
// rather than a key/value bag: the reminder cron needs to read
// reminder_lead_minutes with arithmetic, and a JSON blob would push that
// parsing into every consumer.
//
// The notification columns are shared ground with LOOP-125 — that ticket owns
// when each notification fires, this owns the storage and the Settings UI.

import { Hono } from 'hono';
import { getAuthUser, getUserId } from '../lib/utils';
import type { Env } from '../worker';

export const settingsRoutes = new Hono<{ Bindings: Env }>();

/**
 * Every settings column, with the default applied when a user has no row yet.
 *
 * Keeping this as one list means GET, PATCH and the defaults can't drift: add
 * a column here and all three pick it up.
 */
const BOOLEAN_SETTINGS = [
  ['dark_mode', false],
  ['event_reminders', true],
  ['new_events', true],
  ['weekly_digest', false],
  ['rsvp_confirmations', true],
  ['channel_push', true],
  ['channel_email', false],
  ['channel_in_app', true],
] as const;

type BooleanSettingKey = (typeof BOOLEAN_SETTINGS)[number][0];

/** Options offered by the "Reminder timing" dropdown, in minutes. */
const REMINDER_LEAD_OPTIONS = [15, 30, 60, 120, 360, 720, 1440, 2880];
const DEFAULT_REMINDER_LEAD = 1440; // "1 day before"

function shapeSettings(row: Record<string, unknown> | null) {
  const out: Record<string, boolean | number> = {};
  for (const [key, fallback] of BOOLEAN_SETTINGS) {
    out[key] = row ? Number(row[key]) === 1 : fallback;
  }
  out.reminder_lead_minutes = row ? Number(row.reminder_lead_minutes) : DEFAULT_REMINDER_LEAD;
  return out;
}

// GET /settings -- current user's settings, or the defaults if none saved.
settingsRoutes.get('/', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const row = await c.env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .bind(userId)
    .first();

  return c.json({
    settings: shapeSettings(row as Record<string, unknown> | null),
    reminder_options: REMINDER_LEAD_OPTIONS,
  });
});

// PATCH /settings -- partial update; unspecified keys keep their value.
settingsRoutes.patch('/', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'INVALID_BODY' }, 400);

  const patch = body as Record<string, unknown>;

  if (patch.reminder_lead_minutes !== undefined) {
    const value = Number(patch.reminder_lead_minutes);
    // Reject anything off the dropdown: an arbitrary lead time would make the
    // reminder cron's 15-minute scan window miss it entirely.
    if (!REMINDER_LEAD_OPTIONS.includes(value)) {
      return c.json({ error: 'INVALID_REMINDER_LEAD', valid: REMINDER_LEAD_OPTIONS }, 400);
    }
  }

  const existing = await c.env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .bind(userId)
    .first();
  const current = shapeSettings(existing as Record<string, unknown> | null);

  // Merge over the current values (or the defaults) so a PATCH of one toggle
  // can't silently reset the rest to their defaults.
  const merged: Record<string, number> = {};
  for (const [key] of BOOLEAN_SETTINGS) {
    const supplied = patch[key];
    merged[key] =
      typeof supplied === 'boolean'
        ? supplied
          ? 1
          : 0
        : current[key as BooleanSettingKey]
          ? 1
          : 0;
  }
  merged.reminder_lead_minutes =
    patch.reminder_lead_minutes !== undefined
      ? Number(patch.reminder_lead_minutes)
      : (current.reminder_lead_minutes as number);

  const columns = [...BOOLEAN_SETTINGS.map(([k]) => k), 'reminder_lead_minutes'];
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns.map((col) => `${col} = excluded.${col}`).join(', ');

  await c.env.DB.prepare(
    `INSERT INTO user_settings (user_id, ${columns.join(', ')}, updated_at)
     VALUES (?, ${placeholders}, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET ${updates}, updated_at = datetime('now')`,
  )
    .bind(userId, ...columns.map((col) => merged[col]))
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM user_settings WHERE user_id = ?')
    .bind(userId)
    .first();

  return c.json({ settings: shapeSettings(row as Record<string, unknown> | null) });
});

// POST /settings/feedback -- the Settings feedback form and Report a Bug.
//
// Body: { message, kind?, context? }
settingsRoutes.post('/feedback', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const body = await c.req.json().catch(() => null);
  const message = body && typeof body.message === 'string' ? body.message.trim() : '';
  const kind = body && typeof body.kind === 'string' ? body.kind : 'feedback';
  const context = body && typeof body.context === 'string' ? body.context.slice(0, 500) : null;

  if (!message) return c.json({ error: 'EMPTY_MESSAGE' }, 400);
  if (message.length > 2000) return c.json({ error: 'MESSAGE_TOO_LONG' }, 400);
  if (!['feedback', 'bug', 'support'].includes(kind)) {
    return c.json({ error: 'INVALID_KIND' }, 400);
  }

  await c.env.DB.prepare(
    'INSERT INTO feedback (user_id, kind, message, context) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, kind, message, context)
    .run();

  return c.json({ submitted: true }, 201);
});
