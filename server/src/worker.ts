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
import { jobsDue } from './lib/schedule';
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
  // Service binding to this same Worker (LOOP-309), used by the scrape cron to
  // dispatch each scraper into its own invocation. Absent under
  // `wrangler dev --env local`, which falls back to WORKER_URL. See scheduled().
  SELF?: Fetcher;
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

// Cron: ONE trigger, "*/15 * * * *" in wrangler.toml [triggers] (LOOP-295).
// Which jobs run on a tick is decided from its scheduled time by jobsDue() in
// lib/schedule.ts, which documents the cadence of each:
//   reminders     every tick
//   scrape        every 6 hours on the hour, UTC (00/06/12/18)
//   orgDirectory  08:00 UTC daily (LOOP-241). The HornsLink org directory, on
//                 its own daily schedule rather than the 6-hour event sweep:
//                 org rosters change slowly, and the run includes a bounded
//                 pass of per-org HTML fetches with no reason to repeat it.
//   eventCleanup  09:00 UTC daily (LOOP-150). Hard-deletes expired events
//                 nobody engaged with and archives (soft-deletes) expired
//                 events a user created, RSVP'd to, or saved.

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

// The 6-hour scrape. Fires every scraper in the registry, each in its
// own Worker invocation (LOOP-265), so one scraper's subrequests, D1
// queries and CPU time don't count against the others'.
//
// THROUGH THE SELF SERVICE BINDING, NOT fetch(WORKER_URL) (LOOP-309).
// LOOP-265 dispatched with a plain fetch() to this Worker's own
// workers.dev URL. Cloudflare does not route a Worker's fetch() back into
// a Worker on the same account like an outside request; the documented
// way for one Worker to call another -- itself included -- is a service
// binding. After that change landed (2026-08-26) no scraped row in prod
// was updated again: the newest updated_at on every source was from late
// August, though every run rewrites every row it sees. The failure was
// only ever logged as "dispatch failed: <status>", which nobody saw.
//
// WORKER_URL stays as the fallback because `wrangler dev --env local` has
// no service bindings, and there the URL is localhost, which works.
function dispatchScrapers(env: Env, ctx: ExecutionContext): void {
  for (const scraper of SCRAPERS) {
    const path = `/events/scrape/${scraper.name}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    };
    const dispatch = env.SELF
      ? env.SELF.fetch(new Request(`https://self${path}`, init))
      : fetch(`${env.WORKER_URL}${path}`, init);

    ctx.waitUntil(
      dispatch
        .then(async (r) => {
          if (r.ok) return;
          // The body, not just the status: a Cloudflare error page or the
          // route's own { error } is what says WHY, and the status alone hid
          // this for two and a half months.
          const body = (await r.text().catch(() => '')).slice(0, 300);
          console.error(`[cron] ${scraper.name} dispatch failed: ${r.status} ${body}`);
        })
        .catch((err) => console.error(`[cron] ${scraper.name} dispatch error:`, err)),
    );
  }
}

// Export fetch + scheduled handlers together.
// Hono's default export is a fetch handler; wrapping lets us add cron support.
export default {
  fetch: app.fetch.bind(app),

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Every job due at this tick, each in its own waitUntil with its own
    // catch, so one failing job can't take the others down with it.
    for (const job of jobsDue(event.scheduledTime)) {
      switch (job) {
        case 'reminders':
          ctx.waitUntil(
            sendEventReminders(env).catch((err) => console.error('[cron] reminders failed:', err)),
          );
          break;
        case 'orgDirectory':
          ctx.waitUntil(
            ORG_DIRECTORY_SCRAPER.run(env).catch((err) =>
              console.error('[cron] org directory failed:', err),
            ),
          );
          break;
        case 'eventCleanup':
          ctx.waitUntil(
            runEventCleanup(env.DB).then(
              (counts) =>
                console.log(
                  `[cron] event cleanup: archived ${counts.archived}, purged ${counts.purged}`,
                ),
              (err) => console.error('[cron] event cleanup failed:', err),
            ),
          );
          break;
        case 'scrape':
          dispatchScrapers(env, ctx);
          break;
      }
    }
  },
};
