// Saved-events (bookmark) routes for Cloudflare Worker
import { Hono } from 'hono';
import { getAuthUser, getUserId } from '../lib/utils';
import type { Env } from '../worker';

export const savedRoutes = new Hono<{ Bindings: Env }>();

// GET /saved -- list the current user's saved/bookmarked events
savedRoutes.get('/', async (c) => {
  const authUser = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!authUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT e.*, o.profile_picture as org_profile_picture
     FROM saved_events s
     JOIN events e ON e.id = s.event_id
     LEFT JOIN organizations o ON e.host_organization_id = o.id
     WHERE s.user_id = ?
     ORDER BY e.start_datetime ASC`,
  )
    .bind(userId)
    .all();

  return c.json({ events: results });
});

// POST /saved/:eventId -- bookmark an event
savedRoutes.post('/:eventId', async (c) => {
  const authUser = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!authUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const eventId = parseInt(c.req.param('eventId'), 10);
  if (isNaN(eventId)) return c.json({ error: 'INVALID_EVENT_ID' }, 400);

  const event = await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first();
  if (!event) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  const inserted = await c.env.DB.prepare(
    `INSERT INTO saved_events (user_id, event_id)
     VALUES (?, ?)
     ON CONFLICT(user_id, event_id) DO NOTHING`,
  )
    .bind(userId, eventId)
    .run();

  // Keep the denormalized counter in sync, but only for a genuinely new
  // bookmark so re-saving doesn't inflate save_count.
  if (inserted.meta.changes > 0) {
    await c.env.DB.prepare('UPDATE events SET save_count = save_count + 1 WHERE id = ?')
      .bind(eventId)
      .run();
  }

  return c.json({ saved: true });
});

// DELETE /saved/:eventId -- remove a bookmark
savedRoutes.delete('/:eventId', async (c) => {
  const authUser = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!authUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const eventId = parseInt(c.req.param('eventId'), 10);
  if (isNaN(eventId)) return c.json({ error: 'INVALID_EVENT_ID' }, 400);

  const deleted = await c.env.DB.prepare(
    'DELETE FROM saved_events WHERE user_id = ? AND event_id = ?',
  )
    .bind(userId, eventId)
    .run();

  // Only decrement when a bookmark was actually removed, so a repeat DELETE
  // can't drive save_count negative.
  if (deleted.meta.changes > 0) {
    await c.env.DB.prepare('UPDATE events SET save_count = save_count - 1 WHERE id = ?')
      .bind(eventId)
      .run();
  }

  return c.json({ saved: false });
});
