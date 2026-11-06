// School of Nursing scraper: nursing.utexas.edu/events (Drupal 11, UT Drupal Kit).
//
// The /events page is a FullCalendar month
// grid, and Drupal ships the grid's ENTIRE event list inline, as a JSON string
// inside the `drupalSettings` script:
//
//   drupalSettings.fullCalendarView[0].calendar_options  (a JSON string)
//     .events[] -> { title, url, start, end, allDay, des, eid, id, ... }
//
// That list is not windowed to the month on screen: it holds every event the
// site has ever published (about 1,600 back to 2019), recurring series already
// expanded into one entry per occurrence. One request therefore covers the
// whole listing, with no pagination, and we keep only what hasn't ended yet.
//
// The calendar supplies identity and timing: title, event page URL, start/end
// and the all-day flag. Everything else lives on each event's own page, which
// is fetched once per URL (a recurring series is one page shared by all of its
// occurrences):
//   - description: the Event node in the page's JSON-LD, falling back to
//     og:description for the few pages that have no JSON-LD.
//   - location: the "Location" field. Not every event has one.
//   - categories: the "Event tags" field.
//   - registration link: the first button inside the event body.
//   - image: a picture embedded in the body, when the editor added one.
//
// Things we can't get:
//   - organizer: events carry no host, so every one is attributed to the School
//     of Nursing itself.
//   - coordinates: locations are room names ("NUR 5.178", "Zoom Meeting"), not
//     addresses, so latitude/longitude stay null.
//   - a banner image for most events: only about one in seven pages has a
//     picture, and the site sets no og:image to fall back on.
//
// Times: the calendar's start/end are wall-clock America/Chicago with no
// offset, so the DST-aware offset is attached per date. For all-day events
// FullCalendar's `end` is EXCLUSIVE (a one-day event ends the next midnight;
// the 29 one-day all-day events in the history all span exactly 1 day), so the
// last day is `end` minus one.
//
// Dedup key: `<entity id>-<YYYY-MM-DD>`. The calendar's own `eid` ends in the
// occurrence's position in its series (`2473-D-3`, `1389-R-5-I-2`), but that
// position shifts if an editor deletes an earlier date, which would re-point
// every later row at the wrong occurrence. The entity id is constant for the
// series, and the date pins the occurrence; moving an occurrence to another
// time on the same day updates it in place.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta, truncateLocation } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import { chicagoOffset, decodeHtmlEntities, htmlToText, inferVenueType } from './helpers';

const SITE_BASE = 'https://nursing.utexas.edu';
const LISTING_URL = `${SITE_BASE}/events`;
export const SOURCE = 'nursing';

const DEFAULT_ORG_NAME = 'School of Nursing';
// One detail page is fetched per distinct event URL, so pace them.
const REQUEST_DELAY_MS = 200;

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// One occurrence in the calendar's embedded list. Only the fields we read.
export interface CalendarEvent {
  // "<span class=\"visually-hidden\">October 21:</span> CPDS: HRSA Grants Presentation"
  title: string;
  // Site-relative: "/events/cpds-hrsa-grants-presentation"
  url: string;
  // "2026-10-21T12:00:00" (timed) or "2026-12-07" (all-day), America/Chicago.
  start: string;
  end: string;
  allDay: boolean;
  // "2473-D-3" or "1389-R-5-I-2": entity id first, occurrence position last.
  eid: string;
}

interface EventImage {
  url: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}

// What an event's own page adds. Shared by every occurrence of a series.
export interface EventDetail {
  description: string | null;
  location: string | null;
  tags: { id: string; name: string }[];
  rsvpUrl: string | null;
  image: EventImage | null;
}

// Calendar

// Pulls the event list out of the listing page. Throws when the structure is
// not there: that means the site changed, and "0 events" would hide it.
export function extractCalendarEvents(html: string): CalendarEvent[] {
  const settings = html.match(
    /<script[^>]*data-drupal-selector="drupal-settings-json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!settings) throw new Error('drupalSettings script not found on the events page');

  const options = JSON.parse(settings[1]).fullCalendarView?.[0]?.calendar_options;
  // Drupal double-encodes this: calendar_options is itself a JSON string.
  const events = typeof options === 'string' ? JSON.parse(options).events : null;
  if (!Array.isArray(events)) throw new Error('fullCalendarView events not found');
  return events as CalendarEvent[];
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Timed: "2026-10-21T12:00:00" -> "2026-10-21T12:00:00-05:00".
function withChicagoOffset(local: string): string {
  return `${local.slice(0, 19)}${chicagoOffset(local.slice(0, 10))}`;
}

// Start, end and the instant the event is over. An all-day event is measured
// to the end of its last day in Chicago, not UTC midnight (a bare date parses
// as UTC midnight, the evening before in Chicago).
//
// Returns null for an entry whose dates can't be read. The Date/Intl calls
// below THROW (RangeError) on an impossible date such as "2026-13-45" instead
// of returning NaN, and this runs while filtering the whole list, outside the
// per-event try/catch, so one bad entry must not be able to abort the run.
export function resolveTiming(
  ev: CalendarEvent,
): { startDatetime: string; endDatetime: string | null; endMs: number } | null {
  try {
    return computeTiming(ev);
  } catch {
    return null;
  }
}

function computeTiming(
  ev: CalendarEvent,
): { startDatetime: string; endDatetime: string | null; endMs: number } | null {
  if (!ev.start || !ev.end) return null;

  if (ev.allDay) {
    const startDate = ev.start.slice(0, 10);
    const lastDate = addDays(ev.end.slice(0, 10), -1);
    const endDate = lastDate > startDate ? lastDate : null;
    const endMs = new Date(
      `${endDate ?? startDate}T23:59:59${chicagoOffset(endDate ?? startDate)}`,
    ).getTime();
    return isNaN(endMs) ? null : { startDatetime: startDate, endDatetime: endDate, endMs };
  }

  const startDatetime = withChicagoOffset(ev.start);
  const endDatetime = withChicagoOffset(ev.end);
  const startMs = new Date(startDatetime).getTime();
  const endMs = new Date(endDatetime).getTime();
  if (isNaN(startMs) || isNaN(endMs)) return null;
  // An end before the start would be a data-entry slip (none in the history);
  // keep the start and drop the end rather than store an inverted range.
  if (endMs < startMs) return { startDatetime, endDatetime: null, endMs: startMs };
  return { startDatetime, endDatetime, endMs };
}

// The calendar prefixes every title with a visually-hidden "October 21:" for
// screen readers. It is not part of the title.
export function cleanTitle(raw: string): string {
  return htmlToText(raw.replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ''));
}

// Detail page

// The slice of the page for one Drupal field: from its wrapper class to the
// next field. Matching inside a slice (not the whole page) keeps the tag links
// and the "Give" button from the site chrome from being mistaken for content.
function fieldBlock(html: string, fieldClass: string): string | null {
  const start = html.indexOf(`field--name-${fieldClass}`);
  if (start < 0) return null;
  const next = html.indexOf('class="field field--name-', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

// Find the tag first, then read its attribute: attribute order differs
// between Drupal templates and after a formatter has touched a saved fixture.
function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeHtmlEntities(match[1]) : null;
}

function metaContent(html: string, property: string): string | null {
  const tag = html.match(new RegExp(`<meta\\s[^>]*property="${property}"[^>]*>`));
  return tag ? attr(tag[0], 'content') : null;
}

function jsonLdDescription(html: string): string | null {
  for (const m of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const data = JSON.parse(m[1]);
      const nodes: { '@type'?: string; description?: string }[] = data['@graph'] ?? [data];
      const event = nodes.find((n) => n['@type'] === 'Event');
      if (event?.description) return event.description;
    } catch {
      // Malformed JSON-LD: fall through to og:description.
    }
  }
  return null;
}

function toNumberOrNull(value: string | null): number | null {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// Pure and sync so it's easy to test against saved HTML fixtures. Every field
// is optional on this site, so an empty page yields an all-null detail rather
// than failing: the calendar already gave us a valid event.
export function parseDetailPage(html: string): EventDetail {
  // JSON-LD descriptions arrive with "\r\n" and doubled spaces from the editor.
  const description = (jsonLdDescription(html) ?? metaContent(html, 'og:description'))
    ?.replace(/\s+/g, ' ')
    .trim();

  const locationBlock = fieldBlock(html, 'field-utevent-location');
  const location =
    locationBlock?.match(/utevent-event-field__item">([\s\S]*?)<\/div>/)?.[1] ?? null;

  const tagBlock = fieldBlock(html, 'field-utevent-tags') ?? '';
  const tags = [...tagBlock.matchAll(/href="\/events\?type=(\d+)">([^<]+)<\/a>/g)].map((m) => ({
    id: `event-type-${m[1]}`,
    name: decodeHtmlEntities(m[2]).trim(),
  }));

  // The editors' call-to-action is a `ut-btn` link inside the event body (a
  // Zoom join link, a signup form, a livestream). Scoped to the body because
  // every page also carries a site-wide "Give" button with the same class.
  // The sidebar ("Event Details") starts where the body ends.
  const body = fieldBlock(html, 'field-utevent-body')?.split('utevent-event__content-secondary')[0];
  const button = body?.match(/<a\s[^>]*class="[^"]*\but-btn\b[^"]*"[^>]*>/)?.[0];

  const imageBlock = fieldBlock(html, 'field-utexas-media-image');
  const img = imageBlock?.match(/<img\s[^>]*>/)?.[0];
  const imgSrc = img ? attr(img, 'src') : null;

  return {
    description: description || null,
    location: location ? htmlToText(location) || null : null,
    tags,
    rsvpUrl: button ? attr(button, 'href') : null,
    image: imgSrc
      ? {
          url: new URL(imgSrc, SITE_BASE).toString(),
          width: toNumberOrNull(attr(img!, 'width')),
          height: toNumberOrNull(attr(img!, 'height')),
          // Editors who skip the alt text leave `alt="&quot;&quot;"`, i.e. the
          // literal two-character string "" rather than an empty attribute.
          altText: attr(img!, 'alt')?.replace(/"/g, '').trim() || null,
        }
      : null,
  };
}

// Normalize

// Pure and sync so it's easy to test. Returns null for an event that is over
// or whose calendar entry can't be read. Image dimensions the page didn't give
// are filled in by the orchestrator (needs a network round-trip).
export function parseCalendarEvent(
  ev: CalendarEvent,
  detail: EventDetail,
  now = Date.now(),
): NormalizedEvent | null {
  const timing = resolveTiming(ev);
  const entityId = ev.eid?.match(/^(\d+)-/)?.[1];
  if (!timing || !entityId || !ev.url) {
    console.warn(`[nursing] Unreadable calendar entry ${ev.eid} "${ev.start}" — skipping`);
    return null;
  }
  if (timing.endMs < now) return null;

  const { image, location } = detail;

  return {
    source: SOURCE,
    sourceEventId: `${entityId}-${ev.start.slice(0, 10)}`,
    title: cleanTitle(ev.title),
    description: detail.description,
    startDatetime: timing.startDatetime,
    endDatetime: timing.endDatetime,
    venueType: inferVenueType(location, null),
    locationShort: truncateLocation(location),
    locationFull: location,
    latitude: null,
    longitude: null,
    organization: {
      // No per-event host anywhere on the site; see the header.
      sourceOrgId: null,
      name: DEFAULT_ORG_NAME,
      profilePicture: null,
    },
    eventUrl: new URL(ev.url, SITE_BASE).toString(),
    rsvpUrl: detail.rsvpUrl,
    imageUrl: image?.url ?? null,
    // fetchImageMeta() fills these in later when the page gave no size.
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    imageAspectRatio: image ? classifyAspectRatio(image.width, image.height, true, 0.05) : 'none',
    imageMimeType: null,
    imageAltText: image?.altText ?? null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: detail.tags,
    benefits: [],
  };
}

// Fetch

async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const res = await fetchWithRetry(LISTING_URL, { headers: { Accept: 'text/html' } });
  return extractCalendarEvents(await res.text());
}

async function fetchEventDetail(url: string): Promise<EventDetail> {
  const res = await fetchWithRetry(new URL(url, SITE_BASE).toString(), {
    headers: { Accept: 'text/html' },
  });
  return parseDetailPage(await res.text());
}

export async function scrapeNursing(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let calendar: CalendarEvent[];
  try {
    calendar = await fetchCalendarEvents();
  } catch (err) {
    const msg = `Fatal error fetching events: ${err}`;
    console.error(`[nursing] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  const now = Date.now();
  // The list includes ~1,500 past occurrences. Drop them BEFORE the detail
  // fetches so we only request pages for events that can still be shown.
  const upcoming = calendar.filter((ev) => {
    const timing = resolveTiming(ev);
    if (!timing) {
      console.warn(`[nursing] Unreadable calendar entry ${ev.eid} "${ev.start}" — skipping`);
      eventsSkipped++;
      return false;
    }
    return timing.endMs >= now;
  });
  console.log(`[nursing] Fetched ${calendar.length} calendar entries, ${upcoming.length} upcoming`);

  // One request per distinct page: a series' occurrences share it. A failed
  // fetch is remembered (as null) so the series is skipped once, not retried
  // for every occurrence.
  const details = new Map<string, EventDetail | null>();
  const normalized: NormalizedEvent[] = [];

  for (const ev of upcoming) {
    try {
      let detail = details.get(ev.url);
      if (detail === undefined) {
        if (details.size > 0) await sleep(REQUEST_DELAY_MS);
        try {
          detail = await fetchEventDetail(ev.url);
        } catch (err) {
          // Skip rather than ingest without the description: the upsert would
          // overwrite a good row from an earlier run with nulls. The next cron
          // run retries.
          detail = null;
          errors.push(`Failed to fetch ${ev.url}: ${err}`);
          console.error(`[nursing] Failed to fetch ${ev.url}: ${err}`);
        }
        details.set(ev.url, detail);
      }
      if (!detail) {
        eventsSkipped++;
        continue;
      }

      const parsed = parseCalendarEvent(ev, detail, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl && (!parsed.imageWidth || !parsed.imageHeight)) {
        const meta = await fetchImageMeta(parsed.imageUrl, 'nursing');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = parsed.imageMimeType ?? meta.mimeType;
        parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
      }

      if (dryRun) {
        console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process event ${ev.eid}: ${err}`;
      console.error(`[nursing] ${msg}`);
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
    `[nursing] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed: upcoming.length, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[nursing] Scraper started');
  await scrapeNursing(env);
}
