// UT Law School scraper: law.utexas.edu/calendar (LiveWhale).
//
// LiveWhale has no JSON API,but does publish a
// clean public iCal feed at /calendar/feed/ics/ covering ~1 year of
// upcoming events. We fetch that single feed and parse the VEVENTs

// iCal quirks we handle:
//   - Lines are folded (RFC 5545): continuation lines start with a space
//     or tab and must be joined back onto the previous line.
//   - DTSTART/DTEND are local wall-clock times tagged TZID=US/Central with
//     NO offset (e.g. 20260727T113000). We convert to a real instant using
//     the America/Chicago zone so DST (CDT -05:00 vs CST -06:00) is correct.
//   - Text values use iCal escaping (\n \, \; \\) which we unescape, and the
//     DESCRIPTION body is HTML which we strip.
//
// Dedup key: the VEVENT UID (e.g. "20260727T113000-88639@law.utexas.edu"),
// which is already unique per occurrence.

import { ingestEvents } from '../events/ingest';
import { stripHtml, truncateLocation } from '../events/normalize';
import { fetchWithRetry } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';

const FEED_URL = 'https://law.utexas.edu/calendar/feed/ics/';
export const SOURCE = 'ut_law';

const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_ORG_NAME = 'The University of Texas School of Law';
const CALENDAR_TZ = 'America/Chicago';

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// Helpers, exported for unit tests

// RFC 5545 line folding: a CRLF (or LF) followed by a single space or tab
// is a continuation of the previous line. Unfold before parsing properties.
export function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

export function splitVevents(unfolded: string): string[] {
  return [...unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g)].map((m) => m[1]);
}

// Reverse iCal TEXT escaping. Order matters: unescape "\\" last so an
// escaped backslash doesn't get re-interpreted.
export function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

export interface IcsProperty {
  params: Record<string, string>;
  value: string;
}

// Parse a VEVENT block's "NAME;PARAM=x;PARAM=y:VALUE" lines into a map
// keyed by property name. Only the first occurrence of each name is kept
// (VEVENTs here don't repeat properties we care about).
export function parseIcsProperties(block: string): Record<string, IcsProperty> {
  const props: Record<string, IcsProperty> = {};
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const namePart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = namePart.split(';');
    const key = name.toUpperCase();
    if (props[key]) continue;
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq === -1) continue;
      params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    props[key] = { params, value };
  }
  return props;
}

// Offset (in ms) of `timeZone` at the given UTC instant. Derived by
// formatting the instant as wall-clock in the zone and diffing against the
// instant itself
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  // Intl formats hour "24" for midnight; normalize to 0.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asIfUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asIfUtc - utcMs;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Convert an iCal date-time (e.g. "20260727T113000", or all-day
// "20260727") that represents wall-clock time in `timeZone` into an ISO
// 8601 string carrying the correct numeric offset. Returns null if the
// value can't be parsed.
export function icsDateToIso(value: string, timeZone: string = CALENDAR_TZ): string | null {
  // A trailing Z means it's already UTC; pass it straight through as an offset.
  const utcMatch = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utcMatch) {
    const [, y, mo, d, h, mi, s] = utcMatch;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}+00:00`;
  }

  const dtMatch = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/);
  if (!dtMatch) return null;
  const year = Number(dtMatch[1]);
  const month = Number(dtMatch[2]);
  const day = Number(dtMatch[3]);
  const hour = Number(dtMatch[4] ?? '0');
  const minute = Number(dtMatch[5] ?? '0');
  const second = Number(dtMatch[6] ?? '0');

  // Treat the wall-clock as if it were UTC, then correct by the zone's
  // offset. Resolve the offset twice so events near a DST transition land
  // on the right side of the boundary.
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = timeZoneOffsetMs(wallAsUtc, timeZone);
  offset = timeZoneOffsetMs(wallAsUtc - offset, timeZone);

  const sign = offset >= 0 ? '+' : '-';
  const absMin = Math.round(Math.abs(offset) / 60000);
  const offHours = Math.floor(absMin / 60);
  const offMins = absMin % 60;
  return `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}T${pad(hour)}:${pad(minute)}:${pad(second)}${sign}${pad(offHours)}:${pad(offMins)}`;
}

// Pure and sync so it's easy to test against a saved .ics fixture.
export function parseVevent(block: string, now = Date.now()): NormalizedEvent | null {
  const props = parseIcsProperties(block);

  const summary = props.SUMMARY?.value;
  if (!summary) {
    console.warn('[lawSchool] VEVENT missing SUMMARY — skipping');
    return null;
  }

  const dtstart = props.DTSTART;
  if (!dtstart) {
    console.warn('[lawSchool] VEVENT missing DTSTART — skipping');
    return null;
  }
  const tzid = dtstart.params.TZID ?? CALENDAR_TZ;
  const startDatetime = icsDateToIso(dtstart.value, normalizeTzid(tzid));
  if (!startDatetime) {
    console.warn(`[lawSchool] Unparseable DTSTART "${dtstart.value}" — skipping`);
    return null;
  }

  const dtend = props.DTEND;
  const endDatetime = dtend
    ? icsDateToIso(dtend.value, normalizeTzid(dtend.params.TZID ?? CALENDAR_TZ))
    : null;

  // Multi-hour/day events stay visible until they actually end; fall back to
  // the start when there's no end.
  const startMs = new Date(startDatetime).getTime();
  if (isNaN(startMs)) return null;
  const endMs = endDatetime ? new Date(endDatetime).getTime() : startMs;
  if (endMs < now) return null;

  const uid = props.UID?.value?.trim();
  const eventUrl = props.URL?.value?.trim() || FEED_URL;
  // UID is unique per occurrence; fall back to the event URL if it's absent.
  const sourceEventId = uid || eventUrl;

  const title = unescapeIcsText(summary).trim();
  const description = stripHtml(unescapeIcsText(props.DESCRIPTION?.value ?? '')) || null;

  const rawLocation = props.LOCATION ? unescapeIcsText(props.LOCATION.value).trim() : '';
  const locationFull = rawLocation || null;

  return {
    source: SOURCE,
    sourceEventId,
    title,
    description,
    startDatetime,
    endDatetime,
    venueType: inferVenueType(locationFull, null),
    locationShort: truncateLocation(locationFull),
    locationFull,
    latitude: null,
    longitude: null,
    organization: {
      // Law School is a department with no numeric org id, so ingest stores
      // just the name on the event row and skips the organizations table.
      sourceOrgId: null,
      name: DEFAULT_ORG_NAME,
      profilePicture: null,
    },
    eventUrl,
    rsvpUrl: null,
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    imageAspectRatio: 'none',
    imageMimeType: null,
    imageAltText: null,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: [],
    benefits: [],
  };
}

// The feed labels its zone "US/Central"; that alias resolves in Intl, but
// normalize to the canonical IANA name to be safe across runtimes.
function normalizeTzid(tzid: string): string {
  return tzid === 'US/Central' ? CALENDAR_TZ : tzid;
}

export function parseFeed(icsText: string, now = Date.now()): NormalizedEvent[] {
  const unfolded = unfoldIcs(icsText);
  const events: NormalizedEvent[] = [];
  for (const block of splitVevents(unfolded)) {
    const parsed = parseVevent(block, now);
    if (parsed) events.push(parsed);
  }
  return events;
}

export async function scrapeLawSchool(
  env: Env,
  options: { maxEvents?: number; dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const t0 = Date.now();

  const errors: string[] = [];

  let icsText: string;
  try {
    const res = await fetchWithRetry(FEED_URL, { headers: { Accept: 'text/calendar, */*' } });
    icsText = await res.text();
  } catch (err) {
    const msg = `Fatal error fetching iCal feed: ${err}`;
    console.error(`[lawSchool] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }

  const now = Date.now();
  const blocks = splitVevents(unfoldIcs(icsText));
  const eventsProcessed = blocks.length;

  const normalized: NormalizedEvent[] = [];
  for (const block of blocks) {
    try {
      const parsed = parseVevent(block, now);
      if (parsed) normalized.push(parsed);
    } catch (err) {
      const msg = `Failed to parse VEVENT: ${err}`;
      console.error(`[lawSchool] ${msg}`);
      errors.push(msg);
    }
  }

  const capped = normalized.slice(0, maxEvents);
  const eventsSkipped = eventsProcessed - capped.length;
  let eventsUpserted = 0;

  if (dryRun) {
    for (const event of capped) {
      console.log(`[DRY RUN] "${event.title}" (${event.sourceEventId}) — ${event.startDatetime}`);
    }
  } else if (capped.length > 0) {
    const result = await ingestEvents(env, capped);
    eventsUpserted = result.inserted + result.updated;
    errors.push(...result.errors);
  }

  const durationMs = Date.now() - t0;
  console.log(
    `[lawSchool] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[lawSchool] Scraper started');
  await scrapeLawSchool(env);
}
