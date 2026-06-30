// Cloudflare Worker entry point -- replaces Express index.ts for production
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth.worker';
import { userRoutes } from './routes/users.worker';
import { eventRoutes } from './routes/events.worker';
import { notificationRoutes } from './routes/notifications.worker';
import { savedRoutes } from './routes/saved.worker';
// import { run as runTexasToday } from "./scrapers/texasToday"; // TODO: add texasToday scraper
import { run as runHornsLink } from './scrapers/hornslink';

export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  // When set to "true" in .dev.vars, the Worker logs verification codes to
  // the wrangler console instead of sending them through Resend. Never set
  // in production.
  RESEND_DEV_MODE?: string;
};

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Routes
app.route('/auth', authRoutes);
app.route('/users', userRoutes);
app.route('/events', eventRoutes);
app.route('/notifications', notificationRoutes);
app.route('/saved', savedRoutes);

// Cron schedules, configured in wrangler.toml under [triggers]. The
// scheduled() handler below dispatches on event.cron since the two jobs
// run at different cadences.
const REMINDER_CRON = '*/15 * * * *';

// Lead time before an event starts at which we send a reminder notification.
const REMINDER_LEAD_TIME_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Scans saved (bookmarked) events that are starting soon and haven't been
 * reminded about yet, and inserts a notification row for each one.
 */
async function sendEventReminders(env: Env): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_LEAD_TIME_MS);

  // Find saved events starting within the reminder window that haven't
  // had a reminder sent yet.
  const { results } = await env.DB.prepare(
    `SELECT
       s.id as saved_id,
       s.user_id,
       e.id as event_id,
       e.title,
       e.start_datetime,
       e.image_url,
       o.profile_picture as org_profile_picture
     FROM saved_events s
     JOIN events e ON e.id = s.event_id
     LEFT JOIN organizations o ON e.host_organization_id = o.id
     WHERE s.reminder_sent_at IS NULL
       AND e.start_datetime > ?
       AND e.start_datetime <= ?
       AND e.status = 'active'`,
  )
    .bind(now.toISOString(), windowEnd.toISOString())
    .all();

  for (const row of results as any[]) {
    const hoursUntil = Math.max(
      1,
      Math.round((new Date(row.start_datetime).getTime() - now.getTime()) / (60 * 60 * 1000)),
    );
    const hourWord = hoursUntil === 1 ? 'hour' : 'hours';

    await env.DB.prepare(
      `INSERT INTO notifications
         (user_id, type, title, subtitle, avatar_url, thumbnail_url, event_id)
       VALUES (?, 'event_reminder', ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.user_id,
        row.title,
        `is happening in ${hoursUntil} ${hourWord}!`,
        row.org_profile_picture ?? null,
        row.image_url ?? null,
        row.event_id,
      )
      .run();

    await env.DB.prepare('UPDATE saved_events SET reminder_sent_at = ? WHERE id = ?')
      .bind(now.toISOString(), row.saved_id)
      .run();
  }
}

// Export fetch + scheduled handlers together.
// Hono's default export is a fetch handler; wrapping lets us add cron support.
export default {
  fetch: app.fetch.bind(app),

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === REMINDER_CRON) {
      ctx.waitUntil(sendEventReminders(env));
      return;
    }

    // The 6-hour scrape cron.
    // ctx.waitUntil(runTexasToday(env)); // TODO: add texasToday scraper
    ctx.waitUntil(runHornsLink(env));
  },
};
