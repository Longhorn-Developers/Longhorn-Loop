import { Hono } from 'hono';
import type { Env } from '../worker';

export const notificationRoutes = new Hono<{ Bindings: Env }>();

async function getAuthUser(
  authHeader: string | undefined,
  secret: string,
): Promise<{ email: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    const encoder = new TextEncoder();
    const signingInput = `${headerB64}.${payloadB64}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(signingInput));
    if (!valid) return null;
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

async function getUserId(db: D1Database, email: string): Promise<number | null> {
  const row = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  return row ? (row.id as number) : null;
}

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
