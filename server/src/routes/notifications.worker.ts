import { Hono } from 'hono';
import { getAuthUser, getUserId } from '../lib/utils';
import type { Env } from '../worker';

export const notificationRoutes = new Hono<{ Bindings: Env }>();

// GET /notifications -- list user's notifications newest-first
notificationRoutes.get('/', async (c) => {
  const authUser = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!authUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(userId)
    .all();

  return c.json({ notifications: results });
});

// DELETE /notifications/:id -- delete one notification (must belong to user)
notificationRoutes.delete('/:id', async (c) => {
  const authUser = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!authUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'INVALID_ID' }, 400);

  await c.env.DB.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();

  return c.json({ success: true });
});

// DELETE /notifications -- clear all notifications for user
notificationRoutes.delete('/', async (c) => {
  const authUser = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!authUser) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, authUser.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 404);

  await c.env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(userId).run();

  return c.json({ success: true });
});
