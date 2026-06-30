/**
 * Texas Today scraper — pulls events from calendar.utexas.edu (Localist JSON API)
 * and upserts them into D1.
 *
 * The UT Austin calendar runs on Localist, which exposes a JSON API at
 * /api/2/events. We prefer this over HTML scraping because it's stable,
 * paginated, and returns structured data including image dimensions.
 *
 * Deduplication key: (source, source_event_id) = ("texas_today", instance_id)
 * Using the instance ID (not event ID) means recurring events produce one row
 * per occurrence — the home feed can then show each date as a separate card.
 */

import type { Env } from '../worker';

const BASE_URL = 'https://calendar.utexas.edu';
const API_BASE = `${BASE_URL}/api/2/events`;
const PER_PAGE = 100;
const DAYS_AHEAD = 365;
export const SOURCE = 'texas_today';

// ─── Localist API types ────────────────────────────────────────────────────

interface LocalistEventInstance {
  event_instance: {
    id: number;
    event_id: number;
    start: string; // ISO 8601 with America/Chicago offset, e.g. "2024-02-28T16:00:00-06:00"
    end: string | null;
    all_day: boolean;
  };
}

export interface LocalistDepartment {
  name: string;
  url: string;
  localist_url: string;
  hashtag: string;
}

export interface LocalistRawEvent {
  event: {
    id: number;
    title: string;
    description: string | null;
    location: string | null;
    room: string | null;
    address: string | null;
    url: string;
    localist_url: string;
    event_instances: LocalistEventInstance[];
    photo_url: string | null;
    photo_width: number | null;
    photo_height: number | null;
    photo_alt: string | null;
    photo_content_type: string | null;
    departments: LocalistDepartment[];
    filters: Record<string, Array<{ name: string; id: number }>>;
    tags: string[];
    keywords: string[];
  };
}

interface LocalistApiResponse {
  events: LocalistRawEvent[];
  page: {
    current: number;
    size: number;
    total: number; // total number of PAGES, not events
  };
}

// ─── Output type ──────────────────────────────────────────────────────────

export interface ParsedEvent {
  source: string;
  source_event_id: string;
  title: string;
  description: string | null;
  start_datetime: string;
  end_datetime: string | null;
  location_short: string | null;
  location_full: string | null;
  // Matches the events table column name (host_organization_name).
  // host_organization_id is always null for Texas Today (no numeric org IDs).
  host_organization_name: string | null;
  event_url: string;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  image_aspect_ratio: 'vertical' | 'square' | 'horizontal' | 'none';
  image_mime_type: string | null;
  image_alt_text: string | null;
  // Not stored in the events row — written to event_categories after upsert.
  categories: Array<{ id: string; name: string }>;
}

// ─── Pure helper functions (exported for unit tests) ──────────────────────

/** Strip HTML tags and decode common entities to plain text. */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * Classify the aspect ratio of an image.
 * Uses a 5% tolerance band so a 1000×999 image reads as "square" not "horizontal".
 * Returns "none" when dimensions are absent (no image).
 */
export function classifyAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
): 'vertical' | 'square' | 'horizontal' | 'none' {
  if (!width || !height || width <= 0 || height <= 0) return 'none';
  const ratio = width / height;
  if (ratio > 1.05) return 'horizontal';
  if (ratio < 0.95) return 'vertical';
  return 'square';
}

/**
 * Build a display-friendly short location (≤ 40 chars).
 * We strip the street address portion (digits at word boundary) so that
 * "Gregory Gym (GRE), 2101 Speedway" becomes "Gregory Gym (GRE)".
 */
export function buildLocationShort(location: string | null | undefined): string | null {
  if (!location) return null;
  // Remove trailing address: ", 123 Something St"
  const stripped = location.replace(/,\s*\d+[^,]*$/, '').trim();
  const candidate = stripped || location.trim();
  if (candidate.length <= 40) return candidate;
  return candidate.substring(0, 37) + '...';
}

/** Combine venue name + street address into a full location string. */
export function buildLocationFull(
  location: string | null | undefined,
  address: string | null | undefined,
): string | null {
  const parts = [location?.trim(), address?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Try to upgrade a Localist CDN thumbnail URL to the highest resolution.
 * Localist stores images at path segments like /thumb/, /medium/, /small/.
 * Replacing with /huge/ gets the original upload.
 */
export function upgradeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/\/thumb\//, '/huge/')
    .replace(/\/medium\//, '/huge/')
    .replace(/\/small\//, '/huge/');
}

/** Derive a slug for a department from its hashtag or URL path. */
export function extractDepartmentSlug(dept: LocalistDepartment): string {
  if (dept.hashtag) return dept.hashtag;
  const url = dept.localist_url || dept.url;
  if (!url) return dept.name.toLowerCase().replace(/\s+/g, '-');
  const match = url.match(/\/([^/]+)\/?$/);
  return match ? match[1] : dept.name.toLowerCase().replace(/\s+/g, '-');
}

// ─── Parser ───────────────────────────────────────────────────────────────

/**
 * Parse one Localist event + one of its instances into our normalized shape.
 * Returns null (with a warning log) when required fields are missing.
 */
export function parseEventInstance(
  raw: LocalistRawEvent,
  instance: LocalistEventInstance,
): ParsedEvent | null {
  const e = raw.event;
  const inst = instance.event_instance;

  if (!inst.start) {
    console.warn(`[texasToday] Event ${e.id} instance ${inst.id} missing start time — skipping`);
    return null;
  }

  const dept = e.departments?.[0] ?? null;

  // Merge event-level tags + event_type filter labels into categories
  const seen = new Set<string>();
  const categories: Array<{ id: string; name: string }> = [];
  for (const tag of [...(e.tags ?? []), ...(e.filters?.event_types?.map((t) => t.name) ?? [])]) {
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      categories.push({ id: tag.toLowerCase().replace(/\s+/g, '-'), name: tag });
    }
  }

  const imageUrl = upgradeImageUrl(e.photo_url);
  const hasImage = Boolean(imageUrl);

  return {
    source: SOURCE,
    // Use the instance ID so recurring events each get their own row
    source_event_id: String(inst.id),
    title: e.title,
    description: stripHtml(e.description),
    start_datetime: inst.start,
    end_datetime: inst.end ?? null,
    location_short: buildLocationShort(e.location),
    location_full: buildLocationFull(e.location, e.address),
    host_organization_name: dept?.name ?? null,
    event_url: e.localist_url || e.url,
    image_url: imageUrl,
    image_width: hasImage ? (e.photo_width ?? null) : null,
    image_height: hasImage ? (e.photo_height ?? null) : null,
    // The UT Localist API doesn't return photo_width/photo_height, so we
    // default to "horizontal" (most event flyers are landscape) when we have
    // an image but no dimension data. "none" is reserved for no-image events.
    image_aspect_ratio: hasImage
      ? classifyAspectRatio(e.photo_width, e.photo_height) === 'none'
        ? 'horizontal'
        : classifyAspectRatio(e.photo_width, e.photo_height)
      : 'none',
    image_mime_type: hasImage ? (e.photo_content_type ?? null) : null,
    image_alt_text: hasImage ? (e.photo_alt ?? null) : null,
    categories,
  };
}

/**
 * Convert a raw Localist event (which may have multiple instances) into one
 * ParsedEvent per upcoming instance.  We only keep instances whose start time
 * is in the future so we don't backfill stale rows on every run.
 */
export function parseEvent(raw: LocalistRawEvent, now = Date.now()): ParsedEvent[] {
  const instances = raw.event?.event_instances ?? [];
  if (instances.length === 0) {
    console.warn(`[texasToday] Event ${raw.event?.id} has no instances — skipping`);
    return [];
  }

  const results: ParsedEvent[] = [];
  for (const inst of instances) {
    const startMs = new Date(inst.event_instance.start).getTime();
    if (isNaN(startMs) || startMs < now) continue; // skip past instances

    try {
      const parsed = parseEventInstance(raw, inst);
      if (parsed) results.push(parsed);
    } catch (err) {
      console.error(
        `[texasToday] Failed to parse instance ${inst.event_instance.id} of event ${raw.event?.id}: ${err}`,
      );
    }
  }
  return results;
}

// ─── Fetcher ──────────────────────────────────────────────────────────────

async function fetchPage(page: number): Promise<LocalistApiResponse> {
  const url = `${API_BASE}?days=${DAYS_AHEAD}&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'LonghornLoop/1.0 (+https://longhornloop.app)',
    },
  });
  if (!res.ok) {
    throw new Error(`Localist API ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<LocalistApiResponse>;
}

export async function fetchAllEvents(): Promise<ParsedEvent[]> {
  const parsed: ParsedEvent[] = [];
  let page = 1;
  let totalPages = 1;
  const now = Date.now();

  do {
    console.log(`[texasToday] Fetching page ${page}/${totalPages} …`);
    const data = await fetchPage(page);

    // `page.total` is total number of pages (Localist quirk)
    totalPages = data.page.total;

    for (const rawEvent of data.events) {
      try {
        const events = parseEvent(rawEvent, now);
        parsed.push(...events);
      } catch (err) {
        console.error(`[texasToday] Unhandled parse error for event ${rawEvent.event?.id}: ${err}`);
      }
    }

    page++;
  } while (page <= totalPages);

  return parsed;
}

// ─── D1 upsert ────────────────────────────────────────────────────────────

const UPSERT_SQL = `
  INSERT INTO events (
    source, source_event_id, title, description,
    start_datetime, end_datetime,
    location_short, location_full,
    host_organization_id, host_organization_name,
    event_url,
    image_url, image_width, image_height, image_aspect_ratio,
    image_mime_type, image_alt_text,
    expires_at,
    visibility, status, updated_at
  ) VALUES (
    ?, ?, ?, ?,
    ?, ?,
    ?, ?,
    NULL, ?,
    ?,
    ?, ?, ?, ?,
    ?, ?,
    ?,
    'Public', 'active', datetime('now')
  )
  ON CONFLICT(source, source_event_id) DO UPDATE SET
    title                  = excluded.title,
    description            = excluded.description,
    start_datetime         = excluded.start_datetime,
    end_datetime           = excluded.end_datetime,
    location_short         = excluded.location_short,
    location_full          = excluded.location_full,
    host_organization_name = excluded.host_organization_name,
    event_url              = excluded.event_url,
    image_url              = excluded.image_url,
    image_width            = excluded.image_width,
    image_height           = excluded.image_height,
    image_aspect_ratio     = excluded.image_aspect_ratio,
    image_mime_type        = excluded.image_mime_type,
    image_alt_text         = excluded.image_alt_text,
    expires_at             = excluded.expires_at,
    updated_at             = datetime('now')
`;

// Purge target for the cleanup job (LOOP-150): end time + 7 days, falling
// back to the start time when an event has no end time.
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function computeExpiresAt(endDatetime: string | null, startDatetime: string): string {
  const base = endDatetime ?? startDatetime;
  return new Date(new Date(base).getTime() + EXPIRES_AFTER_MS).toISOString();
}

async function upsertEvent(db: D1Database, e: ParsedEvent): Promise<void> {
  const expiresAt = computeExpiresAt(e.end_datetime, e.start_datetime);

  // Upsert the event row and get back the row ID (works for both insert + update)
  const result = await db
    .prepare(UPSERT_SQL)
    .bind(
      e.source,
      e.source_event_id,
      e.title,
      e.description,
      e.start_datetime,
      e.end_datetime,
      e.location_short,
      e.location_full,
      e.host_organization_name,
      e.event_url,
      e.image_url,
      e.image_width,
      e.image_height,
      e.image_aspect_ratio,
      e.image_mime_type,
      e.image_alt_text,
      expiresAt,
    )
    .run();

  const eventId = result.meta.last_row_id;

  if (e.categories.length > 0) {
    // Replace categories: clear old ones then insert fresh set
    await db.prepare('DELETE FROM event_categories WHERE event_id = ?').bind(eventId).run();

    for (const cat of e.categories) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO event_categories (event_id, category_id, category_name)
         VALUES (?, ?, ?)`,
        )
        .bind(eventId, cat.id, cat.name)
        .run();
    }
  }
}

async function upsertEvents(
  db: D1Database,
  events: ParsedEvent[],
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors = 0;

  for (const e of events) {
    try {
      await upsertEvent(db, e);
      upserted++;
    } catch (err) {
      console.error(`[texasToday] Failed to upsert event instance ${e.source_event_id}: ${err}`);
      errors++;
    }
  }

  return { upserted, errors };
}

// ─── Public entrypoint ────────────────────────────────────────────────────

/** Called by the scheduled cron handler in worker.ts. */
export async function run(env: Env): Promise<void> {
  console.log('[texasToday] Scraper started');
  const t0 = Date.now();

  let events: ParsedEvent[];
  try {
    events = await fetchAllEvents();
  } catch (err) {
    console.error(`[texasToday] Fatal fetch error — aborting run: ${err}`);
    return;
  }

  console.log(`[texasToday] Parsed ${events.length} event instances`);

  const { upserted, errors } = await upsertEvents(env.DB, events);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`[texasToday] Finished in ${elapsed}s — ${upserted} upserted, ${errors} errors`);
}
