// Events routes for Cloudflare Worker
import { Hono } from 'hono';
import type { Env } from '../worker';
import { scrapeHornsLink } from '../scrapers/hornslink';

export const eventRoutes = new Hono<{ Bindings: Env }>();

// Once an event has this many reports it's filtered from feeds globally.
const REPORT_HIDE_THRESHOLD = 5;

const REPORT_REASONS = new Set(['violent_harmful', 'misinformation', 'troll_spam', 'other']);

// JWT verification (mirrors the pattern used in saved.worker.ts).
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

// Returns a SQL fragment + params that hide events the caller already
// reported and any event over the global threshold.
function buildVisibilityFilter(userId: number | null): {
  sql: string;
  params: any[];
} {
  const params: any[] = [REPORT_HIDE_THRESHOLD];
  let sql = `
    AND (
      SELECT COUNT(*) FROM event_reports er WHERE er.event_id = e.id
    ) < ?
  `;
  if (userId !== null) {
    sql += `
      AND NOT EXISTS (
        SELECT 1 FROM event_reports er2
        WHERE er2.event_id = e.id AND er2.user_id = ?
      )
    `;
    params.push(userId);
  }
  return { sql, params };
}

// GET /events -- list upcoming events with optional filters
eventRoutes.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');
  const category = c.req.query('category');
  const benefit = c.req.query('benefit');
  const theme = c.req.query('theme');
  const orgId = c.req.query('orgId');

  // If the caller is signed in, also hide events they've already reported.
  // Anonymous callers only get the global threshold filter.
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  const userId = auth ? await getUserId(c.env.DB, auth.email) : null;
  const visibility = buildVisibilityFilter(userId);

  let query = `
    SELECT e.*, o.profile_picture as org_profile_picture
    FROM events e
    LEFT JOIN organizations o ON e.host_organization_id = o.id
    WHERE e.status = 'active'
      AND e.is_archived = 0
      AND e.end_datetime > datetime('now')
      ${visibility.sql}
  `;
  const params: any[] = [...visibility.params];

  if (theme) {
    query += ` AND e.theme = ?`;
    params.push(theme);
  }

  if (orgId) {
    query += ` AND e.host_organization_id = ?`;
    params.push(parseInt(orgId));
  }

  if (category) {
    query += ` AND e.id IN (SELECT event_id FROM event_categories WHERE category_name = ?)`;
    params.push(category);
  }

  if (benefit) {
    query += ` AND e.id IN (SELECT event_id FROM event_benefits WHERE benefit_name = ?)`;
    params.push(benefit);
  }

  query += ` ORDER BY e.start_datetime ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const events = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  // Attach categories and benefits to each event
  const enrichedEvents = [];
  for (const event of events.results) {
    const categories = await c.env.DB.prepare(
      'SELECT category_id, category_name FROM event_categories WHERE event_id = ?',
    )
      .bind(event.id)
      .all();

    const benefits = await c.env.DB.prepare(
      'SELECT benefit_name FROM event_benefits WHERE event_id = ?',
    )
      .bind(event.id)
      .all();

    enrichedEvents.push({
      ...event,
      categories: categories.results.map((c: any) => ({
        id: c.category_id,
        name: c.category_name,
      })),
      benefits: benefits.results.map((b: any) => b.benefit_name),
    });
  }

  return c.json({
    events: enrichedEvents,
    total: events.results.length,
    limit,
    offset,
  });
});

// GET /events/:id -- single event detail
eventRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  const userId = auth ? await getUserId(c.env.DB, auth.email) : null;

  const event = await c.env.DB.prepare(
    `SELECT e.*, o.profile_picture as org_profile_picture
     FROM events e
     LEFT JOIN organizations o ON e.host_organization_id = o.id
     WHERE e.id = ?`,
  )
    .bind(id)
    .first();

  if (!event) {
    return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
  }

  // Hide events the caller already reported, or that crossed the global
  // report threshold. Treat as not-found so the UI handles it cleanly.
  const reportCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as c FROM event_reports WHERE event_id = ?',
  )
    .bind(id)
    .first();
  if (reportCount && (reportCount.c as number) >= REPORT_HIDE_THRESHOLD) {
    return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
  }
  if (userId !== null) {
    const reportedByMe = await c.env.DB.prepare(
      'SELECT 1 FROM event_reports WHERE event_id = ? AND user_id = ?',
    )
      .bind(id, userId)
      .first();
    if (reportedByMe) {
      return c.json({ error: 'EVENT_NOT_FOUND' }, 404);
    }
  }

  const categories = await c.env.DB.prepare(
    'SELECT category_id, category_name FROM event_categories WHERE event_id = ?',
  )
    .bind(id)
    .all();

  const benefits = await c.env.DB.prepare(
    'SELECT benefit_name FROM event_benefits WHERE event_id = ?',
  )
    .bind(id)
    .all();

  return c.json({
    ...event,
    categories: categories.results.map((c: any) => ({
      id: c.category_id,
      name: c.category_name,
    })),
    benefits: benefits.results.map((b: any) => b.benefit_name),
  });
});

// POST /events/:id/report -- user reports an event for moderation.
// Body: { reasons: string[], description: string }
// At REPORT_HIDE_THRESHOLD reports, the event is hidden from every feed.
eventRoutes.post('/:id/report', async (c) => {
  const auth = await getAuthUser(c.req.header('Authorization'), c.env.JWT_SECRET);
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const userId = await getUserId(c.env.DB, auth.email);
  if (!userId) return c.json({ error: 'USER_NOT_FOUND' }, 401);

  const eventId = parseInt(c.req.param('id'));
  if (!Number.isFinite(eventId)) {
    return c.json({ error: 'INVALID_EVENT_ID' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const reasons: unknown = (body as any).reasons;
  const description: unknown = (body as any).description;

  if (!Array.isArray(reasons) || reasons.length === 0) {
    return c.json({ error: 'MISSING_REASONS' }, 400);
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    return c.json({ error: 'MISSING_DESCRIPTION' }, 400);
  }
  const cleanReasons = reasons.filter(
    (r): r is string => typeof r === 'string' && REPORT_REASONS.has(r),
  );
  if (cleanReasons.length === 0) {
    return c.json({ error: 'INVALID_REASONS' }, 400);
  }

  // Confirm the event exists before recording the report.
  const eventExists = await c.env.DB.prepare('SELECT 1 FROM events WHERE id = ?')
    .bind(eventId)
    .first();
  if (!eventExists) return c.json({ error: 'EVENT_NOT_FOUND' }, 404);

  try {
    await c.env.DB.prepare(
      `INSERT INTO event_reports (user_id, event_id, reasons, description)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(userId, eventId, JSON.stringify(cleanReasons), description.trim())
      .run();
  } catch (err) {
    // unique(user_id, event_id) -- ignore duplicate reports
    if (String(err).includes('UNIQUE')) {
      return c.json({ ok: true, alreadyReported: true });
    }
    throw err;
  }

  return c.json({ ok: true });
});

// POST /events/scrape -- manually trigger a scrape (for testing)
eventRoutes.post('/scrape', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const maxPages = (body as any).maxPages ?? 3;
  const dryRun = (body as any).dryRun ?? false;

  const result = await scrapeHornsLink(c.env.DB, { maxPages, dryRun });

  return c.json(result);
});
