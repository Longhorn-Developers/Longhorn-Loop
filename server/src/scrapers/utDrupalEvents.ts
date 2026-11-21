// UT Drupal Kit event sites: the half of a scraper that is the platform's, not
// the site's.
//
// nursing.utexas.edu and lbj.utexas.edu both run the UT Drupal Kit (UTDK 3 on
// Drupal 11) with its `utevent` content type and the fullcalendar_view module,
// so their event data has the same shape down to the CSS class names. That
// shared shape lives here. What each site's editors do differently (where an
// address is written, which field holds the banner, who the host is) stays in
// the site's own scraper: nursing.ts, lbj.ts.
//
// THE CALENDAR. Each site's calendar page is a FullCalendar month grid, and
// Drupal ships the grid's ENTIRE event list inline, as a JSON string inside
// the `drupalSettings` script:
//
//   drupalSettings.fullCalendarView[0].calendar_options  (a JSON string)
//     .events[] -> { title, url, start, end, allDay, des, eid, id, ... }
//
// That list is not windowed to the month on screen: it holds every event the
// site has ever published, recurring series already expanded into one entry
// per occurrence. One request therefore covers the whole listing, with no
// pagination, and a scraper keeps only what hasn't ended yet.
//
// TIMES. start/end are wall-clock America/Chicago with no offset, so the
// DST-aware offset is attached per date. For all-day events FullCalendar's
// `end` is EXCLUSIVE (a one-day event ends the next midnight), so the last day
// is `end` minus one.
//
// DEDUP KEY: `<entity id>-<YYYY-MM-DD>`. The calendar's own `eid` ends in the
// occurrence's position in its series (`2473-D-3`, `1389-R-5-I-2`), but that
// position shifts if an editor deletes an earlier date, which would re-point
// every later row at the wrong occurrence. The entity id is constant for the
// series, and the date pins the occurrence; moving an occurrence to another
// time on the same day updates it in place.
//
// THE EVENT PAGE. Each field renders inside a `field--name-<machine name>`
// wrapper. The readers below match inside one wrapper at a time, never the
// whole page, so the site chrome (menu links, the footer's buttons) can't be
// mistaken for event content.

import { chicagoOffset, decodeHtmlEntities, htmlToText } from './helpers';

// Calendar

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

export interface EventTiming {
  startDatetime: string;
  endDatetime: string | null;
  // The instant the event is over, for dropping past entries.
  endMs: number;
}

// Pulls the event list out of a calendar page. Throws when the structure is
// not there: that means the site changed, and "0 events" would hide it.
export function extractCalendarEvents(html: string): CalendarEvent[] {
  const settings = html.match(
    /<script[^>]*data-drupal-selector="drupal-settings-json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!settings) throw new Error('drupalSettings script not found on the calendar page');

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
export function resolveTiming(ev: CalendarEvent): EventTiming | null {
  try {
    return computeTiming(ev);
  } catch {
    return null;
  }
}

function computeTiming(ev: CalendarEvent): EventTiming | null {
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
  // An end before the start would be a data-entry slip (none in either site's
  // history); keep the start and drop the end rather than store an inverted
  // range.
  if (endMs < startMs) return { startDatetime, endDatetime: null, endMs: startMs };
  return { startDatetime, endDatetime, endMs };
}

// The dedup key described in the header, or null when the eid has no entity id.
export function occurrenceId(ev: CalendarEvent): string | null {
  const entityId = ev.eid?.match(/^(\d+)-/)?.[1];
  return entityId && ev.start ? `${entityId}-${ev.start.slice(0, 10)}` : null;
}

// The calendar prefixes every title with a visually-hidden "October 21:" for
// screen readers. It is not part of the title.
export function cleanTitle(raw: string): string {
  return htmlToText(raw.replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ''));
}

// Event page

// The slice of the page for one Drupal field: from its wrapper class to the
// next field. Matching inside a slice (not the whole page) keeps the tag links
// and the buttons from the site chrome from being mistaken for content.
//
// "The next field" includes one nested inside this one: an image embedded in
// an event body is a field of its own, so a body's slice ends at its first
// embedded image.
export function fieldBlock(html: string, fieldClass: string): string | null {
  const start = html.indexOf(`field--name-${fieldClass}`);
  if (start < 0) return null;
  const next = html.indexOf('class="field field--name-', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

// Find the tag first, then read its attribute: attribute order differs
// between Drupal templates and after a formatter has touched a saved fixture.
export function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? decodeHtmlEntities(match[1]) : null;
}

export function metaContent(html: string, property: string): string | null {
  const tag = html.match(new RegExp(`<meta\\s[^>]*property="${property}"[^>]*>`));
  return tag ? attr(tag[0], 'content') : null;
}

export function toNumberOrNull(value: string | null): number | null {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
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

// The Event node's description in the page's JSON-LD, falling back to
// og:description for pages that have none. JSON-LD descriptions arrive with
// "\r\n" and doubled spaces from the editor; both collapse.
export function parseDescription(html: string): string | null {
  const description = (jsonLdDescription(html) ?? metaContent(html, 'og:description'))
    ?.replace(/\s+/g, ' ')
    .trim();
  return description || null;
}

// The "Location" field: a room or venue as the editor wrote it ("NUR 5.178",
// "Virtual via Zoom"). On some sites the value is a link to a filtered
// listing; only its text is kept.
export function parseLocationField(html: string): string | null {
  const block = fieldBlock(html, 'field-utevent-location');
  const location = block?.match(/utevent-event-field__item"\s*>([\s\S]*?)<\/div>/)?.[1];
  return location ? htmlToText(location) || null : null;
}

// The "Event tags" field. Each tag links to the site's listing filtered by it,
// which is where its taxonomy id comes from.
export function parseEventTags(html: string): { id: string; name: string }[] {
  const block = fieldBlock(html, 'field-utevent-tags') ?? '';
  return [...block.matchAll(/href="\/events\?type=(\d+)"\s*>([^<]+)<\/a>/g)].map((m) => ({
    id: `event-type-${m[1]}`,
    name: decodeHtmlEntities(m[2]).trim(),
  }));
}
