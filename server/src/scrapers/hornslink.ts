/**
 * HornsLink Event Scraper
 *
 * Fetches events from UT Austin's HornsLink (Campus Labs Engage) platform
 * via their public discovery API. No authentication required.
 *
 * API base: https://utexas.campuslabs.com/engage/api/discovery/event/search
 * Image base: https://se-images.campuslabs.com/clink/images/
 */

import type { Env } from "../worker";

// ---------- Types ----------

interface HornsLinkEvent {
  id: string;
  institutionId: number;
  organizationId: number;
  organizationName: string;
  organizationProfilePicture: string | null;
  organizationNames: string[];
  name: string;
  description: string;
  location: string | null;
  startsOn: string;
  endsOn: string | null;
  imagePath: string | null;
  theme: string | null;
  categoryIds: string[];
  categoryNames: string[];
  benefitNames: string[];
  visibility: string;
  status: string;
  latitude: string | null;
  longitude: string | null;
  rsvpTotal: number;
  "@search.score": number;
}

interface HornsLinkSearchResponse {
  "@odata.count": number;
  "@search.facets": {
    CategoryIds: Array<{ value: string; count: number }>;
    BenefitNames: Array<{ value: string; count: number }>;
    Theme: Array<{ value: string; count: number }>;
  };
  value: HornsLinkEvent[];
}

interface ScraperResult {
  eventsProcessed: number;
  eventsInserted: number;
  eventsUpdated: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// ---------- Constants ----------

const HORNSLINK_API_BASE =
  "https://utexas.campuslabs.com/engage/api/discovery/event/search";
const HORNSLINK_EVENT_URL_BASE =
  "https://utexas.campuslabs.com/engage/event/";
const IMAGE_BASE_URL =
  "https://se-images.campuslabs.com/clink/images/";
const ORG_PROFILE_IMAGE_BASE =
  "https://se-images.campuslabs.com/clink/images/";

// Polite scraping settings
const PAGE_SIZE = 20;
const MAX_PAGES = 5; // Start small: 100 events max
const REQUEST_DELAY_MS = 500; // 500ms between requests
const MAX_RETRIES = 3;
const DAYS_AHEAD = 30;

// Cron settings: 25 pages * 20/page = up to 500 events, matching the
// 200-500 events/run target for the scheduled scrape.
const CRON_MAX_PAGES = 25;
// Stay well under the Workers CPU/wall-clock limit for scheduled handlers —
// if we run long, stop early and pick up the remaining pages next run
// (safe because results are ordered by endsOn ascending, so we always make
// progress on the soonest-ending events first).
const TIME_BUDGET_MS = 25_000;

// ---------- Helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate location to 40 chars for card display
 */
function truncateLocation(location: string | null): string | null {
  if (!location) return null;
  return location.length > 40 ? location.substring(0, 37) + "..." : location;
}

/**
 * Classify image aspect ratio based on dimensions.
 * If we don't have dimensions, return 'none' for null images or 'square' as default.
 */
function classifyAspectRatio(
  width: number | null,
  height: number | null,
  hasImage: boolean,
): string {
  if (!hasImage) return "none";
  if (!width || !height) return "square"; // default when dimensions unknown
  const ratio = width / height;
  if (ratio < 0.8) return "vertical";
  if (ratio > 1.2) return "horizontal";
  return "square";
}

/**
 * Build the full image URL from HornsLink image path
 */
function buildImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return `${IMAGE_BASE_URL}${imagePath}`;
}

/**
 * Strip HTML tags from description for clean text
 */
function stripHtml(html: string | null): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&oacute;/g, "ó")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the search URL for a given page
 */
function buildSearchUrl(page: number): string {
  const now = new Date();
  const startsAfter = now.toISOString();
  // Look DAYS_AHEAD days ahead. The API doesn't reliably honor an upper
  // bound param, so this is a best-effort hint — the real enforcement
  // happens client-side in scrapeHornsLink via the endsOn cutoff check.
  const endDate = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const endsBefore = endDate.toISOString();

  const params = new URLSearchParams({
    endsAfter: startsAfter,
    endsBefore,
    orderByField: "endsOn",
    orderByDirection: "ascending",
    status: "Approved",
    take: PAGE_SIZE.toString(),
    skip: (page * PAGE_SIZE).toString(),
  });

  return `${HORNSLINK_API_BASE}?${params.toString()}`;
}

// ---------- Fetch with retry ----------

async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "LonghornLoop/1.0 (student-project)",
        },
      });

      if (res.status === 429) {
        // Rate limited — back off exponentially
        const backoff = Math.pow(2, attempt) * 2000;
        console.log(`Rate limited, backing off ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const backoff = Math.pow(2, attempt) * 1000;
      console.log(`Attempt ${attempt + 1} failed, retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
  throw new Error("All retries exhausted");
}

// ---------- Database Operations ----------

async function upsertOrganization(
  db: D1Database,
  event: HornsLinkEvent,
): Promise<void> {
  const profilePicUrl = event.organizationProfilePicture
    ? `${ORG_PROFILE_IMAGE_BASE}${event.organizationProfilePicture}`
    : null;

  await db
    .prepare(
      `INSERT INTO organizations (id, name, profile_picture, source, updated_at)
       VALUES (?, ?, ?, 'hornslink', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         profile_picture = excluded.profile_picture,
         updated_at = datetime('now')`,
    )
    .bind(event.organizationId, event.organizationName.trim(), profilePicUrl)
    .run();
}

async function upsertEvent(
  db: D1Database,
  event: HornsLinkEvent,
): Promise<{ isNew: boolean }> {
  const imageUrl = buildImageUrl(event.imagePath);
  const aspectRatio = classifyAspectRatio(null, null, !!event.imagePath);
  const locationShort = truncateLocation(event.location);
  const eventUrl = `${HORNSLINK_EVENT_URL_BASE}${event.id}`;
  const cleanDescription = stripHtml(event.description);

  // Check if event already exists
  const existing = await db
    .prepare(
      "SELECT id FROM events WHERE source = 'hornslink' AND source_event_id = ?",
    )
    .bind(event.id)
    .first();

  if (existing) {
    // Update existing event
    await db
      .prepare(
        `UPDATE events SET
          title = ?, description = ?, start_datetime = ?, end_datetime = ?,
          location_short = ?, location_full = ?, latitude = ?, longitude = ?,
          host_organization_id = ?, host_organization_name = ?,
          event_url = ?, image_url = ?, image_aspect_ratio = ?,
          theme = ?, visibility = ?, rsvp_total = ?,
          status = 'active', updated_at = datetime('now')
        WHERE source = 'hornslink' AND source_event_id = ?`,
      )
      .bind(
        event.name,
        cleanDescription,
        event.startsOn,
        event.endsOn,
        locationShort,
        event.location,
        event.latitude ? parseFloat(event.latitude) : null,
        event.longitude ? parseFloat(event.longitude) : null,
        event.organizationId,
        event.organizationName.trim(),
        eventUrl,
        imageUrl,
        aspectRatio,
        event.theme,
        event.visibility,
        event.rsvpTotal,
        event.id,
      )
      .run();

    // Clear and re-insert categories and benefits
    const eventId = existing.id as number;
    await db
      .prepare("DELETE FROM event_categories WHERE event_id = ?")
      .bind(eventId)
      .run();
    await db
      .prepare("DELETE FROM event_benefits WHERE event_id = ?")
      .bind(eventId)
      .run();

    await insertCategoriesAndBenefits(db, eventId, event);

    return { isNew: false };
  } else {
    // Insert new event
    const result = await db
      .prepare(
        `INSERT INTO events (
          source, source_event_id, title, description,
          start_datetime, end_datetime, location_short, location_full,
          latitude, longitude, host_organization_id, host_organization_name,
          event_url, image_url, image_aspect_ratio, theme,
          visibility, rsvp_total, status
        ) VALUES (
          'hornslink', ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, 'active'
        )`,
      )
      .bind(
        event.id,
        event.name,
        cleanDescription,
        event.startsOn,
        event.endsOn,
        locationShort,
        event.location,
        event.latitude ? parseFloat(event.latitude) : null,
        event.longitude ? parseFloat(event.longitude) : null,
        event.organizationId,
        event.organizationName.trim(),
        eventUrl,
        imageUrl,
        aspectRatio,
        event.theme,
        event.visibility,
        event.rsvpTotal,
      )
      .run();

    const eventId = result.meta.last_row_id;
    await insertCategoriesAndBenefits(db, eventId, event);

    return { isNew: true };
  }
}

async function insertCategoriesAndBenefits(
  db: D1Database,
  eventId: number,
  event: HornsLinkEvent,
): Promise<void> {
  // Insert categories
  for (let i = 0; i < event.categoryIds.length; i++) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO event_categories (event_id, category_id, category_name)
         VALUES (?, ?, ?)`,
      )
      .bind(eventId, event.categoryIds[i], event.categoryNames[i] || null)
      .run();
  }

  // Insert benefits/perks
  for (const benefit of event.benefitNames) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO event_benefits (event_id, benefit_name)
         VALUES (?, ?)`,
      )
      .bind(eventId, benefit)
      .run();
  }
}

// ---------- Main Scraper ----------

export async function scrapeHornsLink(
  db: D1Database,
  options?: { maxPages?: number; dryRun?: boolean; timeBudgetMs?: number },
): Promise<ScraperResult> {
  const startTime = Date.now();
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const dryRun = options?.dryRun ?? false;
  const timeBudgetMs = options?.timeBudgetMs ?? TIME_BUDGET_MS;
  const cutoffMs = startTime + DAYS_AHEAD * 24 * 60 * 60 * 1000;

  const result: ScraperResult = {
    eventsProcessed: 0,
    eventsInserted: 0,
    eventsUpdated: 0,
    eventsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  console.log(
    `[HornsLink] Starting scrape (maxPages=${maxPages}, dryRun=${dryRun})`,
  );

  for (let page = 0; page < maxPages; page++) {
    if (page > 0 && Date.now() - startTime > timeBudgetMs) {
      console.warn(
        `[HornsLink] Time budget (${timeBudgetMs}ms) exceeded after page ${page}, stopping early. Remaining pages will be picked up next run.`,
      );
      break;
    }

    try {
      const url = buildSearchUrl(page);
      console.log(`[HornsLink] Fetching page ${page + 1}/${maxPages}...`);

      const res = await fetchWithRetry(url);
      const data: HornsLinkSearchResponse = await res.json();

      if (!data.value || data.value.length === 0) {
        console.log(`[HornsLink] No more events on page ${page + 1}, stopping.`);
        break;
      }

      console.log(
        `[HornsLink] Got ${data.value.length} events (total available: ${data["@odata.count"]})`,
      );

      // Process each event with error isolation
      for (const event of data.value) {
        try {
          result.eventsProcessed++;

          // Defense in depth: enforce the 30-day window client-side in case
          // the API ignores the endsBefore hint.
          const startMs = new Date(event.startsOn).getTime();
          if (!isNaN(startMs) && startMs > cutoffMs) {
            result.eventsSkipped++;
            continue;
          }

          if (dryRun) {
            console.log(
              `[DRY RUN] Event: "${event.name}" by ${event.organizationName} @ ${event.location || "TBD"} on ${event.startsOn}`,
            );
            continue;
          }

          // Upsert org first (foreign key)
          await upsertOrganization(db, event);

          // Upsert event
          const { isNew } = await upsertEvent(db, event);
          if (isNew) {
            result.eventsInserted++;
          } else {
            result.eventsUpdated++;
          }
        } catch (err) {
          const errorMsg = `Failed to process event ${event.id} ("${event.name}"): ${err}`;
          console.error(`[HornsLink] ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }

      // Polite delay between pages
      if (page < maxPages - 1) {
        await sleep(REQUEST_DELAY_MS);
      }
    } catch (err) {
      const errorMsg = `Failed to fetch page ${page + 1}: ${err}`;
      console.error(`[HornsLink] ${errorMsg}`);
      result.errors.push(errorMsg);
    }
  }

  result.durationMs = Date.now() - startTime;
  console.log(
    `[HornsLink] Scrape complete: ${result.eventsProcessed} fetched, ` +
      `${result.eventsInserted + result.eventsUpdated} upserted ` +
      `(${result.eventsInserted} inserted, ${result.eventsUpdated} updated), ` +
      `${result.eventsSkipped} skipped, ${result.errors.length} errors ` +
      `in ${result.durationMs}ms`,
  );

  return result;
}

/**
 * Cron entrypoint — called by the scheduled handler in worker.ts every 6h.
 * Uses a larger page budget than the manual /events/scrape route to reach
 * the 200-500 events/run target.
 */
export async function run(env: Env): Promise<void> {
  console.log("[HornsLink] Cron scrape started");

  const result = await scrapeHornsLink(env.DB, { maxPages: CRON_MAX_PAGES });

  if (result.errors.length > 0) {
    console.error(
      `[HornsLink] Cron run had ${result.errors.length} event-level error(s):`,
      result.errors,
    );
  }
}
