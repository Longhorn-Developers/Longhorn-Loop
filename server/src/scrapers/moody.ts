// Moody College of Communication scraper: events.moody.utexas.edu (Drupal).
//
// The paginated listing identifies each upcoming occurrence. Detail pages add
// Schema.org event data for descriptions, end times, locations, and images.
// Moody does not render an event's host taxonomy on either page, so events use
// the college itself as their host organization.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import { inferVenueType } from './helpers';

const BASE_URL = 'https://events.moody.utexas.edu';
const LISTING_URL = `${BASE_URL}/upcoming-events`;
export const SOURCE = 'moody';

const DEFAULT_ORG_NAME = 'Moody College of Communication';
const DEFAULT_MAX_EVENTS = 500;
const MAX_PAGES = 50;
const REQUEST_DELAY_MS = 200;

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

export interface MoodyListingEvent {
  // Drupal reuses one node URL for every occurrence of a recurring event.
  // `startDatetime` must therefore be part of the eventual dedupe key.
  slug: string;
  title: string;
  description: string | null;
  startDatetime: string;
  eventUrl: string;
  imageUrl: string | null;
  categories: string[];
}

interface SchemaImage {
  url?: string;
  width?: string | number;
  height?: string | number;
}

interface SchemaPlace {
  name?: string;
  address?: string | Record<string, string>;
}

interface SchemaEvent {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  image?: string | SchemaImage;
  location?: string | SchemaPlace;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function textContent(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, ' ')
    .replace(/\s+>/g, '>')
    .replace(/<\s+/g, '<')
    .replace(/> </g, '><');
}

// Each Drupal Views result starts with views-row, but the nested card has no
// convenient unique closing tag. Splitting on the next row marker tolerates
// optional card fields and changes in nesting depth.
export function extractEventCards(html: string): string[] {
  return normalizeHtml(html)
    .split('<div class="views-row">')
    .slice(1)
    .filter((chunk) => chunk.includes('moody-custom-event-card'));
}

export function hasNextPage(html: string): boolean {
  return /rel="next"/.test(html);
}

function chicagoOffset(date: string): string {
  // Listing dates have no offset. Resolve it for the event date rather than
  // assuming CST or CDT, since one scrape can span a DST boundary.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const match = parts.find((part) => part.type === 'timeZoneName')?.value.match(/GMT([+-]\d+)/);
  const hours = match ? Number(match[1]) : -6;
  return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

// "March 24th, 2026 - 10:00 am" -> a DST-aware ISO datetime.
export function parseListingDatetime(value: string): string | null {
  const match = value
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th),\s+(\d{4})\s+-\s+(\d{1,2}):(\d{2})\s*([ap]m)/i);
  if (!match) return null;

  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  let hour = Number(match[4]) % 12;
  if (match[6].toLowerCase() === 'pm') hour += 12;
  const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return `${date}T${String(hour).padStart(2, '0')}:${match[5]}:00${chicagoOffset(date)}`;
}

function absoluteUrl(path: string): string {
  return path.startsWith('http') ? path : `${BASE_URL}${path}`;
}

export function parseListingCard(cardHtml: string): MoodyListingEvent | null {
  const card = normalizeHtml(cardHtml);
  const titleMatch = card.match(/<h3 class="event-title"><a href="([^"]+)">([\s\S]*?)<\/a><\/h3>/);
  if (!titleMatch) return null;

  const eventUrl = absoluteUrl(decodeHtmlEntities(titleMatch[1]));
  const slugMatch = new URL(eventUrl).pathname.match(/^\/events\/([^/]+)\/?$/);
  if (!slugMatch) return null;

  const dateMatch = card.match(/<div class="card-subtitle">([\s\S]*?)<\/div>/);
  const startDatetime = dateMatch ? parseListingDatetime(textContent(dateMatch[1])) : null;
  if (!startDatetime) return null;

  const descriptionMatch = card.match(/<p class="card-text">([\s\S]*?)<\/p>/);
  const imageMatch = card.match(/<img\b[^>]*\bsrc="([^"]+)"/);
  const categoryMatch = card.match(/<h5 class="card-title">([\s\S]*?)<\/h5>/);
  const category = categoryMatch ? textContent(categoryMatch[1]) : '';

  return {
    slug: slugMatch[1],
    title: textContent(titleMatch[2]),
    description: descriptionMatch ? textContent(descriptionMatch[1]) || null : null,
    startDatetime,
    eventUrl,
    imageUrl: imageMatch ? absoluteUrl(decodeHtmlEntities(imageMatch[1])) : null,
    categories: category ? [category] : [],
  };
}

// A page can contain unrelated JSON-LD blocks. Scan until an Event node is
// found and ignore malformed or non-event blocks.
export function extractSchemaEvent(html: string): SchemaEvent | null {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const script of scripts) {
    try {
      const json = JSON.parse(script[1]) as SchemaEvent & { '@graph'?: SchemaEvent[] };
      const candidates: SchemaEvent[] = Array.isArray(json['@graph']) ? json['@graph'] : [json];
      const event = candidates.find((item) => {
        const type = item['@type'];
        return type === 'Event' || (Array.isArray(type) && type.includes('Event'));
      });
      if (event) return event;
    } catch {
      // Other JSON-LD blocks should not prevent parsing the event block.
    }
  }
  return null;
}

function extractLabeledValue(html: string, label: string): string | null {
  const match = html.match(new RegExp(`<strong>${label}:<\\/strong>([\\s\\S]*?)<\\/p>`, 'i'));
  if (!match) return null;
  return textContent(match[1]) || null;
}

export function extractCategories(detailHtml: string): string[] {
  const match = detailHtml.match(/<strong>Event Categories:<\/strong>([\s\S]*?)<\/p>/i);
  if (!match) return [];
  // Moody renders taxonomy values as separate text lines without commas or
  // wrapping elements. Preserve those lines or distinct names merge together.
  return match[1]
    .split(/\r?\n/)
    .map((line) => textContent(line))
    .filter(Boolean);
}

function categoryId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function schemaLocation(location: SchemaEvent['location']): string | null {
  if (typeof location === 'string') return location.trim() || null;
  if (!location) return null;
  if (typeof location.address === 'string') {
    return [location.name, location.address].filter(Boolean).join(', ') || null;
  }
  const address = location.address
    ? [
        location.address.streetAddress,
        location.address.addressLocality,
        location.address.addressRegion,
        location.address.postalCode,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  return [location.name, address].filter(Boolean).join(', ') || null;
}

function inferMimeType(url: string | null): string | null {
  if (!url) return null;
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

export function parseMoodyEvent(
  listing: MoodyListingEvent,
  detailHtml: string,
  now = Date.now(),
): NormalizedEvent | null {
  const schema = extractSchemaEvent(detailHtml);
  let endDatetime: string | null = null;
  if (schema?.startDate && schema.endDate) {
    // Recurring nodes describe their first occurrence in JSON-LD even when the
    // listing points to a later one. Reuse the duration, not the stale start.
    const duration = new Date(schema.endDate).getTime() - new Date(schema.startDate).getTime();
    if (Number.isFinite(duration) && duration >= 0) {
      endDatetime =
        new Date(schema.startDate).getTime() === new Date(listing.startDatetime).getTime()
          ? schema.endDate
          : new Date(new Date(listing.startDatetime).getTime() + duration).toISOString();
    }
  }

  const endMs = endDatetime
    ? new Date(endDatetime).getTime()
    : new Date(listing.startDatetime).getTime();
  if (!Number.isFinite(endMs) || endMs < now) return null;

  const schemaImage = typeof schema?.image === 'string' ? { url: schema.image } : schema?.image;
  const imageUrl = schemaImage?.url ? absoluteUrl(schemaImage.url) : listing.imageUrl;
  const imageWidth = schemaImage?.width ? Number(schemaImage.width) : null;
  const imageHeight = schemaImage?.height ? Number(schemaImage.height) : null;
  const categories = extractCategories(detailHtml);
  const location = extractLabeledValue(detailHtml, 'Location') ?? schemaLocation(schema?.location);
  const imageAltMatch = detailHtml.match(
    /<div class="event-image-wrapper">[\s\S]*?<img\b[^>]*\balt="([^"]*)"/,
  );
  const websiteMatch = detailHtml.match(/<strong>Website:<\/strong>[\s\S]*?<a href="([^"]+)"/i);

  return {
    source: SOURCE,
    // Slugs repeat across occurrences; slug + start is stable across reruns.
    sourceEventId: `${listing.slug}::${listing.startDatetime}`,
    title: schema?.name?.trim() || listing.title,
    description: schema?.description?.trim() || listing.description,
    startDatetime: listing.startDatetime,
    endDatetime,
    venueType: inferVenueType(location, null),
    locationShort: location ? location.slice(0, 40) : null,
    locationFull: location,
    latitude: null,
    longitude: null,
    organization: { sourceOrgId: null, name: DEFAULT_ORG_NAME, profilePicture: null },
    eventUrl: listing.eventUrl,
    rsvpUrl: websiteMatch ? absoluteUrl(decodeHtmlEntities(websiteMatch[1])) : null,
    imageUrl,
    imageWidth: Number.isFinite(imageWidth) ? imageWidth : null,
    imageHeight: Number.isFinite(imageHeight) ? imageHeight : null,
    imageAspectRatio: classifyAspectRatio(imageWidth, imageHeight, Boolean(imageUrl), 0.05),
    imageMimeType: inferMimeType(imageUrl),
    imageAltText: imageAltMatch ? decodeHtmlEntities(imageAltMatch[1]).trim() || null : null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: (categories.length > 0 ? categories : listing.categories).map((name) => ({
      id: categoryId(name),
      name,
    })),
    benefits: [],
  };
}

// The cap guards against a malformed pager producing an infinite Worker run.
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

export async function scrapeMoody(
  env: Env,
  options: { maxEvents?: number; dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const t0 = Date.now();
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const dryRun = options.dryRun ?? false;
  const errors: string[] = [];
  let eventsSkipped = 0;
  let eventsUpserted = 0;

  let cards: string[];
  try {
    cards = await discoverEventCards();
  } catch (err) {
    const msg = `Fatal error discovering event listing: ${err}`;
    console.error(`[moody] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  const normalized: NormalizedEvent[] = [];
  const selectedCards = cards.slice(0, maxEvents);
  for (const cardHtml of selectedCards) {
    try {
      const listing = parseListingCard(cardHtml);
      if (!listing) {
        eventsSkipped++;
        continue;
      }

      let detailHtml = '';
      try {
        const res = await fetchWithRetry(listing.eventUrl, { headers: { Accept: '*/*' } });
        detailHtml = await res.text();
      } catch (err) {
        // The listing still provides enough data for a useful partial record,
        // so one failed detail request must not drop the event.
        console.warn(`[moody] Failed to fetch detail page ${listing.eventUrl}: ${err}`);
      }

      const parsed = parseMoodyEvent(listing, detailHtml);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl && (!parsed.imageWidth || !parsed.imageHeight)) {
        // JSON-LD usually provides dimensions. Only range-read the image when
        // that metadata is absent.
        const meta = await fetchImageMeta(parsed.imageUrl, 'moody');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = meta.mimeType;
        parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
      }

      if (dryRun) console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      else normalized.push(parsed);
    } catch (err) {
      const msg = `Failed to process event card: ${err}`;
      console.error(`[moody] ${msg}`);
      errors.push(msg);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  if (!dryRun && normalized.length > 0) {
    const result = await ingestEvents(env, normalized);
    eventsUpserted = result.inserted + result.updated;
    errors.push(...result.errors);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[moody] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );
  return {
    eventsProcessed: selectedCards.length,
    eventsUpserted,
    eventsSkipped,
    errors,
    durationMs,
  };
}

export async function run(env: Env): Promise<void> {
  console.log('[moody] Scraper started');
  await scrapeMoody(env);
}
