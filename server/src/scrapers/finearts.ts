// COFA (College of Fine Arts) scraper: finearts.utexas.edu/events (Drupal Views).
//
// Event data comes straight from the paginated listing HTML (?page=0,1,...).
// Unlike Texas Global, each event's title links out to an EXTERNAL
// ticketing/venue site (utvac.org, texasperformingarts.org,
// music.utexas.edu, ...) rather than an internal detail page.
//
// Things we can't get:
//   - description: not present anywhere in the listing, and the linked
//     page is a different (per-venue) site we won't scrape.
//   - organizer: the listing doesn't expose which UT unit posted the
//     event — only a separate department filter dropdown does, keyed by
//     an id we have no way to join back to each row. We recognize a few
//     well-known ticketing domains and fall back to a generic default.

import { ingestEvents } from '../events/ingest';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import { inferVenueType } from './helpers';

const BASE_URL = 'https://finearts.utexas.edu';
const LISTING_URL = `${BASE_URL}/events`;
export const SOURCE = 'cofa';

const REQUEST_DELAY_MS = 200;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_ORG_NAME = 'College of Fine Arts';
const MAX_PAGES = 50; // safety cap; site has ~11 pages as of writing

// Best-effort hostname -> organizer name, since the listing itself doesn't
// expose the organizing unit per row (see module comment above).
const ORG_BY_HOSTNAME: Record<string, string> = {
  'utvac.org': 'Visual Arts Center',
  'texasperformingarts.org': 'Texas Performing Arts',
  'music.utexas.edu': 'Butler School of Music',
};

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// Helpers, exported for unit tests

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// A formatter (Prettier on our own fixtures, or Drupal itself) can wrap
// long tags and push a closing `>` onto its own indented line, breaking
// regexes that assume tags sit adjacent to their neighbors. Collapsing all
// whitespace back down makes the parser resilient to either.
export function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .replace(/<\s+/g, '<')
    .replace(/> </g, '><');
}

// "/sites/.../styles/utexas_image_style_600w/public/2025-12/foo.jpg.webp?itok=..."
// -> "/sites/.../2025-12/foo.jpg.webp". Same Drupal image-style path as
// Texas Global.
export function upgradeImageUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  return src.replace(/\/styles\/[^/]+\/public\//, '/').replace(/\?.*$/, '');
}

export function orgNameForUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return ORG_BY_HOSTNAME[hostname] ?? DEFAULT_ORG_NAME;
  } catch {
    return DEFAULT_ORG_NAME;
  }
}

const TIME_BLOCK_RE =
  /<div class="views-field views-field-field-cofaevent-datetime"><div class="field-content">([\s\S]*?)<\/div><\/div>/;
const DATETIME_ATTR_RE = /datetime="([^"]+)"/g;

// Returns null if the row has no parseable start date. A row with two
// <time> tags is a date (or date+time) range; a row with one is a single
// instant.
export function extractDateRange(rowHtml: string): { start: string; end: string | null } | null {
  const block = rowHtml.match(TIME_BLOCK_RE);
  if (!block) return null;

  const datetimes = [...block[1].matchAll(DATETIME_ATTR_RE)].map((m) => m[1]);
  if (datetimes.length === 0) return null;

  const start = datetimes[0];
  const last = datetimes[datetimes.length - 1];
  return { start, end: last !== start ? last : null };
}

// Rows aren't wrapped in a tag we can close-match cleanly (variable nesting
// depth depending on which optional fields a row has), so we split on the
// literal marker that starts every row instead. Each chunk then reads past
// its own end into the next row(s), but that's harmless: our field regexes
// use plain (non-global) .match(), which returns the *first* hit — and a
// row's own fields always appear before the next row's in the chunk.
const ROW_MARKER = '<div class="cofaevent-row row">';

export function extractEventRows(html: string): string[] {
  return normalizeHtml(html).split(ROW_MARKER).slice(1);
}

export function hasNextPage(html: string): boolean {
  return /rel="next"/.test(html);
}

// Pure and sync so it's easy to test against saved HTML fixtures.
export function parseEventRow(rowHtml: string, now = Date.now()): NormalizedEvent | null {
  const titleMatch = rowHtml.match(
    /<div class="views-field views-field-title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
  );
  if (!titleMatch) {
    console.warn('[finearts] Row missing title/link — skipping');
    return null;
  }
  const eventUrl = titleMatch[1];
  const title = decodeHtmlEntities(titleMatch[2]).trim();

  const range = extractDateRange(rowHtml);
  if (!range) {
    console.warn(`[finearts] Event "${title}" missing start date — skipping`);
    return null;
  }
  const startMs = new Date(range.start).getTime();
  if (isNaN(startMs)) return null;
  // Multi-day ranges should stay visible for as long as they're running,
  // not just until their start date.
  const endMs = range.end ? new Date(range.end).getTime() : startMs;
  if (endMs < now) return null;

  const imgTagMatch = rowHtml.match(/<img\b[^>]*>/);
  const imgTag = imgTagMatch?.[0] ?? null;
  const srcMatch = imgTag?.match(/\bsrc="([^"]+)"/);
  const widthMatch = imgTag?.match(/\bwidth="(\d+)"/);
  const heightMatch = imgTag?.match(/\bheight="(\d+)"/);
  const upgradedSrc = srcMatch ? upgradeImageUrl(srcMatch[1]) : null;
  const imageUrl = upgradedSrc
    ? upgradedSrc.startsWith('http')
      ? upgradedSrc
      : `${BASE_URL}${upgradedSrc}`
    : null;
  const imageWidth = imageUrl && widthMatch ? parseInt(widthMatch[1], 10) : null;
  const imageHeight = imageUrl && heightMatch ? parseInt(heightMatch[1], 10) : null;
  let imageAspectRatio: NormalizedEvent['imageAspectRatio'] = imageUrl ? 'horizontal' : 'none';
  if (imageWidth && imageHeight) {
    const ratio = imageWidth / imageHeight;
    imageAspectRatio = ratio > 1.05 ? 'horizontal' : ratio < 0.95 ? 'vertical' : 'square';
  }

  const locationMatch = rowHtml.match(
    /<div class="views-field views-field-field-cofaevent-location-name"><div class="field-content">\s*<a[^>]*>([^<]*)<\/a>/,
  );
  const locationName = locationMatch ? decodeHtmlEntities(locationMatch[1]).trim() || null : null;

  return {
    source: SOURCE,
    sourceEventId: `${eventUrl}::${range.start}`,
    title,
    description: null,
    startDatetime: range.start,
    endDatetime: range.end,
    venueType: inferVenueType(locationName, null),
    locationShort: locationName ? locationName.slice(0, 40) : null,
    locationFull: locationName,
    latitude: null,
    longitude: null,
    organization: {
      // No numeric org id available; see the hostname heuristic above.
      sourceOrgId: null,
      name: orgNameForUrl(eventUrl),
      profilePicture: null,
    },
    eventUrl,
    rsvpUrl: null,
    imageUrl,
    imageWidth,
    imageHeight,
    imageAspectRatio,
    imageMimeType: imageUrl ? 'image/webp' : null,
    imageAltText: null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: [],
    benefits: [],
  };
}

export async function discoverEventRows(): Promise<string[]> {
  const rows: string[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchWithRetry(`${LISTING_URL}?page=${page}`, { headers: { Accept: '*/*' } });
    const html = await res.text();
    rows.push(...extractEventRows(html));
    if (!hasNextPage(html)) break;
    await sleep(REQUEST_DELAY_MS);
  }

  return rows;
}

export async function scrapeFineArts(
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

  let rows: string[];
  try {
    rows = await discoverEventRows();
  } catch (err) {
    const msg = `Fatal error discovering event listing: ${err}`;
    console.error(`[finearts] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  console.log(`[finearts] Discovered ${rows.length} event rows`);

  const now = Date.now();
  const normalized: NormalizedEvent[] = [];

  for (const rowHtml of rows.slice(0, maxEvents)) {
    eventsProcessed++;
    try {
      const parsed = parseEventRow(rowHtml, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(
          `[DRY RUN] "${parsed.title}" (${parsed.sourceEventId}) — ${parsed.organization.name}`,
        );
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process row: ${err}`;
      console.error(`[finearts] ${msg}`);
      errors.push(msg);
    }
  }

  if (!dryRun && normalized.length > 0) {
    const result = await ingestEvents(env, normalized);
    eventsUpserted = result.inserted + result.updated;
    errors.push(...result.errors);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[finearts] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[finearts] Scraper started');
  await scrapeFineArts(env);
}
