// School of Architecture scraper: soa.utexas.edu/events (Drupal, UT Drupal Kit).
// LOOP-227.
//
// The /events page is a paginated Drupal view of upcoming events (`?page=N`,
// zero-based; /past-events uses the same pager). Each card renders, in this
// order:
//
//   [image] [type]  "Event status" [status]  [date line]
//   [title link -> /events/<slug>]  [teaser]  [location]
//
//   - type: one of the site's event types ("Exhibition", "Lecture Series",
//     "City Forum", ...). Optional: some cards have none.
//   - date line: "Friday October 30, 2026, 5:00pm - Monday November 30, 2026,
//     7:00pm", "Tuesday December 1, 2026, 6:00 - 7:00pm", "Wednesday October 28
//     - Friday October 30, 2026, All day". See parseDateLine().
//   - location: either a link whose text is "Location: GOL 3.120" (pointing at
//     UT's building map, or at a venue's own site), or plain text for places
//     with no link ("Virtual", "TBD", a street address).
//
// The card is parsed by that ORDER, not by CSS class. The first draft was
// written from the page as read in a browser, before the raw HTML had been
// fetched, so the class names weren't known; the fixtures are now real
// captures, but parsing on text, links and images and their order still keeps
// the scraper independent of the theme's wrapper markup, which is also the
// part a theme update is most likely to change. The type is recognised against
// the page's own "Filter events by type" <select>, so a new type the school
// adds is picked up without a code change.
//
// Each event's own page is fetched once, for what the card lacks:
//   - image: og:image. The card's picture is a fixed 840x656 crop
//     (`utexas_image_style_840w_656h`), so its shape says nothing about the
//     flyer; og:image is the `large` style, which scales without cropping.
//   - description: og:description, falling back to the card's teaser.
//
// Event id: the page's Drupal node id ("node-3465"), read from
// drupalSettings.path.currentPath on the event page we already fetch. It stays
// the same when an editor retitles or reschedules the event, so neither makes a
// second row. (The /node/N links elsewhere on the page are the shared menu's,
// so only currentPath is trusted.) If one page is listed more than once, the
// start date is added ("node-3465-2026-10-30") to keep one row per date. A page
// without a node id falls back to the URL slug plus the start date
// ("dont-get-too-attached-2026-10-30").
//
// Things we can't get:
//   - organizer: every event is the school's own, so the host is the School of
//     Architecture with no org id (see docs/org-profiles.md).
//   - coordinates: the page publishes none. latitude/longitude are null on
//     purpose: ingestEvents resolves them from the UT building registry
//     (attachBuildingCoordinates in events/ingest.ts). Every location seen on
//     the listing when this was written resolves there ("GOL 3.120", "North
//     Gallery of Goldsmith Hall", "Harry Ransom Center - Prothro Theater", the
//     WCP auditorium, the AT&T center), and "Virtual"/"TBD" are skipped as
//     non-physical. Pinned in test/scrapers/test_architecture.ts.
//   - registration links: none on the cards; the detail body has free-form
//     links only.
//
// Cancelled events: a card whose status is "Cancelled"/"Canceled" is skipped,
// so it is never newly inserted. A row ingested before the cancellation stays
// until it expires; there's no "cancelled" state in NormalizedEvent to carry.

import { ingestEvents } from '../events/ingest';
import { classifyAspectRatio, fetchImageMeta, truncateLocation } from '../events/normalize';
import { fetchWithRetry, sleep } from '../events/polite-fetch';
import type { NormalizedEvent } from '../events/types';
import type { Env } from '../worker';
import {
  buildDatetime,
  chicagoOffset,
  decodeHtmlEntities,
  htmlToText,
  inferVenueType,
} from './helpers';

const SITE_BASE = 'https://soa.utexas.edu';
const LISTING_URL = `${SITE_BASE}/events`;
export const SOURCE = 'soa';

const DEFAULT_ORG_NAME = 'School of Architecture';
// The upcoming list is short (3 events when this was written, 10 per page);
// the cap only guards against a pager that never ends.
const MAX_PAGES = 20;
const REQUEST_DELAY_MS = 200;

interface ScraperResult {
  eventsProcessed: number;
  eventsUpserted: number;
  eventsSkipped: number;
  errors: string[];
  durationMs: number;
}

// Tokens

// The page reduced to what a person sees, in order: runs of text, links and
// images. Inline formatting (<em>, <strong>, <br>, ...) does not split a run,
// so a teaser with an italic title stays one token; any other tag does.
export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string; text: string }
  | { kind: 'img'; src: string; alt: string | null };

const INLINE_TAGS = new Set(['em', 'strong', 'b', 'i', 'u', 'small', 'sup', 'sub', 'br', 'wbr']);

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  if (!match) return null;
  return decodeHtmlEntities(match[1] ?? match[2]);
}

export function tokenize(html: string): Token[] {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, '');

  const tokens: Token[] = [];
  let text = '';
  const flushText = () => {
    const t = htmlToText(text);
    if (t) tokens.push({ kind: 'text', text: t });
    text = '';
  };

  const tagRe = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi;
  let last = 0;
  let link: { href: string; inner: string; imgs: Token[] } | null = null;

  for (let m = tagRe.exec(cleaned); m; m = tagRe.exec(cleaned)) {
    const between = cleaned.slice(last, m.index);
    last = tagRe.lastIndex;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();

    if (link) {
      // Inside a link: collect its text and any picture it wraps.
      if (name === 'a' && closing) {
        link.inner += between;
        const linkText = htmlToText(link.inner);
        tokens.push(...link.imgs);
        if (linkText) tokens.push({ kind: 'link', href: link.href, text: linkText });
        link = null;
      } else {
        link.inner += `${between} `;
        if (name === 'img' && !closing) {
          const src = attr(m[0], 'src');
          if (src) link.imgs.push({ kind: 'img', src, alt: attr(m[0], 'alt')?.trim() || null });
        }
      }
      continue;
    }

    text += between;
    if (INLINE_TAGS.has(name)) {
      if (name === 'br') text += ' ';
      continue;
    }
    flushText();

    if (name === 'a' && !closing) {
      link = { href: attr(m[0], 'href') ?? '', inner: '', imgs: [] };
    } else if (name === 'img' && !closing) {
      const src = attr(m[0], 'src');
      if (src) tokens.push({ kind: 'img', src, alt: attr(m[0], 'alt')?.trim() || null });
    }
  }
  text += cleaned.slice(last);
  flushText();
  return tokens;
}

// Listing

export interface ListingCard {
  // Site-relative slug path: "/events/dont-get-too-attached".
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  dateLine: string;
  teaser: string | null;
  location: string | null;
  // The card's own picture (a crop; see header). Fallback only.
  imageUrl: string | null;
  imageAlt: string | null;
}

// The <main> region, so the header menu's "Events" link and the footer are
// never mistaken for a card. Throws when there is none: the page changed, and
// "0 events" would hide that.
function mainRegion(html: string): string {
  const open = html.match(/<main\b[^>]*>|<[a-z]+\b[^>]*\brole="main"[^>]*>/i);
  if (!open || open.index === undefined) throw new Error('main content region not found');
  const start = open.index + open[0].length;
  const end = html.indexOf('</main>', start);
  return html.slice(start, end < 0 ? undefined : end);
}

// The options of the "Filter events by type" select, minus "- Any -".
export function extractEventTypes(html: string): Set<string> {
  const types = new Set<string>();
  for (const select of html.matchAll(/<select\b[\s\S]*?<\/select>/gi)) {
    for (const option of select[0].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
      const name = htmlToText(option[1]);
      if (name && !/^-\s*any\s*-$/i.test(name)) types.add(name);
    }
  }
  return types;
}

// "/events/<slug>" on this site, absolute or relative. Not the listing itself,
// not a pager link.
export function eventPath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, SITE_BASE);
  } catch {
    return null;
  }
  if (url.hostname !== new URL(SITE_BASE).hostname) return null;
  const match = url.pathname.match(/^\/events\/([^/]+)\/?$/);
  return match ? `/events/${match[1]}` : null;
}

const STATUS_LABEL = /^event status:?$/i;
const LOCATION_PREFIX = /^location:\s*/i;

// Starts like a card's date line: optional weekday, then a month and a day.
const DATE_LINE_START =
  /^(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\.?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;

export function isDateLine(text: string): boolean {
  return DATE_LINE_START.test(text) && /\d{4}/.test(text);
}

export function extractListingCards(html: string): ListingCard[] {
  const types = extractEventTypes(html);
  const tokens = tokenize(mainRegion(html));

  // A card is anchored on its title: a link to an event page, right after a
  // date line. (Requiring the date keeps an image link or a stray "Read more"
  // pointing at the same page from being read as a second card.)
  const titleIdx: number[] = [];
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    if (t.kind === 'link' && eventPath(t.href) && prev?.kind === 'text' && isDateLine(prev.text)) {
      titleIdx.push(i);
    }
  });

  const cards: ListingCard[] = [];
  let cursor = 0; // first token not yet claimed by an earlier card

  titleIdx.forEach((ti, n) => {
    const title = tokens[ti] as Extract<Token, { kind: 'link' }>;
    const dateIdx = ti - 1;

    // Before the date: [image] [type] "Event status" [status], all optional.
    let status: string | null = null;
    let type: string | null = null;
    let image: Extract<Token, { kind: 'img' }> | null = null;
    let i = dateIdx - 1;
    const statusValue = tokens[i];
    const statusLabel = tokens[i - 1];
    if (
      i - 1 >= cursor &&
      statusLabel?.kind === 'text' &&
      STATUS_LABEL.test(statusLabel.text) &&
      statusValue?.kind === 'text'
    ) {
      status = statusValue.text;
      i -= 2;
    }
    const maybeType = tokens[i];
    if (i >= cursor && maybeType?.kind === 'text' && types.has(maybeType.text)) {
      type = maybeType.text;
      i--;
    }
    const maybeImage = tokens[i];
    if (i >= cursor && maybeImage?.kind === 'img') image = maybeImage;

    // After the title: [teaser] [location], up to where the next card starts.
    // That start is the next card's image, type or status label, found the
    // same way, so a teaser can never be taken for the next card's type.
    const nextTitle = titleIdx[n + 1];
    let end = nextTitle === undefined ? tokens.length : nextTitle - 1;
    if (nextTitle !== undefined) {
      let j = end - 1;
      const label = tokens[j - 1];
      if (label?.kind === 'text' && STATUS_LABEL.test(label.text)) j -= 2;
      const t = tokens[j];
      if (t?.kind === 'text' && types.has(t.text)) j--;
      if (tokens[j]?.kind === 'img') j--;
      end = j + 1;
    }
    const after = tokens.slice(ti + 1, end).filter((t) => t.kind !== 'img');
    // Past the last card, stop at the pager ("Page 2", "Next page").
    const pagerIdx =
      nextTitle === undefined
        ? after.findIndex((t) => t.kind === 'link' && /[?&]page=\d+/.test(t.href))
        : -1;
    const body = pagerIdx >= 0 ? after.slice(0, pagerIdx) : after;

    let teaser: string | null = null;
    let location: string | null = null;
    const locIdx = body.findIndex((t) => t.kind === 'link' && LOCATION_PREFIX.test(t.text));
    if (locIdx >= 0) {
      location = (body[locIdx] as { text: string }).text.replace(LOCATION_PREFIX, '').trim();
      const before = body.slice(0, locIdx).filter((t) => t.kind === 'text');
      teaser = before.length ? before.map((t) => (t as { text: string }).text).join(' ') : null;
    } else {
      const texts = body.filter((t) => t.kind === 'text').map((t) => (t as { text: string }).text);
      // The teaser comes first and the unlinked location last ("Virtual",
      // "TBD"). With one line only, a "Location:" prefix or a short line marks
      // a place; a sentence is a teaser.
      if (texts.length >= 2) {
        teaser = texts.slice(0, -1).join(' ');
        location = texts[texts.length - 1];
      } else if (texts.length === 1) {
        if (LOCATION_PREFIX.test(texts[0]) || texts[0].length <= 40) location = texts[0];
        else teaser = texts[0];
      }
      if (location) location = location.replace(LOCATION_PREFIX, '').trim() || null;
    }

    cards.push({
      path: eventPath(title.href)!,
      title: title.text,
      type,
      status,
      dateLine: (tokens[dateIdx] as { text: string }).text,
      teaser,
      location,
      imageUrl: image ? new URL(image.src, SITE_BASE).toString() : null,
      imageAlt: image?.alt ?? null,
    });
    cursor = end;
  });

  return cards;
}

// Drupal's pager: a link to the next zero-based ?page=N.
export function hasNextPage(html: string, page: number): boolean {
  return new RegExp(`href="[^"]*[?&]page=${page + 1}(?:&[^"]*)?"`).test(html);
}

// Dates

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

interface DateSide {
  month: number | null;
  day: number | null;
  year: number | null;
  // "All day", or a time like "5:00pm" / "6:00" (meridiem may be missing).
  allDay: boolean;
  time: { hour: number; minute: number; meridiem: 'am' | 'pm' | null } | null;
}

// One side of the " - ": "Friday October 30, 2026, 5:00pm", "7:00pm",
// "Wednesday October 28", "Friday October 30, 2026, All day". Null when the
// text is none of those shapes.
function parseSide(raw: string): DateSide | null {
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const side: DateSide = { month: null, day: null, year: null, allDay: false, time: null };

  for (const part of parts) {
    const md = part.match(/^(?:[a-z]+\.?\s+)?([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
    const month = md ? MONTHS[md[1].slice(0, 3).toLowerCase()] : undefined;
    if (md && month && side.month === null) {
      side.month = month;
      side.day = parseInt(md[2], 10);
      continue;
    }
    if (/^\d{4}$/.test(part) && side.year === null) {
      side.year = parseInt(part, 10);
      continue;
    }
    if (/^all[-\s]?day$/i.test(part)) {
      side.allDay = true;
      continue;
    }
    const t = part.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$|^(\d{1,2}):(\d{2})$/i);
    if (t && !side.time) {
      const hour = parseInt(t[1] ?? t[4], 10);
      const minute = parseInt(t[2] ?? t[5] ?? '0', 10);
      if (hour < 1 || hour > 12 || minute > 59) return null;
      side.time = {
        hour,
        minute,
        meridiem: t[3] ? (t[3].toLowerCase() === 'a' ? 'am' : 'pm') : null,
      };
      continue;
    }
    if (/^noon$/i.test(part) && !side.time) {
      side.time = { hour: 12, minute: 0, meridiem: 'pm' };
      continue;
    }
    return null;
  }
  return side;
}

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null; // "February 30"
  return d.toISOString().slice(0, 10);
}

function to24h(hour: number, meridiem: 'am' | 'pm'): number {
  return (hour % 12) + (meridiem === 'pm' ? 12 : 0);
}

function timeString(hour24: number, minute: number): string {
  const meridiem = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

/**
 * The card's date line -> ISO start/end, in the repo's one format:
 * "2026-10-30T17:00:00-05:00" for a timed event (DST-aware Chicago offset),
 * a bare "2026-10-28" for an all-day one (as buildDatetime() and every other
 * scraper do).
 *
 * Shapes seen on the listing:
 *   "Friday October 30, 2026, 5:00pm - Monday November 30, 2026, 7:00pm"
 *   "Tuesday February 16, 2027, 10:00am - 5:00pm"
 *   "Tuesday December 1, 2026, 6:00 - 7:00pm"       (start shares the end's pm)
 *   "Friday November 20, 2026, 12:00 - 1:30pm"      (12:00 is noon)
 *   "Wednesday October 28 - Friday October 30, 2026, All day"
 * Also handled: a lone start ("..., 2026, 5:00pm"), a one-day "All day".
 *
 * Returns null for anything else: a wrong date is worse than a skipped event.
 */
export function parseDateLine(
  line: string,
): { startDatetime: string; endDatetime: string | null } | null {
  const halves = line.split(/\s+[-–—]\s+|\s+to\s+/i);
  if (halves.length > 2) return null;
  const left = parseSide(halves[0]);
  const right = halves.length === 2 ? parseSide(halves[1]) : null;
  if (!left || (halves.length === 2 && !right)) return null;
  if (left.month === null || left.day === null) return null;

  // Fill each side from the other: the year is written once ("October 28 -
  // Friday October 30, 2026"), the date once ("6:00 - 7:00pm"). A year written
  // only at the end belongs to the start too, unless the range wraps New Year
  // ("December 30 - January 2, 2027").
  const endMonth = right?.month ?? left.month;
  const endDay = right?.day ?? left.day;
  const endYear = right?.year ?? left.year;
  if (endYear === null) return null;
  const leftYear = left.year ?? (left.month > endMonth ? endYear - 1 : endYear);

  const startDate = isoDate(leftYear, left.month, left.day);
  const endDate = isoDate(endYear, endMonth, endDay);
  if (!startDate || !endDate) return null;

  const allDay = left.allDay || right?.allDay || (!left.time && !right?.time);
  if (allDay) {
    return { startDatetime: startDate, endDatetime: endDate > startDate ? endDate : null };
  }

  const endTime = right?.time ?? null;
  const startTime = left.time;
  if (!startTime) return null;

  let startMeridiem = startTime.meridiem;
  if (!startMeridiem) {
    // "6:00 - 7:00pm": the start shares the end's meridiem, unless that would
    // put it after the end ("11:00 - 1:00pm" is 11am).
    if (!endTime?.meridiem) return null;
    startMeridiem = endTime.meridiem;
    if (
      startDate === endDate &&
      to24h(startTime.hour, startMeridiem) * 60 + startTime.minute >
        to24h(endTime.hour, endTime.meridiem) * 60 + endTime.minute
    ) {
      startMeridiem = 'am';
    }
  }
  const startDatetime = buildDatetime(
    startDate,
    timeString(to24h(startTime.hour, startMeridiem), startTime.minute),
  );

  if (!endTime) return { startDatetime, endDatetime: null };
  const endMeridiem = endTime.meridiem ?? startMeridiem;
  const endDatetime = buildDatetime(
    endDate,
    timeString(to24h(endTime.hour, endMeridiem), endTime.minute),
  );
  // An end before the start is a data-entry slip; keep the start only.
  if (new Date(endDatetime).getTime() < new Date(startDatetime).getTime()) {
    return { startDatetime, endDatetime: null };
  }
  return { startDatetime, endDatetime };
}

// The instant an event is over. A bare date is the END of that day in Chicago,
// not UTC midnight (the evening before, in Chicago).
export function endInstant(timing: { startDatetime: string; endDatetime: string | null }): number {
  const last = timing.endDatetime ?? timing.startDatetime;
  if (/^\d{4}-\d{2}-\d{2}$/.test(last)) {
    return new Date(`${last}T23:59:59${chicagoOffset(last)}`).getTime();
  }
  return new Date(last).getTime();
}

// Detail page

export interface EventDetail {
  description: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  /** Drupal node id from drupalSettings.path.currentPath, e.g. "3465". */
  nodeId: string | null;
}

function metaContent(html: string, property: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(tag[0], 'property') ?? attr(tag[0], 'name');
    if (key === property) return attr(tag[0], 'content');
  }
  return null;
}

export function parseDetailPage(html: string): EventDetail {
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'description');
  const image = metaContent(html, 'og:image');
  return {
    description: description ? htmlToText(description) || null : null,
    imageUrl: image ? new URL(image, SITE_BASE).toString() : null,
    imageAlt: metaContent(html, 'og:image:alt')?.trim() || null,
    nodeId: html.match(/"currentPath"\s*:\s*"node\\?\/(\d+)"/)?.[1] ?? null,
  };
}

// Normalize

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Pure and sync so it's easy to test against saved fixtures. Returns null for
// an event that is over, cancelled, or whose date line can't be read. Image
// dimensions are filled in by the orchestrator (needs a network round-trip).
export function parseEvent(
  card: ListingCard,
  detail: EventDetail,
  now = Date.now(),
  options: { repeatsOnListing?: boolean } = {},
): NormalizedEvent | null {
  const timing = parseDateLine(card.dateLine);
  if (!timing) {
    console.warn(`[soa] Unreadable date "${card.dateLine}" on ${card.path} — skipping`);
    return null;
  }
  if (endInstant(timing) < now) return null;
  if (card.status && /cancel/i.test(card.status)) return null;

  const imageUrl = detail.imageUrl ?? card.imageUrl;
  const location = card.location;
  // See "Event id" in the header.
  const startDate = timing.startDatetime.slice(0, 10);
  const slug = card.path.replace(/^\/events\//, '');
  const sourceEventId = detail.nodeId
    ? options.repeatsOnListing
      ? `node-${detail.nodeId}-${startDate}`
      : `node-${detail.nodeId}`
    : `${slug}-${startDate}`;

  return {
    source: SOURCE,
    sourceEventId,
    title: card.title,
    description: detail.description ?? card.teaser,
    startDatetime: timing.startDatetime,
    endDatetime: timing.endDatetime,
    venueType: inferVenueType(location, null),
    locationShort: truncateLocation(location),
    locationFull: location,
    // Null on purpose; ingestEvents resolves them from the building in the
    // location. See "coordinates" in the header.
    latitude: null,
    longitude: null,
    organization: { sourceOrgId: null, name: DEFAULT_ORG_NAME, profilePicture: null },
    eventUrl: new URL(card.path, SITE_BASE).toString(),
    rsvpUrl: null,
    imageUrl,
    // fetchImageMeta() fills these in; neither page gives a size.
    imageWidth: null,
    imageHeight: null,
    imageAspectRatio: imageUrl ? classifyAspectRatio(null, null, true) : 'none',
    imageMimeType: null,
    imageAltText: detail.imageUrl ? (detail.imageAlt ?? card.imageAlt) : card.imageAlt,
    theme: null,
    visibility: 'Public',
    rsvpTotal: 0,
    categories: card.type ? [{ id: slugify(card.type), name: card.type }] : [],
    benefits: [],
  };
}

// Fetch

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithRetry(url, { headers: { Accept: 'text/html' } });
  return res.text();
}

export async function fetchListingCards(): Promise<ListingCard[]> {
  const cards: ListingCard[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(REQUEST_DELAY_MS);
    const html = await fetchHtml(page === 0 ? LISTING_URL : `${LISTING_URL}?page=${page}`);
    for (const card of extractListingCards(html)) {
      const k = `${card.path}\u0000${card.dateLine}`;
      if (seen.has(k)) continue;
      seen.add(k);
      cards.push(card);
    }
    if (!hasNextPage(html, page)) break;
  }
  return cards;
}

export async function scrapeArchitecture(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<ScraperResult> {
  const dryRun = options.dryRun ?? false;
  const t0 = Date.now();

  const errors: string[] = [];
  let eventsUpserted = 0;
  let eventsSkipped = 0;

  let cards: ListingCard[];
  try {
    cards = await fetchListingCards();
  } catch (err) {
    const msg = `Fatal error fetching events: ${err}`;
    console.error(`[soa] ${msg}`);
    return {
      eventsProcessed: 0,
      eventsUpserted: 0,
      eventsSkipped: 0,
      errors: [msg],
      durationMs: Date.now() - t0,
    };
  }
  console.log(`[soa] Fetched ${cards.length} listing cards`);

  // One request per distinct page; a failed fetch is remembered (as null) so
  // the event is skipped once, not retried for every occurrence.
  const details = new Map<string, EventDetail | null>();
  const normalized: NormalizedEvent[] = [];
  const now = Date.now();
  // A page listed more than once gets the date in its id (see "Event id").
  const timesListed = new Map<string, number>();
  for (const card of cards) timesListed.set(card.path, (timesListed.get(card.path) ?? 0) + 1);

  for (const card of cards) {
    try {
      let detail = details.get(card.path);
      if (detail === undefined) {
        if (details.size > 0) await sleep(REQUEST_DELAY_MS);
        try {
          detail = parseDetailPage(await fetchHtml(new URL(card.path, SITE_BASE).toString()));
        } catch (err) {
          // Skip rather than ingest without the image and description: the
          // upsert would overwrite a good row from an earlier run with nulls.
          // The next cron run retries.
          detail = null;
          errors.push(`Failed to fetch ${card.path}: ${err}`);
          console.error(`[soa] Failed to fetch ${card.path}: ${err}`);
        }
        details.set(card.path, detail);
      }
      if (!detail) {
        eventsSkipped++;
        continue;
      }

      const parsed = parseEvent(card, detail, now, {
        repeatsOnListing: (timesListed.get(card.path) ?? 0) > 1,
      });
      if (!parsed) {
        eventsSkipped++;
        continue;
      }

      if (parsed.imageUrl) {
        const meta = await fetchImageMeta(parsed.imageUrl, 'soa');
        parsed.imageWidth = meta.width;
        parsed.imageHeight = meta.height;
        parsed.imageMimeType = meta.mimeType;
        parsed.imageAspectRatio = classifyAspectRatio(meta.width, meta.height, true, 0.05);
      }

      if (dryRun) {
        console.log(`[DRY RUN] "${parsed.title}" (${parsed.sourceEventId})`);
      } else {
        normalized.push(parsed);
      }
    } catch (err) {
      const msg = `Failed to process event ${card.path}: ${err}`;
      console.error(`[soa] ${msg}`);
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
    `[soa] Finished in ${(durationMs / 1000).toFixed(1)}s — ${eventsUpserted} upserted, ${eventsSkipped} skipped, ${errors.length} errors`,
  );

  return { eventsProcessed: cards.length, eventsUpserted, eventsSkipped, errors, durationMs };
}

export async function run(env: Env): Promise<void> {
  console.log('[soa] Scraper started');
  await scrapeArchitecture(env);
}
