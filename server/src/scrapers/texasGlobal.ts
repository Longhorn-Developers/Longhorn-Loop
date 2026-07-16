// Texas Global scraper: global.utexas.edu/events (Drupal, no JSON API).
//
// Event data comes straight from the paginated listing HTML
// (?page=0, ?page=1, ...) — each page has up to 20 <article class="card
// shadow"> teasers. There's no per-event detail JSON, but the teaser
// already carries everything except the description, so we only hit the
// detail page once per unique event URL (cached) to grab that.
//
// Recurring events (e.g. a weekly Q&A) show up as multiple teasers that
// all point at the *same* node URL but with different <time> values, so
// the URL alone isn't a unique key. Dedup key: `${slug}::${startDatetime}`.
//
// Things we can't get:
//   - rsvpUrl is only set for virtual events, where the "location" link
//     literally is the Zoom/Meet/Teams join link. In-person events only
//     expose a Google Maps link, which we don't have a field for.
//   - No organizer profile picture; departments have no numeric id.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';

const BASE_URL = 'https://global.utexas.edu';
const LISTING_URL = `${BASE_URL}/events`;
export const SOURCE = 'texas_global';

const REQUEST_DELAY_MS = 200;
const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_ORG_NAME = 'Texas Global';
const MAX_PAGES = 50; // safety cap; site has ~3 pages as of writing

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

// Card markup nests <time> inside <time> inside <i>, which makes proper
// tag-depth parsing overkill. Every teaser's date block reliably ends in
// "...</i></time>", so a lazy match up to that closer is enough.
const TIME_BLOCK_RE = /<time class="posted">([\s\S]*?)<\/i><\/time>/;
const DATETIME_ATTR_RE = /datetime="([^"]+)"/g;

// Returns null if the card has no parseable start time. When the block
// spans a date range (multi-day, or a start/end time on the same day),
// the *last* datetime differs from the first; single-instant events have
// every datetime attr identical, so start === end and we drop it to null.
export function extractDateRange(cardHtml: string): { start: string; end: string | null } | null {
  const block = cardHtml.match(TIME_BLOCK_RE);
  if (!block) return null;

  const datetimes = [...block[1].matchAll(DATETIME_ATTR_RE)].map((m) => m[1]);
  if (datetimes.length === 0) return null;

  const start = datetimes[0];
  const last = datetimes[datetimes.length - 1];
  return { start, end: last !== start ? last : null };
}

// "/sites/.../styles/event_detail_banner_views_2x_628x252_/public/2026-05/foo.jpg?itok=..."
// -> "/sites/.../2026-05/foo.jpg". Drupal-specific image style path.
export function upgradeImageUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  return src.replace(/\/styles\/[^/]+\/public\//, '/').replace(/\?.*$/, '');
}

const MEETING_LINK_RE = /zoom\.us|teams\.microsoft\.com|meet\.google\.com/i;

// Physical events link to a Google Maps search; virtual events link
// directly to the join URL. We only have a field (rsvpUrl) for the
// latter — the maps link isn't stored anywhere.
export function isMeetingLink(href: string): boolean {
  return MEETING_LINK_RE.test(href);
}

// "/events/search?unit=2170" -> "unit-2170". Used as a stable category id
// since Texas Global doesn't expose numeric category ids in the markup.
export function categoryIdFromHref(href: string): string {
  const query = href.split('?')[1] ?? '';
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function extractSlug(eventUrl: string): string | null {
  const match = eventUrl.match(/\/events\/([^/?#]+)/);
  return match ? match[1] : null;
}

// Our regex parsing assumes tags sit adjacent to their neighbors (e.g.
// `<time class="posted">`, `</i></time>`), but a formatter — Prettier on our
// own fixtures, or Drupal itself on a template change — can wrap long tags
// and push the closing `>` onto its own indented line. Collapsing all
// whitespace back down makes the parser resilient to either.
export function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .replace(/<\s+/g, '<')
    .replace(/> </g, '><');
}

export function extractEventCards(html: string): string[] {
  const normalized = normalizeHtml(html);
  return [...normalized.matchAll(/<article class="card shadow">([\s\S]*?)<\/article>/g)].map(
    (m) => m[1],
  );
}

export function hasNextPage(html: string): boolean {
  return /rel="next"/.test(html);
}

interface ParsedCategory {
  href: string;
  name: string;
}

function extractCategories(cardHtml: string): ParsedCategory[] {
  const block = cardHtml.match(/<ul class="categories-block[^"]*">([\s\S]*?)<\/ul>/);
  if (!block) return [];
  return [...block[1].matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)].map((m) => ({
    href: m[1],
    name: decodeHtmlEntities(m[2]).trim(),
  }));
}

// Pure and sync so it's easy to test against saved HTML fixtures.
// Description is filled in separately (needs a detail-page fetch shared
// across every instance of a recurring event); image dimensions are
// filled in by the orchestrator once imageUrl is known, same as McCombs.
export function parseEventCard(cardHtml: string, now = Date.now()): NormalizedEvent | null {
  const titleMatch = cardHtml.match(/<h3><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>/);
  if (!titleMatch) {
    console.warn('[texasGlobal] Card missing title/link — skipping');
    return null;
  }
  const eventPath = titleMatch[1];
  const title = decodeHtmlEntities(titleMatch[2]).trim();
  const eventUrl = eventPath.startsWith('http') ? eventPath : `${BASE_URL}${eventPath}`;

  const slug = extractSlug(eventUrl);
  if (!slug) {
    console.warn(`[texasGlobal] Could not extract slug from ${eventUrl} — skipping`);
    return null;
  }

  const range = extractDateRange(cardHtml);
  if (!range) {
    console.warn(`[texasGlobal] Event ${slug} missing start time — skipping`);
    return null;
  }
  const startMs = new Date(range.start).getTime();
  if (isNaN(startMs)) return null;
  // Multi-day ranges (e.g. a museum exhibit running for months) should stay
  // visible for as long as they're running, not just until their start date.
  const endMs = range.end ? new Date(range.end).getTime() : startMs;
  if (endMs < now) return null;

  const imgMatch = cardHtml.match(/<img\b[^>]*\bsrc="([^"]+)"/);
  const upgradedSrc = imgMatch ? upgradeImageUrl(imgMatch[1]) : null;
  const imageUrl = upgradedSrc
    ? upgradedSrc.startsWith('http')
      ? upgradedSrc
      : `${BASE_URL}${upgradedSrc}`
    : null;

  const locationMatch = cardHtml.match(
    /<div class="location">[\s\S]*?<a class="title" href="([^"]+)">([^<]*)<\/a>/,
  );
  const locationHref = locationMatch?.[1] ?? null;
  const locationName = locationMatch ? decodeHtmlEntities(locationMatch[2]).trim() || null : null;
  const isVirtual = locationHref !== null && isMeetingLink(locationHref);

  const categories = extractCategories(cardHtml);
  const unitCategory = categories.find((c) => c.href.includes('unit='));

  return {
    source: SOURCE,
    sourceEventId: `${slug}::${range.start}`,
    title,
    description: null, // filled in by the orchestrator from the detail page
    startDatetime: range.start,
    endDatetime: range.end,
    locationShort: locationName ? locationName.slice(0, 40) : null,
    locationFull: locationName,
    latitude: null,
    longitude: null,
    organization: {
      // Departments have no numeric id, so ingest skips the org row.
      sourceOrgId: null,
      name: unitCategory?.name ?? DEFAULT_ORG_NAME,
      profilePicture: null,
    },
    eventUrl,
    rsvpUrl: isVirtual ? locationHref : null,
    imageUrl,
    // fetchImageMeta() fills these in later when imageUrl is set.
    imageWidth: null,
    imageHeight: null,
    imageAspectRatio: imageUrl ? 'horizontal' : 'none',
    imageMimeType: null,
    imageAltText: null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: categories.map((c) => ({ id: categoryIdFromHref(c.href), name: c.name })),
    benefits: [],
  };
}

const DESCRIPTION_RE = /<meta name="description" content="([^"]*)"/;

export function extractDescription(detailHtml: string): string | null {
  const match = normalizeHtml(detailHtml).match(DESCRIPTION_RE);
  if (!match) return null;
  const cleaned = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

export async function discoverEventCards(): Promise<string[]> {
  const cards: string[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchWithRetry(`${LISTING_URL}?page=${page}`, { headers: { Accept: '*/*' } });
    const html = await res.text();
    cards.push(...extractEventCards(html));
    if (!hasNextPage(html)) break;
    await sleep(REQUEST_DELAY_MS);
  }

  return cards;
}

export async function scrapeTexasGlobal(
  db: D1Database,
  options: { maxEvents?: number; dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsProcessed = 0;
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let cards: string[];
  try {
    cards = await discoverEventCards();
  } catch (err) {
    const msg = `Fatal error discovering event listing: ${err}`;
    console.error(`[texasGlobal] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  console.log(`[texasGlobal] Discovered ${cards.length} event cards`);

  const now = Date.now();
  const normalized: NormalizedEvent[] = [];
  // Recurring events repeat the same URL across many cards; only fetch
  // each detail page once.
  const descriptionCache = new Map<string, string | null>();

  for (const cardHtml of cards.slice(0, maxEvents)) {
    eventsProcessed++;
    try {
      const parsed = parseEventCard(cardHtml, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (!descriptionCache.has(parsed.eventUrl)) {
        try {
          const res = await fetchWithRetry(parsed.eventUrl, { headers: { Accept: '*/*' } });
          const detailHtml = await res.text();
          descriptionCache.set(parsed.eventUrl, extractDescription(detailHtml));
        } catch (err) {
          console.warn(`[texasGlobal] Failed to fetch detail page ${parsed.eventUrl}: ${err}`);
          descriptionCache.set(parsed.eventUrl, null);
        }
        await sleep(REQUEST_DELAY_MS);
      }
      parsed.description = descriptionCache.get(parsed.eventUrl) ?? null;

      if (parsed.imageUrl) {
        const meta = await fetchImageMeta(parsed.imageUrl, 'texasGlobal');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = meta.mimeType;
        if (meta.width && meta.height) {
          parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
        }
      }

      if (dryRun) {
        console.log(
          `[DRY RUN] "${parsed.title}" (${parsed.sourceEventId}) — ${parsed.organization.name}`,
        );
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process card: ${err}`;
      console.error(`[texasGlobal] ${msg}`);
      errors.push(msg);
    }
  }

  if (!dryRun && normalized.length > 0) {
    const result = await ingestEvents(db, normalized);
    eventsUpserted = result.inserted + result.updated;
    errors.push(...result.errors);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[texasGlobal] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[texasGlobal] Scraper started');
  await scrapeTexasGlobal(env.DB);
}
