// Cockrell School of Engineering scraper: cockrell.utexas.edu/events (WordPress).
//
// The site exposes a custom "event" post type through the standard WP REST
// API at /wp-json/wp/v2/event, with structured meta fields (date, time,
// location, image) and — via _embed — the category/type taxonomy terms.
// No HTML scraping needed at all.
//
// Things we can't get:
//   - rsvpUrl / ticket links only appear inside the rendered content HTML,
//     not as a structured field on the list endpoint — not worth parsing.
//   - The API returns date/time as plain strings with no UTC offset, so we
//     compute the America/Chicago offset ourselves (DST-aware, via Intl)
//     rather than hardcoding a fixed -05:00/-06:00.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta, stripHtml } from '../events/normalize';
import { fetchWithRetry } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';

const API_BASE = 'https://cockrell.utexas.edu/wp-json/wp/v2/event';
export const SOURCE = 'cockrell';

const PER_PAGE = 100;
const DEFAULT_ORG_NAME = 'Cockrell School of Engineering';

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

interface WpTerm {
  id: number;
  taxonomy: string;
  name: string;
}

interface WpImage {
  id: number;
  url: string;
  alt: string;
}

interface WpEventMeta {
  cockrell_event_date: string;
  cockrell_event_end_date: string;
  cockrell_event_start_time: string;
  cockrell_event_end_time: string;
  cockrell_event_location: string;
  cockrell_event_image: WpImage | false;
}

export interface WpEvent {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  meta: WpEventMeta;
  _embedded?: {
    'wp:term'?: WpTerm[][];
  };
}

// Helpers, exported for unit tests

// WP's ".rendered" fields keep entities un-decoded, including numeric ones
// (WP commonly emits &#8211; for en-dashes in titles). Decode numeric refs
// generically instead of hardcoding each one.
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// The API gives no UTC offset, so we look up the real America/Chicago
// offset for the given date (DST-aware) instead of guessing.
export function chicagoOffset(dateStr: string): string {
  const date = new Date(`${dateStr}T12:00:00Z`); // noon UTC stays the same calendar day in Chicago
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-6';
  const match = tzName.match(/GMT([+-]\d+)/);
  const hours = match ? parseInt(match[1], 10) : -6;
  const sign = hours >= 0 ? '+' : '-';
  return `${sign}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

// "9:00 am" / "5:00 pm" / "12:00 am" -> {hours: 0-23, minutes}
export function parseTime12h(time: string): { hours: number; minutes: number } | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10) % 12;
  if (match[3].toLowerCase() === 'pm') hours += 12;
  return { hours, minutes: parseInt(match[2], 10) };
}

// Combines a plain date with an optional 12h time string into an ISO
// datetime. No time -> date-only string (all-day), matching the
// convention used by other scrapers for all-day/multi-day events.
export function buildDatetime(dateStr: string, timeStr: string): string {
  const time = timeStr ? parseTime12h(timeStr) : null;
  if (!time) return dateStr;
  const hh = String(time.hours).padStart(2, '0');
  const mm = String(time.minutes).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00${chicagoOffset(dateStr)}`;
}

// Pure and sync so it's easy to test against saved API response fixtures.
// Image dimensions are filled in by the orchestrator (needs a network
// round-trip), same as McCombs.
export function parseWpEvent(ev: WpEvent, now = Date.now()): NormalizedEvent | null {
  const meta = ev.meta;
  if (!meta?.cockrell_event_date) {
    console.warn(`[cockrell] Event ${ev.id} missing start date — skipping`);
    return null;
  }

  const startDatetime = buildDatetime(meta.cockrell_event_date, meta.cockrell_event_start_time);
  let endDatetime: string | null;
  if (meta.cockrell_event_end_date) {
    endDatetime = buildDatetime(meta.cockrell_event_end_date, meta.cockrell_event_end_time);
  } else if (meta.cockrell_event_end_time) {
    endDatetime = buildDatetime(meta.cockrell_event_date, meta.cockrell_event_end_time);
  } else {
    endDatetime = null;
  }

  const startMs = new Date(startDatetime).getTime();
  if (isNaN(startMs)) return null;
  // Multi-day ranges should stay visible for as long as they're running,
  // not just until their start date.
  const endMs = endDatetime ? new Date(endDatetime).getTime() : startMs;
  if (endMs < now) return null;

  const image = meta.cockrell_event_image || null;
  const terms = (ev._embedded?.['wp:term'] ?? []).flat();
  // stripHtml() drops tags with nothing in their place, so a literal <br>
  // between address lines would otherwise glue them together.
  const location = stripHtml(meta.cockrell_event_location.replace(/<br\s*\/?>/gi, ' '));

  return {
    source: SOURCE,
    sourceEventId: String(ev.id),
    title: decodeHtmlEntities(ev.title.rendered).trim(),
    description: stripHtml(decodeHtmlEntities(ev.excerpt.rendered)),
    startDatetime,
    endDatetime,
    locationShort: location?.slice(0, 40) ?? null,
    locationFull: location,
    latitude: null,
    longitude: null,
    organization: {
      // Every event belongs to the same school; there's no department-level
      // organizer concept in this feed.
      sourceOrgId: null,
      name: DEFAULT_ORG_NAME,
      profilePicture: null,
    },
    eventUrl: ev.link,
    rsvpUrl: null,
    imageUrl: image ? image.url : null,
    // fetchImageMeta() fills these in later when imageUrl is set.
    imageWidth: null,
    imageHeight: null,
    imageAspectRatio: image ? 'horizontal' : 'none',
    imageMimeType: null,
    imageAltText: image ? decodeHtmlEntities(image.alt).trim() || null : null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: terms.map((t) => ({ id: `${t.taxonomy}-${t.id}`, name: t.name })),
    benefits: [],
  };
}

export async function fetchAllEvents(): Promise<WpEvent[]> {
  const events: WpEvent[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetchWithRetry(`${API_BASE}?per_page=${PER_PAGE}&page=${page}&_embed=1`, {
      headers: { Accept: 'application/json' },
    });
    const totalPagesHeader = res.headers.get('X-WP-TotalPages');
    if (totalPagesHeader) totalPages = parseInt(totalPagesHeader, 10) || 1;
    events.push(...((await res.json()) as WpEvent[]));
    page++;
  } while (page <= totalPages);

  return events;
}

export async function scrapeCockrell(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let wpEvents: WpEvent[];
  try {
    wpEvents = await fetchAllEvents();
  } catch (err) {
    const msg = `Fatal error fetching events: ${err}`;
    console.error(`[cockrell] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  console.log(`[cockrell] Fetched ${wpEvents.length} events`);

  const now = Date.now();
  const normalized: NormalizedEvent[] = [];

  for (const ev of wpEvents) {
    try {
      const parsed = parseWpEvent(ev, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl) {
        const meta = await fetchImageMeta(parsed.imageUrl, 'cockrell');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = meta.mimeType;
        if (meta.width && meta.height) {
          parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
        }
      }

      if (dryRun) {
        console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process event ${ev.id}: ${err}`;
      console.error(`[cockrell] ${msg}`);
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
    `[cockrell] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed: wpEvents.length, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[cockrell] Scraper started');
  await scrapeCockrell(env);
}
