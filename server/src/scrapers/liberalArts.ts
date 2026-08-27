// College of Liberal Arts scraper: liberalarts.utexas.edu/news-events/events.html.
//
// The listing is rendered client-side from COLA's public JSON:API. The API
// provides full event records and pagination links, so scraping it directly is
// both more complete and less brittle than parsing the empty HTML shell.
//
// Source-specific details:
//   - Dates and times arrive as separate display strings with no UTC offset.
//     We combine them and attach the correct America/Chicago DST offset.
//   - The API exposes a sponsor but no topical tags. When present, the sponsor
//     becomes both the host organization and the event's source category.
//   - full_image_path is populated with the bucket root even when an event has
//     no image, so image_path is the authoritative "has image" signal.
//   - Descriptions, titles, sponsors, and captions may contain HTML entities;
//     descriptions may additionally contain full HTML fragments.
//
// Dedup key: the API's stable numeric event id.

import { ingestEvents } from '../events/ingest';
import {
  classifyAspectRatio,
  fetchImageMeta,
  stripHtml,
  truncateLocation,
} from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import { inferVenueType } from './helpers';

const BASE_URL = 'https://liberalarts.utexas.edu';
// Explicit page parameters make the API return JSON:API pagination metadata.
// The public page uses the same division filter to show college-wide events.
const API_URL =
  'https://webeditor.la.utexas.edu/api/v2/events?filter%5Bdivision%5D=public-affairs&sort=date&page%5Bnumber%5D=1&page%5Bsize%5D=15';
export const SOURCE = 'cola';

const REQUEST_DELAY_MS = 200;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_ORG_NAME = 'College of Liberal Arts';
// Guards against a malformed or cyclic `links.next` chain.
const MAX_PAGES = 100;

// Only fields consumed by the scraper are modeled. The API also returns
// presentation-only fields such as weekday, formatted date, and publish date.
interface ColaEventAttributes {
  title: string;
  summary: string | null;
  body_content: string | null;
  location: string | null;
  day: string;
  month: string;
  year: string;
  begin_time: string | null;
  end_time: string | null;
  sponsor: string | null;
  image_caption: string | null;
  image_path: string | null;
  full_image_path: string | null;
  slug: string;
}

export interface ColaApiEvent {
  // Stable database id assigned by COLA's web editor.
  id: string;
  attributes: ColaEventAttributes;
}

// Minimal JSON:API collection shape needed for discovery.
interface ColaApiResponse {
  data: ColaApiEvent[];
  links?: {
    next?: string | null;
  };
}

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  auml: 'ä',
  gt: '>',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  ntilde: 'ñ',
  oacute: 'ó',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
};

// COLA content contains both named entities and numeric Unicode entities.
// Unknown named entities are preserved instead of silently dropping content.
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith('#x')) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) {
      return String.fromCodePoint(parseInt(code.slice(1), 10));
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

// Decode entities before stripping tags so encoded markup remains ordinary
// text. Returning null for empty content matches the shared D1 event schema.
function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = stripHtml(decodeHtmlEntities(value));
  return cleaned || null;
}

// COLA currently emits 12-hour values such as "12:00 PM". A strict parser
// makes unexpected upstream formats fail one event instead of inventing a time.
function parseTime(value: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return null;

  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return { hour, minute: Number(match[2]) };
}

// Calculate a DST boundary without relying on the Worker's host timezone.
function nthSunday(year: number, month: number, occurrence: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - firstWeekday) % 7) + (occurrence - 1) * 7;
}

// America/Chicago is UTC-5 from the second Sunday in March until the first
// Sunday in November, and UTC-6 otherwise. COLA events are campus events, so
// America/Chicago is the source timezone even if the Worker runs in UTC.
export function centralUtcOffset(year: number, month: number, day: number): string {
  const dstStart = nthSunday(year, 3, 2);
  const dstEnd = nthSunday(year, 11, 1);
  const isDst =
    (month > 3 && month < 11) || (month === 3 && day >= dstStart) || (month === 11 && day < dstEnd);
  return isDst ? '-05:00' : '-06:00';
}

// Combine the API's separate date fields and display time into an ISO-8601
// datetime suitable for D1 and the React Native client.
function buildDatetime(attributes: ColaEventAttributes, timeValue: string | null): string | null {
  const year = Number(attributes.year);
  const month = MONTHS[attributes.month];
  const day = Number(attributes.day);
  const time = parseTime(timeValue);

  if (!year || !month || !day || !time) return null;

  const pad = (value: number) => String(value).padStart(2, '0');
  const datetime = `${year}-${pad(month)}-${pad(day)}T${pad(time.hour)}:${pad(time.minute)}:00${centralUtcOffset(year, month, day)}`;
  return Number.isNaN(new Date(datetime).getTime()) ? null : datetime;
}

// Category ids must be deterministic across runs; names remain human-readable.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Map one JSON:API record into the shared ingestion shape.
 *
 * This function is intentionally pure and synchronous so fixtures can cover
 * source parsing without network or D1 dependencies. Image dimensions and MIME
 * type are added later because they require a range request to the image.
 */
export function parseApiEvent(event: ColaApiEvent, now = Date.now()): NormalizedEvent | null {
  const attributes = event.attributes;
  const title = cleanText(attributes.title);
  const startDatetime = buildDatetime(attributes, attributes.begin_time);
  if (!event.id || !title || !startDatetime || !attributes.slug) return null;

  const endDatetime = buildDatetime(attributes, attributes.end_time);
  const endMs = new Date(endDatetime ?? startDatetime).getTime();
  // Keep an in-progress event until its end time. With no end time, the start
  // time is the best available cutoff.
  if (endMs < now) return null;

  const locationFull = cleanText(attributes.location);
  const sponsor = cleanText(attributes.sponsor);
  const organizationName = sponsor ?? DEFAULT_ORG_NAME;
  // The bucket root alone is not an event image; image_path distinguishes it.
  const imageUrl = attributes.image_path ? attributes.full_image_path : null;
  const eventUrl = `${BASE_URL}/events/${attributes.slug}`;

  return {
    source: SOURCE,
    sourceEventId: event.id,
    title,
    description: cleanText(attributes.summary) ?? cleanText(attributes.body_content),
    startDatetime,
    endDatetime,
    venueType: inferVenueType(locationFull, null),
    locationShort: truncateLocation(locationFull),
    locationFull,
    latitude: null,
    longitude: null,
    organization: {
      sourceOrgId: null,
      name: organizationName,
      profilePicture: null,
    },
    eventUrl,
    rsvpUrl: null,
    imageUrl,
    imageWidth: null,
    imageHeight: null,
    // Replaced with header-derived classification during orchestration.
    imageAspectRatio: imageUrl ? 'square' : 'none',
    imageMimeType: null,
    imageAltText: imageUrl ? (cleanText(attributes.image_caption) ?? title) : null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    // COLA exposes organizational sponsorship, but no topical categories.
    categories: sponsor ? [{ id: `sponsor-${slugify(sponsor)}`, name: sponsor }] : [],
    benefits: [],
  };
}

export function getNextPageUrl(payload: ColaApiResponse): string | null {
  return payload.links?.next ?? null;
}

/**
 * Follow the API-provided next links and deduplicate records by stable id.
 *
 * A Map protects against overlapping pages if new events are published while a
 * scrape is in progress. The returned order remains the API's date order.
 */
export async function discoverApiEvents(): Promise<ColaApiEvent[]> {
  const events = new Map<string, ColaApiEvent>();
  let pageUrl: string | null = API_URL;

  for (let page = 0; page < MAX_PAGES && pageUrl; page++) {
    const res = await fetchWithRetry(pageUrl, { headers: { Accept: '*/*' } });
    const payload = (await res.json()) as ColaApiResponse;
    // Treat a changed response shape as a discovery failure. Continuing with a
    // partial run would undermine the scraper's coverage guarantee.
    if (!Array.isArray(payload.data)) {
      throw new Error(`Invalid API response on page ${page + 1}`);
    }

    for (const event of payload.data) {
      if (event?.id && event.attributes) events.set(event.id, event);
    }

    pageUrl = getNextPageUrl(payload);
    if (pageUrl) await sleep(REQUEST_DELAY_MS);
  }

  return [...events.values()];
}

/**
 * Discover, normalize, enrich, and ingest one COLA scrape run.
 *
 * Discovery failures stop the run because completeness is unknown. Once the
 * collection is available, each event is isolated so malformed content or a
 * failed image request cannot prevent other records from reaching D1.
 */
export async function scrapeLiberalArts(
  env: Env,
  options: { maxEvents?: number; dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsProcessed = 0;
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let apiEvents: ColaApiEvent[];
  try {
    apiEvents = await discoverApiEvents();
  } catch (err) {
    const msg = `Fatal error discovering events: ${err}`;
    console.error(`[liberalArts] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  console.log(`[liberalArts] Discovered ${apiEvents.length} events`);
  const normalized: NormalizedEvent[] = [];
  const now = Date.now();

  for (const apiEvent of apiEvents.slice(0, maxEvents)) {
    eventsProcessed++;
    try {
      const parsed = parseApiEvent(apiEvent, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl) {
        // Range-read only the image header; full flyer downloads are unnecessary.
        const meta = await fetchImageMeta(parsed.imageUrl, 'liberalArts');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = meta.mimeType;
        parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
        await sleep(REQUEST_DELAY_MS);
      }

      if (dryRun) {
        console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process event ${apiEvent.id}: ${err}`;
      console.error(`[liberalArts] ${msg}`);
      errors.push(msg);
    }
  }

  if (!dryRun && normalized.length > 0) {
    // Shared ingestion performs the (source, source_event_id) upsert and
    // isolates D1 errors per event.
    const result = await ingestEvents(env, normalized);
    eventsUpserted = result.inserted + result.updated;
    errors.push(...result.errors);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[liberalArts] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed, eventsUpserted, eventsSkipped, errors, durationMs };
}

// Scheduled Worker entrypoint used by the central scraper registry.
export async function run(env: Env): Promise<void> {
  console.log('[liberalArts] Scraper started');
  await scrapeLiberalArts(env);
}
