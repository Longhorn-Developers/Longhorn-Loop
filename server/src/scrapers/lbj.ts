// LBJ School of Public Affairs scraper: lbj.utexas.edu (Drupal 11, UT Drupal Kit).
//
// Same platform as Nursing, so the calendar mechanics -- one embedded list of
// every occurrence, Chicago wall-clock times, the dedup key -- are shared and
// documented in utDrupalEvents.ts. This file is what LBJ's site does
// differently. It is not a Localist calendar (calendar.utexas.edu), so the
// shared Localist adapter (LOOP-218) does not apply.
//
// WHY /calendar AND NOT /events. /events is the page people browse: a Drupal
// Views list, 10 rows a page, paged with ?page=N (0-based; a page past the end
// is a 200 with no rows). Its dates are display text with the year left off
// for the current year ("Dec. 2, 4 to 6 p.m.", "Jan. 7, 2027, noon to 1 p.m."),
// and its thumbnails are a forced 280x280 crop. /calendar embeds the same
// events as data, with ISO start/end and stable ids, so one request replaces
// the pagination and the date parsing. On 2026-11-20 the two held the same 19
// upcoming occurrences, URL for URL and date for date; test_lbj.ts pins that
// against both pages captured together. /calendar's list also holds ~1,080
// past entries back to 2016, dropped before any page is fetched.
//
// Everything else comes from each event's own page, fetched once per URL (a
// recurring series shares one page):
//   - description: the Event node in the page's JSON-LD, falling back to
//     og:description. The JSON-LD's startDate/endDate are NOT used: on a
//     recurring event they are the series' FIRST occurrence (the Fall 2026
//     EEE seminar says Aug 28 on its Dec 4 page), so times come only from the
//     calendar.
//   - location: the "Location" field, a room or venue as the editor wrote it
//     ("LBJ - SRH 3.122", "Virtual via Zoom"). Some events have none.
//   - host: the "Event tags" are LBJ's own units -- research centers, labs and
//     offices ("Center for the Study of Race and Democracy", "Office of Student
//     Affairs and Admissions (OSAA)") -- plus two catch-alls that say whose
//     calendar an event is on rather than who runs it. The first unit tag is
//     the host; with none, the School itself.
//   - registration link: the "Event URL" field (Eventbrite, a signup page),
//     else the first button in the event body, as on Nursing.
//   - image: og:image, the 480px "large" derivative of the event's main
//     picture. The full-size upload in `field-photo` is the fallback only:
//     it is the original file (one is 8000x4500 and 5 MB) where the derivative
//     is 20-160 KB. The JSON-LD image claims 480x480 for every event whatever
//     its shape, so real dimensions are read from the file (fetchImageMeta).
//
// COORDINATES. The site publishes none, and no street address either: a
// location is a taxonomy term whose page is not public. latitude/longitude are
// therefore null here and ingestEvents fills them from the UT building
// registry, as for Nursing. That only works because of LOOP-275's aliases in
// lib/utBuildings.ts: the School is in Sid Richardson Hall, but "LBJ" is the
// code of the LBJ Library next door, and every School location used to pin
// there. "Virtual via Zoom" is online and skipped; "University of Texas at
// Austin", a few events' whole location, is too vague to place and is logged
// as unresolved.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta, truncateLocation } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import { toExternalHttpUrl } from '../../../shared/externalUrl';
import { inferVenueType } from './helpers';
import {
  attr,
  cleanTitle,
  extractCalendarEvents,
  fieldBlock,
  metaContent,
  occurrenceId,
  parseDescription,
  parseEventTags,
  parseLocationField,
  resolveTiming,
  toNumberOrNull,
  type CalendarEvent,
} from './utDrupalEvents';

const SITE_BASE = 'https://lbj.utexas.edu';
const CALENDAR_URL = `${SITE_BASE}/calendar`;
export const SOURCE = 'lbj';

const DEFAULT_ORG_NAME = 'LBJ School of Public Affairs';
// One detail page is fetched per distinct event URL, so pace them.
const REQUEST_DELAY_MS = 200;

// "LBJ School Events" and "Non-LBJ School Events": which calendar an event is
// on, not who runs it. Every other tag in the site's filter is a unit.
const NON_HOST_TAG_IDS = new Set(['event-type-15', 'event-type-1300']);

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

interface EventImage {
  url: string;
  width: number | null;
  height: number | null;
  mimeType: string | null;
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

// Detail page

// The event's main column: the body, any images embedded in it, and the
// "Event URL" field, up to the "Event Details" sidebar. Not fieldBlock(): that
// stops at the first image embedded in the body, and LBJ's bodies embed
// speaker headshots ahead of their buttons. The footer's "Subscribe to our
// newsletter" button, which has the same class, comes after the sidebar.
function mainColumn(html: string): string | null {
  const start = html.indexOf('field--name-field-utevent-body');
  if (start < 0) return null;
  const end = html.indexOf('utevent-event__content-secondary', start);
  return html.slice(start, end < 0 ? undefined : end);
}

// A link as an absolute web address, or null for one that isn't (mailto:, a
// fragment of prose). Ingest does not validate links (see shared/externalUrl.ts),
// so this is the only check a scraped one gets before a student taps it.
function toWebUrl(href: string | null): string | null {
  if (!href) return null;
  try {
    return toExternalHttpUrl(new URL(href, SITE_BASE).toString());
  } catch {
    return null;
  }
}

function parseRsvpUrl(html: string): string | null {
  const eventUrlLink = fieldBlock(html, 'field-event-url')?.match(/<a\s[^>]*>/)?.[0];
  const button = mainColumn(html)?.match(/<a\s[^>]*class="[^"]*\but-btn\b[^"]*"[^>]*>/)?.[0];
  return (
    toWebUrl(eventUrlLink ? attr(eventUrlLink, 'href') : null) ??
    toWebUrl(button ? attr(button, 'href') : null)
  );
}

function parseImage(html: string): EventImage | null {
  const derivative = metaContent(html, 'og:image');
  if (derivative) {
    return {
      url: new URL(derivative, SITE_BASE).toString(),
      // Filled in by the orchestrator from the file itself; see the header.
      width: null,
      height: null,
      mimeType: null,
      altText: metaContent(html, 'og:image:alt')?.trim() || null,
    };
  }

  const img = fieldBlock(html, 'field-photo')?.match(/<img\s[^>]*>/)?.[0];
  const src = img ? attr(img, 'src') : null;
  if (!img || !src) return null;
  return {
    url: new URL(src, SITE_BASE).toString(),
    width: toNumberOrNull(attr(img, 'width')),
    height: toNumberOrNull(attr(img, 'height')),
    mimeType: null,
    altText: attr(img, 'alt')?.trim() || null,
  };
}

// Pure and sync so it's easy to test against saved HTML fixtures. Every field
// is optional, so a sparse page yields a sparse detail rather than failing:
// the calendar already gave us a valid event.
export function parseDetailPage(html: string): EventDetail {
  return {
    description: parseDescription(html),
    location: parseLocationField(html),
    tags: parseEventTags(html),
    rsvpUrl: parseRsvpUrl(html),
    image: parseImage(html),
  };
}

// The unit that runs the event: the first tag that names one. See the header.
export function hostName(tags: { id: string; name: string }[]): string {
  return tags.find((tag) => !NON_HOST_TAG_IDS.has(tag.id))?.name ?? DEFAULT_ORG_NAME;
}

// Normalize

// Pure and sync so it's easy to test. Returns null for an event that is over
// or whose calendar entry can't be read.
export function parseCalendarEvent(
  ev: CalendarEvent,
  detail: EventDetail,
  now = Date.now(),
): NormalizedEvent | null {
  const timing = resolveTiming(ev);
  const sourceEventId = occurrenceId(ev);
  if (!timing || !sourceEventId || !ev.url) {
    console.warn(`[lbj] Unreadable calendar entry ${ev.eid} "${ev.start}" — skipping`);
    return null;
  }
  if (timing.endMs < now) return null;

  const { image, location } = detail;

  return {
    source: SOURCE,
    sourceEventId,
    title: cleanTitle(ev.title),
    description: detail.description,
    startDatetime: timing.startDatetime,
    endDatetime: timing.endDatetime,
    venueType: inferVenueType(location, null),
    locationShort: truncateLocation(location),
    locationFull: location,
    // Null on purpose; ingestEvents resolves them from the building in
    // locationFull. See "coordinates" in the header.
    latitude: null,
    longitude: null,
    organization: {
      // LBJ's units have no ids in our organizations table, only names.
      sourceOrgId: null,
      name: hostName(detail.tags),
      profilePicture: null,
    },
    eventUrl: new URL(ev.url, SITE_BASE).toString(),
    rsvpUrl: detail.rsvpUrl,
    imageUrl: image?.url ?? null,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    imageAspectRatio: image ? classifyAspectRatio(image.width, image.height, true, 0.05) : 'none',
    imageMimeType: image?.mimeType ?? null,
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
  const res = await fetchWithRetry(CALENDAR_URL, { headers: { Accept: 'text/html' } });
  return extractCalendarEvents(await res.text());
}

// The page, plus the real size of its image. Done here, once per page, rather
// than per occurrence: the Graduate Virtual Information Session alone is eight
// upcoming occurrences of one page and one picture.
async function fetchEventDetail(url: string): Promise<EventDetail> {
  const res = await fetchWithRetry(new URL(url, SITE_BASE).toString(), {
    headers: { Accept: 'text/html' },
  });
  const detail = parseDetailPage(await res.text());
  const { image } = detail;
  if (image && (!image.width || !image.height)) {
    const meta = await fetchImageMeta(image.url, 'lbj');
    detail.image = { ...image, width: meta.width, height: meta.height, mimeType: meta.mimeType };
  }
  return detail;
}

export async function scrapeLbj(
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
    console.error(`[lbj] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  const now = Date.now();
  // Drop the past BEFORE the detail fetches so we only request pages for
  // events that can still be shown.
  const upcoming = calendar.filter((ev) => {
    const timing = resolveTiming(ev);
    if (!timing) {
      console.warn(`[lbj] Unreadable calendar entry ${ev.eid} "${ev.start}" — skipping`);
      eventsSkipped++;
      return false;
    }
    return timing.endMs >= now;
  });
  console.log(`[lbj] Fetched ${calendar.length} calendar entries, ${upcoming.length} upcoming`);

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
          console.error(`[lbj] Failed to fetch ${ev.url}: ${err}`);
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

      if (dryRun) {
        console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process event ${ev.eid}: ${err}`;
      console.error(`[lbj] ${msg}`);
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
    `[lbj] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed: upcoming.length, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[lbj] Scraper started');
  await scrapeLbj(env);
}
