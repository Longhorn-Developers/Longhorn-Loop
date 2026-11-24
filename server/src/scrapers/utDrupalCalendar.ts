// Shared scraper for UT Drupal Kit event calendars (Drupal 11 + the UTDK
// "utevent" content type + Drupal's FullCalendar view). Several UT schools run
// the identical stack, so each one is a site config for this module rather
// than a scraper of its own: see nursing.ts and ischool.ts.
//
// THE CALENDAR. The calendar page is a FullCalendar month grid, and Drupal
// ships the grid's ENTIRE event list inline, as a JSON string inside the
// `drupalSettings` script:
//
//   drupalSettings.fullCalendarView[0].calendar_options  (a JSON string)
//     .events[] -> { title, url, start, end, allDay, des, eid, id, ... }
//
// That list is not windowed to the month on screen: it holds every event the
// site has ever published (Nursing: ~1,600 back to 2019; iSchool: ~700 back to
// 2018), recurring series already expanded into one entry per occurrence. One
// request therefore covers the whole listing, with no pagination, and we keep
// only what hasn't ended yet.
//
// The calendar supplies identity and timing: title, event page URL, start/end
// and the all-day flag. Everything else lives on each event's own page, which
// is fetched once per URL (a recurring series is one page shared by all of its
// occurrences):
//   - description: the Event node in the page's JSON-LD, falling back to
//     og:description for pages that have no JSON-LD.
//   - location: the "Location" field (a room or venue: "NUR 5.178", "Zoom
//     Meeting"). Not every event has one.
//   - address: some bodies also carry a street address, in the editors'
//     "Location: NUR 5.178 | School of Nursing | 1710 Red River St., Austin,
//     Texas" line. It is appended to the location so `locationFull` keeps it.
//   - categories: the "Event tags" field.
//   - registration link: the first button inside the event body.
//   - image: the event's media-image field, when the editor added one.
//
// Fields are read from inside the page's node (<article class="node
// node--type-...">), never the page around it. The site chrome carries look-
// alike fields: iSchool's footer has a media-image field of its own (the
// department's signature banner), which read as the picture of every event
// that has none until the search was scoped.
//
// Things these sites don't give us:
//   - organizer: events carry no host, so every one is attributed to the
//     school itself (the site config's orgName).
//   - coordinates: the pages publish none (Nursing's address line links to a
//     Google Maps search, which is not a point we should scrape), so latitude
//     and longitude are left null on purpose. ingestEvents fills them for
//     every scraper from the UT building registry (attachBuildingCoordinates
//     in events/ingest.ts, data/ut-buildings.json), keyed on the building code
//     in the location, and logs a venue it doesn't know as "unresolved event
//     location". Online events are skipped there, too.
//
// Times: the calendar's start/end are wall-clock America/Chicago with no
// offset, so the DST-aware offset is attached per date. For all-day events
// FullCalendar's `end` is EXCLUSIVE (a one-day event ends the next midnight;
// the 29 one-day all-day events in Nursing's history all span exactly 1 day),
// so the last day is `end` minus one.
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

/** One UT Drupal Kit site. */
export interface UtDrupalCalendarSite {
  /** `events.source`, and the tag on every log line. */
  source: string;
  /** Scheme and host, no trailing slash: "https://nursing.utexas.edu". */
  siteBase: string;
  /** Path of the page that embeds the calendar: "/events", "/calendar". */
  calendarPath: string;
  /** Host for every event; these sites name none per event. */
  orgName: string;
}

// One detail page is fetched per distinct event URL, so pace them.
const REQUEST_DELAY_MS = 200;

export interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
  /** Dry run only: what would have been ingested, for POST /events/scrape/:name. */
  events?: NormalizedEvent[];
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
  // Street address from the body's "Location:" line, when the editor wrote one.
  address: string | null;
  tags: { id: string; name: string }[];
  rsvpUrl: string | null;
  image: EventImage | null;
}

// Calendar

// Pulls the event list out of the calendar page. Throws when the structure is
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

// The page's node: the <article> Drupal renders the linked entity into. That is
// usually a utevent, but a calendar entry can also link to a plain flex page
// (Nursing's pinning ceremony is a `node--type-utexas-flex-page`), so any node
// type counts. A page without one (a template change) is read whole, which is
// how every field was found before the scoping existed.
function eventNode(html: string): string {
  const start = html.search(/<article\b[^>]*\bnode--type-/);
  if (start < 0) return html;
  const end = html.indexOf('</article>', start);
  return html.slice(start, end < 0 ? undefined : end);
}

// The slice of the event node for one Drupal field: from its wrapper class to
// the next field. Matching inside a slice keeps one field's links (tag links,
// buttons) from being read as another's.
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

function toNumberOrNull(value: string | null): number | null {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

// Pure and sync so it's easy to test against saved HTML fixtures. Every field
// is optional on these sites, so an empty page yields an all-null detail rather
// than failing: the calendar already gave us a valid event.
export function parseDetailPage(html: string, site: UtDrupalCalendarSite): EventDetail {
  // JSON-LD descriptions arrive with "\r\n" and doubled spaces from the editor.
  // Both live in <head>, so these read the whole page.
  const description = (jsonLdDescription(html) ?? metaContent(html, 'og:description'))
    ?.replace(/\s+/g, ' ')
    .trim();

  const node = eventNode(html);

  const locationBlock = fieldBlock(node, 'field-utevent-location');
  const location =
    locationBlock?.match(/utevent-event-field__item">([\s\S]*?)<\/div>/)?.[1] ?? null;

  const tagBlock = fieldBlock(node, 'field-utevent-tags') ?? '';
  const tags = [...tagBlock.matchAll(/href="\/events\?type=(\d+)">([^<]+)<\/a>/g)].map((m) => ({
    id: `event-type-${m[1]}`,
    name: decodeHtmlEntities(m[2]).trim(),
  }));

  // The editors' call-to-action is a `ut-btn` link inside the event body (a
  // Zoom join link, a signup form, a livestream). Scoped to the body because
  // every page also carries a site-wide "Give" button with the same class.
  // The sidebar ("Event Details") starts where the body ends.
  const body = fieldBlock(node, 'field-utevent-body')?.split('utevent-event__content-secondary')[0];
  const button = body?.match(/<a\s[^>]*class="[^"]*\but-btn\b[^"]*"[^>]*>/)?.[0];

  const imageBlock = fieldBlock(node, 'field-utexas-media-image');
  const img = imageBlock?.match(/<img\s[^>]*>/)?.[0];
  const imgSrc = img ? attr(img, 'src') : null;

  return {
    description: description || null,
    location: location ? htmlToText(location) || null : null,
    address: extractBodyAddress(body),
    tags,
    rsvpUrl: button ? attr(button, 'href') : null,
    image: imgSrc
      ? {
          url: new URL(imgSrc, site.siteBase).toString(),
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
  site: UtDrupalCalendarSite,
  now = Date.now(),
): NormalizedEvent | null {
  const timing = resolveTiming(ev);
  const entityId = ev.eid?.match(/^(\d+)-/)?.[1];
  if (!timing || !entityId || !ev.url) {
    console.warn(`[${site.source}] Unreadable calendar entry ${ev.eid} "${ev.start}" — skipping`);
    return null;
  }
  if (timing.endMs < now) return null;

  const { image } = detail;
  const locationFull = joinLocation(detail.location, detail.address);

  return {
    source: site.source,
    sourceEventId: `${entityId}-${ev.start.slice(0, 10)}`,
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
      // No per-event host anywhere on these sites; see the header.
      sourceOrgId: null,
      name: site.orgName,
      profilePicture: null,
    },
    eventUrl: new URL(ev.url, site.siteBase).toString(),
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

async function fetchCalendarEvents(site: UtDrupalCalendarSite): Promise<CalendarEvent[]> {
  const res = await fetchWithRetry(new URL(site.calendarPath, site.siteBase).toString(), {
    headers: { Accept: 'text/html' },
  });
  return extractCalendarEvents(await res.text());
}

async function fetchEventDetail(url: string, site: UtDrupalCalendarSite): Promise<EventDetail> {
  const res = await fetchWithRetry(new URL(url, site.siteBase).toString(), {
    headers: { Accept: 'text/html' },
  });
  return parseDetailPage(await res.text(), site);
}

export async function scrapeUtDrupalCalendar(
  env: Env,
  site: UtDrupalCalendarSite,
  options: { dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const tag = `[${site.source}]`;
  const dryRun = options.dryRun ?? false;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let calendar: CalendarEvent[];
  try {
    calendar = await fetchCalendarEvents(site);
  } catch (err) {
    const msg = `Fatal error fetching events: ${err}`;
    console.error(`${tag} ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  const now = Date.now();
  // The list includes every past occurrence. Drop them BEFORE the detail
  // fetches so we only request pages for events that can still be shown.
  const upcoming = calendar.filter((ev) => {
    const timing = resolveTiming(ev);
    if (!timing) {
      console.warn(`${tag} Unreadable calendar entry ${ev.eid} "${ev.start}" — skipping`);
      eventsSkipped++;
      return false;
    }
    return timing.endMs >= now;
  });
  console.log(`${tag} Fetched ${calendar.length} calendar entries, ${upcoming.length} upcoming`);

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
          detail = await fetchEventDetail(ev.url, site);
        } catch (err) {
          // Skip rather than ingest without the description: the upsert would
          // overwrite a good row from an earlier run with nulls. The next cron
          // run retries.
          detail = null;
          errors.push(`Failed to fetch ${ev.url}: ${err}`);
          console.error(`${tag} Failed to fetch ${ev.url}: ${err}`);
        }
        details.set(ev.url, detail);
      }
      if (!detail) {
        eventsSkipped++;
        continue;
      }

      const parsed = parseCalendarEvent(ev, detail, site, now);
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl && (!parsed.imageWidth || !parsed.imageHeight)) {
        const meta = await fetchImageMeta(parsed.imageUrl, site.source);
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = parsed.imageMimeType ?? meta.mimeType;
        parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
      }

      if (dryRun) console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      normalized.push(parsed);
    } catch (err) {
      const msg = `Failed to process event ${ev.eid}: ${err}`;
      console.error(`${tag} ${msg}`);
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
    `${tag} Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return {
    eventsProcessed: upcoming.length,
    eventsUpserted,
    eventsSkipped,
    errors,
    durationMs,
    ...(dryRun ? { events: normalized } : {}),
  };
}
