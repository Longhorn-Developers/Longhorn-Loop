// School of Nursing scraper: nursing.utexas.edu/events (Drupal 11, UT Drupal Kit).
//
// The /events page is the FullCalendar grid whose embedded list holds every
// event the site has ever published (about 1,600 back to 2019), so one request
// covers the whole listing and we keep only what hasn't ended yet. Reading that
// list, its times and the dedup key are the same on every UT Drupal Kit site and
// are documented in utDrupalEvents.ts. Here, the 29 one-day all-day events in
// the history all span exactly 1 day, which is what confirms the exclusive
// `end` reading described there.
//
// The calendar supplies identity and timing: title, event page URL, start/end
// and the all-day flag. Everything else lives on each event's own page, which
// is fetched once per URL (a recurring series is one page shared by all of its
// occurrences):
//   - description: the Event node in the page's JSON-LD, falling back to
//     og:description for the few pages that have no JSON-LD.
//   - location: the "Location" field (a room or venue: "NUR 5.178", "Zoom
//     Meeting"). Not every event has one.
//   - address: some bodies also carry a street address, in the editors'
//     "Location: NUR 5.178 | School of Nursing | 1710 Red River St., Austin,
//     Texas" line (4 of the 12 upcoming pages when this was written, one of
//     them a non-Nursing building). It is appended to the location so
//     `locationFull` keeps it, the same shape Pharmacy's carried.
//   - categories: the "Event tags" field.
//   - registration link: the first button inside the event body.
//   - image: a picture embedded in the body, when the editor added one.
//
// Things we can't get:
//   - organizer: events carry no host, so every one is attributed to the School
//     of Nursing itself.
//   - coordinates: the page publishes none (the address line above links to a
//     Google Maps search, which is not a point we should scrape), so this
//     scraper leaves latitude/longitude null. That is deliberate, not a gap:
//     ingestEvents fills them for every scraper from the UT building registry
//     (attachBuildingCoordinates in events/ingest.ts, data/ut-buildings.json),
//     keyed on the building code in the location. "NUR 5.178", "NUR - various"
//     and the address above all resolve to the Nursing building (1710 Red River
//     St), and a venue the registry doesn't know is logged there as
//     "unresolved event location". Online events are skipped there, too.
//   - a banner image for most events: only about one in seven pages has a
//     picture, and the site sets no og:image to fall back on.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta, truncateLocation } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import { htmlToText, inferVenueType } from './helpers';
import {
  attr,
  cleanTitle,
  extractCalendarEvents,
  fieldBlock,
  occurrenceId,
  parseDescription,
  parseEventTags,
  parseLocationField,
  resolveTiming,
  toNumberOrNull,
  type CalendarEvent,
} from './utDrupalEvents';

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
  // Street address from the body's "Location:" line, when the editor wrote one.
  address: string | null;
  tags: { id: string; name: string }[];
  rsvpUrl: string | null;
  image: EventImage | null;
}

// Detail page

// "1710 Red River St., Austin, Texas": a house number, a street, then the city.
// Requiring ", Austin" keeps a room ("NUR 5.178") or a building name from ever
// being taken for an address.
const STREET_ADDRESS_RE = /^\d{1,6}\s+\S.*,\s*Austin\b/i;

// Editors paste the same line into many event bodies:
//   <strong>Location:</strong> NUR 5.178 | School of Nursing |&nbsp;<a ...>1710 Red River St., Austin, Texas</a>
// Its parts are separated by "|" and the address, when there is one, is the
// last. A line with no address ("Location: Zoom", "NUR 5.178 | School of
// Nursing") fails the street-address pattern and yields null.
function extractBodyAddress(body: string | undefined): string | null {
  const line = body?.match(/<p[^>]*>\s*<strong>\s*Location:?\s*<\/strong>([\s\S]*?)<\/p>/i)?.[1];
  if (!line) return null;
  const parts = htmlToText(line)
    .split('|')
    .map((part) => part.trim());
  const last = parts[parts.length - 1];
  return STREET_ADDRESS_RE.test(last) ? last : null;
}

// "NUR 5.178" + "1710 Red River St., Austin, Texas" -> both, comma-joined. Either
// alone is returned as is; so is the room when it already contains the address.
function joinLocation(location: string | null, address: string | null): string | null {
  if (!address || location?.includes(address)) return location;
  return location ? `${location}, ${address}` : address;
}

// Pure and sync so it's easy to test against saved HTML fixtures. Every field
// is optional on this site, so an empty page yields an all-null detail rather
// than failing: the calendar already gave us a valid event.
export function parseDetailPage(html: string): EventDetail {
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
    description: parseDescription(html),
    location: parseLocationField(html),
    address: extractBodyAddress(body),
    tags: parseEventTags(html),
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
  const sourceEventId = occurrenceId(ev);
  if (!timing || !sourceEventId || !ev.url) {
    console.warn(`[nursing] Unreadable calendar entry ${ev.eid} "${ev.start}" — skipping`);
    return null;
  }
  if (timing.endMs < now) return null;

  const { image } = detail;
  const locationFull = joinLocation(detail.location, detail.address);

  return {
    source: SOURCE,
    sourceEventId,
    title: cleanTitle(ev.title),
    description: detail.description,
    startDatetime: timing.startDatetime,
    endDatetime: timing.endDatetime,
    venueType: inferVenueType(locationFull, null),
    // The room or venue, not the address: the short form is what a card shows.
    locationShort: truncateLocation(detail.location ?? detail.address),
    locationFull,
    // Null on purpose; ingestEvents resolves them from the building in
    // locationFull. See "coordinates" in the header.
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
