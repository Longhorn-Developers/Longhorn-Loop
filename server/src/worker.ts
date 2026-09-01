// Cloudflare Worker entry point -- replaces Express index.ts for production
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { SendEmailBinding } from './email/send';
import { runEventCleanup } from './lib/eventCleanup';
import { authRoutes } from './routes/auth.worker';
import { eventRoutes } from './routes/events.worker';
import { feedRoutes } from './routes/feed.worker';
import { notificationRoutes } from './routes/notifications.worker';
import { orgRoutes } from './routes/orgs.worker';
import { savedRoutes } from './routes/saved.worker';
import { settingsRoutes } from './routes/settings.worker';
import { userRoutes } from './routes/users.worker';
import { ORG_DIRECTORY_SCRAPER, SCRAPERS } from './scrapers/registry';

export type Env = {
  DB: D1Database;
  EVENT_IMAGES?: R2Bucket;
  EVENT_IMAGE_PUBLIC_BASE_URL?: string;
  // Workers AI binding used for LLM event-tag classification. Optional so
  // tests/local dev still typecheck; tagging falls back to keywords when absent.
  AI?: Ai;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  // When set to "true" in .dev.vars, the Worker logs verification codes to
  // the wrangler console instead of sending them through Resend. Never set
  // in production.
  RESEND_DEV_MODE?: string;
  // Sender for verification emails. Set in wrangler.toml [vars]; the domain
  // must be verified with whichever provider is active or every send fails.
  // Falls back to the default in auth.worker.ts when unset.
  EMAIL_FROM?: string;
  // 'cloudflare' | 'postmark' | 'resend' | 'dev'. See email/send.ts — this is
  // a variable because UT's gateway blocks our current sender and we do not
  // yet know which provider it will accept.
  EMAIL_PROVIDER?: string;
  // Cloudflare Email Service binding. Present only once wrangler.toml declares
  // [[send_email]] AND the domain is onboarded in the dashboard.
  EMAIL?: SendEmailBinding;
  POSTMARK_API_TOKEN?: string;
  CRON_SECRET: string;
  WORKER_URL: string;
  // Fixed code for the App Review reviewer bypass (LOOP-???, see APP_REVIEW_EMAIL
  // in shared/utEmail.ts and issueVerificationCode in auth.worker.ts). A Worker
  // secret, never committed, so the public bypass address alone isn't enough to
  // sign in. Unset in local dev -- the bypass address just 400s there.
  APP_REVIEW_CODE?: string;
};

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use(
  '*',
  cors({
    origin: '*',
    // PATCH must be listed or the browser's preflight blocks every partial
    // update — Edit Profile save, the avatar, the Settings toggles, org role
    // swaps and org notification settings are all PATCH, and all failed with
    // an opaque "Failed to fetch" on web until this was added.
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Routes
app.route('/auth', authRoutes);
app.route('/users', userRoutes);
app.route('/events', eventRoutes);
app.route('/feed', feedRoutes);
app.route('/notifications', notificationRoutes);
app.route('/saved', savedRoutes);
app.route('/orgs', orgRoutes);
app.route('/settings', settingsRoutes);

// Cron schedules, configured in wrangler.toml under [triggers]. The
// scheduled() handler below dispatches on event.cron since the two jobs
// run at different cadences.
const REMINDER_CRON = '*/15 * * * *';

// LOOP-241. The HornsLink org directory, on its own daily schedule rather than
// the 6-hour event sweep: org rosters change slowly, and the run includes a
// bounded pass of per-org HTML fetches that there is no reason to repeat four
// times a day.
const ORG_DIRECTORY_CRON = '0 8 * * *';

// LOOP-150. Daily sweep that hard-deletes expired events nobody ever engaged
// with and archives (soft-deletes) expired events a user created, RSVP'd to,
// or saved. A distinct hour from ORG_DIRECTORY_CRON — event.cron is matched
// exactly below, so two jobs on the same string would starve one of them.
const EVENT_CLEANUP_CRON = '0 9 * * *';

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

    if (event.cron === ORG_DIRECTORY_CRON) {
      ctx.waitUntil(ORG_DIRECTORY_SCRAPER.run(env));
      return;
    }

    if (event.cron === EVENT_CLEANUP_CRON) {
      ctx.waitUntil(
        runEventCleanup(env.DB).then(
          (counts) =>
            console.log(
              `[cron] event cleanup: archived ${counts.archived}, purged ${counts.purged}`,
            ),
          (err) => console.error('[cron] event cleanup failed:', err),
        ),
      );
      return;
    }

    // The 6-hour scrape cron. Fires every scraper in the registry.
    for (const scraper of SCRAPERS) {
      ctx.waitUntil(
        fetch(`${env.WORKER_URL}/events/scrape/${scraper.name}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        })
          .then((r) => {
            if (!r.ok) console.error(`[cron] ${scraper.name} dispatch failed: ${r.status}`);
          })
          .catch((err) => console.error(`[cron] ${scraper.name} dispatch error:`, err)),
      );
    }
  },
};
